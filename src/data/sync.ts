/**
 * Sincronização entre aparelhos.
 *
 * O IndexedDB continua sendo a fonte local (o app funciona igual sem nuvem).
 * Publicado no claude.ai, a capability `db` guarda os dados em poucos blocos
 * (ver `syncMerge.ts`), sempre combinados antes de gravar — uma falha no meio
 * nunca deixa a nuvem pela metade; o próximo envio retoma do ponto certo.
 * Fora do claude.ai (ex.: localhost) nada muda.
 */
import { liveQuery, type Table } from 'dexie';
import { useSyncExternalStore } from 'react';
import { db } from './db';
import { planPull, planPush, TABLES, type Local, type Rec, type Shard, type TableName } from './syncMerge';

const COLLECTION = 'meufuturo_v2';
const META_DOC = 'meta';
const RESET_KEY = 'meufuturo.resetAt';

/* Formato mínimo da capability `db` do claude.ai usado aqui. */
interface RemoteError { code: string; message: string }
interface RemoteDoc { id: string; data(): Record<string, unknown> | undefined }
interface RemoteQuerySnap { docs: RemoteDoc[] }
interface RemoteDocRef { set(d: Record<string, unknown>): Promise<void> }
interface RemoteCollection {
  doc(id: string): RemoteDocRef;
  onSnapshot(next: (s: RemoteQuerySnap) => void, error?: (e: RemoteError) => void): () => void;
}
interface RemoteDB { collection(path: string): RemoteCollection }

export type SyncState = 'local' | 'connecting' | 'synced' | 'saving' | 'error';
export interface SyncStatus { state: SyncState; detail: string; lastSyncedAt: string | null }

let status: SyncStatus = { state: 'local', detail: '', lastSyncedAt: null };
const listeners = new Set<() => void>();
function setStatus(patch: Partial<SyncStatus>) {
  const next = { ...status, ...patch };
  if (next.state === status.state && next.detail === status.detail && next.lastSyncedAt === status.lastSyncedAt) return;
  status = next;
  listeners.forEach((l) => l());
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => status,
  );
}

/* ---------- Marca de substituição (importar backup, exemplo, apagar tudo) ---------- */

let memoryResetAt = '';
function localResetAt(): string {
  try {
    return localStorage.getItem(RESET_KEY) ?? memoryResetAt;
  } catch {
    return memoryResetAt;
  }
}
function setLocalResetAt(at: string) {
  memoryResetAt = at;
  try {
    localStorage.setItem(RESET_KEY, at);
  } catch {
    /* sem localStorage: fica em memória */
  }
}
/** Chamado antes de substituir todos os dados locais. */
export function markLocalReset(at: string) {
  setLocalResetAt(at);
}

/* ---------- Estado da conexão ---------- */

let remote: RemoteDB | null = null;
let remoteShards = new Map<string, Shard>();
let remoteResetAt = '';
let initialLoaded = false;
let started = false;

let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn, fn);
  chain = p.catch(() => undefined);
  return p;
}

const table = (t: TableName) => db[t] as unknown as Table<Rec, string>;
const effectiveReset = () => (localResetAt() > remoteResetAt ? localResetAt() : remoteResetAt);

async function readLocal(): Promise<Local> {
  const rows = await Promise.all(TABLES.map((t) => table(t).toArray()));
  return Object.fromEntries(TABLES.map((t, i) => [t, rows[i]])) as unknown as Local;
}

/**
 * Conecta à nuvem quando disponível e espera a primeira leitura (até `timeoutMs`),
 * para um aparelho novo já abrir com os dados do outro.
 */
export async function initCloudSync(timeoutMs = 8000): Promise<void> {
  if (started) return;
  started = true;
  const claude = (window as unknown as { claude?: { use?: (name: string) => Promise<unknown> } }).claude;
  if (typeof claude?.use !== 'function') return;
  setStatus({ state: 'connecting' });
  const ready = (async () => {
    const rdb = (await claude.use!('db')) as RemoteDB | null;
    if (!rdb) {
      setStatus({ state: 'local' });
      return;
    }
    remote = rdb;
    await connect(rdb);
  })().catch((err: unknown) => setStatus({ state: 'error', detail: errorText(err) }));
  await Promise.race([ready, new Promise((r) => setTimeout(r, timeoutMs))]);
}

function connect(rdb: RemoteDB): Promise<void> {
  return new Promise<void>((resolve) => {
    rdb.collection(COLLECTION).onSnapshot(
      (snap) => {
        const shards = new Map<string, Shard>();
        let reset = '';
        for (const doc of snap.docs) {
          const body = doc.data();
          if (!body) continue;
          if (doc.id === META_DOC) reset = typeof body.resetAt === 'string' ? body.resetAt : '';
          else if (typeof body.table === 'string' && body.records && typeof body.records === 'object') {
            shards.set(doc.id, { table: body.table as TableName, records: structuredClone(body.records) as Record<string, Rec> });
          }
        }
        serial(async () => {
          remoteShards = shards;
          remoteResetAt = reset;
          if (reset > localResetAt()) setLocalResetAt(reset);
          await pull();
        }).then(
          () => {
            if (!initialLoaded) {
              initialLoaded = true;
              startWatchingLocal();
              resolve();
            }
            scheduleSync();
          },
          (err) => {
            setStatus({ state: 'error', detail: errorText(err) });
            resolve();
          },
        );
      },
      (e) => {
        setStatus({ state: 'error', detail: e.message });
        resolve();
      },
    );
  });
}

async function pull() {
  const plan = planPull(await readLocal(), remoteShards, effectiveReset());
  const hasWork = TABLES.some((t) => plan.puts[t].length || plan.deletes[t].length);
  if (!hasWork) return;
  await db.transaction('rw', TABLES.map(table), async () => {
    for (const t of TABLES) {
      if (plan.deletes[t].length) await table(t).bulkDelete(plan.deletes[t]);
      if (plan.puts[t].length) await table(t).bulkPut(plan.puts[t]);
    }
  });
}

let watching = false;
function startWatchingLocal() {
  if (watching) return;
  watching = true;
  // Toda gravação local muda `updatedAt` ou a contagem: dispara um envio.
  liveQuery(() =>
    Promise.all(
      TABLES.map(async (t) => {
        const rows = await table(t).toArray();
        return `${rows.length}:${rows.reduce((m, r) => (String(r.updatedAt) > m ? String(r.updatedAt) : m), '')}`;
      }),
    ).then((parts) => parts.join('|')),
  ).subscribe({ next: () => scheduleSync(), error: (e: unknown) => setStatus({ state: 'error', detail: errorText(e) }) });
}

let timer: ReturnType<typeof setTimeout> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSync(delay = 600) {
  clearTimeout(timer);
  timer = setTimeout(() => void serial(push), delay);
}

/** Força uma rodada de sincronização agora. */
export function syncNow() {
  if (remote && initialLoaded) scheduleSync(0);
}

async function push() {
  const rdb = remote;
  if (!rdb || !initialLoaded) return;
  clearTimeout(retryTimer);
  try {
    const lr = localResetAt();
    if (lr > remoteResetAt) {
      setStatus({ state: 'saving' });
      await withRetry(() => rdb.collection(COLLECTION).doc(META_DOC).set({ resetAt: lr }));
      remoteResetAt = lr;
    }
    const writes = planPush(await readLocal(), remoteShards, effectiveReset());
    if (writes.length) setStatus({ state: 'saving' });
    for (const w of writes) {
      const records = JSON.parse(JSON.stringify(w.records)) as Record<string, Rec>;
      await withRetry(() => rdb.collection(COLLECTION).doc(w.shard).set({ table: w.table, records }));
      remoteShards.set(w.shard, { table: w.table, records });
    }
    setStatus({ state: 'synced', detail: '', lastSyncedAt: new Date().toISOString() });
  } catch (err) {
    setStatus({ state: 'error', detail: errorText(err) });
    retryTimer = setTimeout(() => scheduleSync(0), 10_000);
  }
}

async function withRetry(fn: () => Promise<void>, attempts = 4) {
  for (let n = 1; ; n++) {
    try {
      return await fn();
    } catch (err) {
      const code = (err as RemoteError)?.code;
      if (n >= attempts || (code !== 'unavailable' && code !== 'resource_exhausted')) throw err;
      await new Promise((r) => setTimeout(r, 1000 * n + Math.random() * 1000));
    }
  }
}

function errorText(err: unknown): string {
  const e = err as Partial<RemoteError> | undefined;
  if (e?.code === 'quota_exceeded') return 'Limite de armazenamento na nuvem atingido.';
  if (e?.code === 'resource_exhausted') return 'Muitas alterações seguidas; tentando de novo em instantes.';
  return e?.message ?? String(err);
}
