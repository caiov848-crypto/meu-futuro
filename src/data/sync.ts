/**
 * Ponto de entrada da sincronização.
 * - Aberto pelo claude.ai: usa a capability `db` do Artifact.
 * - Em qualquer outro endereço (ex.: GitHub Pages): usa o Gist criptografado
 *   do GitHub, se o usuário conectou em Ajustes.
 * Sem nenhum dos dois, o app funciona só com os dados locais.
 */
import { connectFromLinkIfPresent, initGistSync, syncGistNow } from './gistSync';
import {
  applyRemote, createSerial, getSyncStatus, localResetAt, readLocal, setLocalResetAt, setSyncStatus, watchLocal,
} from './syncCore';
import { planPush, type Rec, type Shard, type TableName } from './syncMerge';

export { useSyncStatus, type SyncState, type SyncStatus } from './syncCore';

const COLLECTION = 'meufuturo_v2';
const META_DOC = 'meta';

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

/** Chamado antes de substituir todos os dados locais (backup, exemplo, apagar tudo). */
export function markLocalReset(at: string) {
  setLocalResetAt(at);
}

let remote: RemoteDB | null = null;
let remoteShards = new Map<string, Shard>();
let remoteResetAt = '';
let initialLoaded = false;
let started = false;
const serial = createSerial();
const effectiveReset = () => (localResetAt() > remoteResetAt ? localResetAt() : remoteResetAt);

/**
 * Conecta à nuvem disponível e espera a primeira leitura (até `timeoutMs`),
 * para um aparelho novo já abrir com os dados do outro.
 */
export async function initCloudSync(timeoutMs = 8000): Promise<void> {
  if (started) return;
  started = true;
  const claude = (window as unknown as { claude?: { use?: (name: string) => Promise<unknown> } }).claude;
  if (typeof claude?.use !== 'function') {
    // Um link pessoal de sincronização na URL tem prioridade: conecta sozinho, sem digitar nada.
    const task = connectFromLinkIfPresent().then((linked) => (linked ? undefined : initGistSync(timeoutMs)));
    await Promise.race([task, new Promise((r) => setTimeout(r, timeoutMs))]);
    return;
  }
  setSyncStatus({ state: 'connecting', backend: 'claude' });
  const ready = (async () => {
    const rdb = (await claude.use!('db')) as RemoteDB | null;
    if (!rdb) {
      setSyncStatus({ state: 'local', backend: 'none' });
      return;
    }
    remote = rdb;
    await connect(rdb);
  })().catch((err: unknown) => setSyncStatus({ state: 'error', detail: errorText(err) }));
  await Promise.race([ready, new Promise((r) => setTimeout(r, timeoutMs))]);
}

/** Força uma rodada de sincronização agora. */
export function syncNow() {
  if (getSyncStatus().backend === 'github') return syncGistNow();
  if (remote && initialLoaded) scheduleSync(0);
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
          await applyRemote(remoteShards, effectiveReset());
        }).then(
          () => {
            if (!initialLoaded) {
              initialLoaded = true;
              watchLocal(() => scheduleSync(), (e) => setSyncStatus({ state: 'error', detail: errorText(e) }));
              resolve();
            }
            scheduleSync();
          },
          (err) => {
            setSyncStatus({ state: 'error', detail: errorText(err) });
            resolve();
          },
        );
      },
      (e) => {
        setSyncStatus({ state: 'error', detail: e.message });
        resolve();
      },
    );
  });
}

let timer: ReturnType<typeof setTimeout> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSync(delay = 600) {
  clearTimeout(timer);
  timer = setTimeout(() => void serial(push), delay);
}

async function push() {
  const rdb = remote;
  if (!rdb || !initialLoaded) return;
  clearTimeout(retryTimer);
  try {
    const lr = localResetAt();
    if (lr > remoteResetAt) {
      setSyncStatus({ state: 'saving' });
      await withRetry(() => rdb.collection(COLLECTION).doc(META_DOC).set({ resetAt: lr }));
      remoteResetAt = lr;
    }
    const writes = planPush(await readLocal(), remoteShards, effectiveReset());
    if (writes.length) setSyncStatus({ state: 'saving' });
    for (const w of writes) {
      const records = JSON.parse(JSON.stringify(w.records)) as Record<string, Rec>;
      await withRetry(() => rdb.collection(COLLECTION).doc(w.shard).set({ table: w.table, records }));
      remoteShards.set(w.shard, { table: w.table, records });
    }
    setSyncStatus({ state: 'synced', detail: '', lastSyncedAt: new Date().toISOString() });
  } catch (err) {
    setSyncStatus({ state: 'error', detail: errorText(err) });
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
