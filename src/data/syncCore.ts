/**
 * Peças comuns a qualquer forma de sincronização (claude.ai ou GitHub):
 * status observável, marca de substituição, leitura local e aplicação da nuvem.
 */
import { liveQuery, type Table } from 'dexie';
import { useSyncExternalStore } from 'react';
import { ADJUSTMENT_CATEGORY, DEFAULT_CATEGORIES, defaultSettings } from '../domain/defaults';
import { newId } from '../lib/id';
import { db } from './db';
import { planPull, TABLES, type Local, type Rec, type Shard, type TableName } from './syncMerge';

export type SyncState = 'local' | 'connecting' | 'synced' | 'saving' | 'error';
export type SyncBackend = 'none' | 'claude' | 'github';
export interface SyncStatus {
  state: SyncState;
  backend: SyncBackend;
  detail: string;
  lastSyncedAt: string | null;
}

let status: SyncStatus = { state: 'local', backend: 'none', detail: '', lastSyncedAt: null };
const listeners = new Set<() => void>();

export function setSyncStatus(patch: Partial<SyncStatus>) {
  const next = { ...status, ...patch };
  if (
    next.state === status.state && next.backend === status.backend &&
    next.detail === status.detail && next.lastSyncedAt === status.lastSyncedAt
  ) return;
  status = next;
  listeners.forEach((l) => l());
}

export const getSyncStatus = () => status;

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => status,
  );
}

/* ---------- Marca de substituição ---------- */

const RESET_KEY = 'meufuturo.resetAt';
let memoryResetAt = '';

export function localResetAt(): string {
  try {
    return localStorage.getItem(RESET_KEY) ?? memoryResetAt;
  } catch {
    return memoryResetAt;
  }
}

export function setLocalResetAt(at: string) {
  memoryResetAt = at;
  try {
    localStorage.setItem(RESET_KEY, at);
  } catch {
    /* sem localStorage: fica em memória */
  }
}

/* ---------- Dados locais ---------- */

export const localTable = (t: TableName) => db[t] as unknown as Table<Rec, string>;

export async function readLocal(): Promise<Local> {
  const rows = await Promise.all(TABLES.map((t) => localTable(t).toArray()));
  return Object.fromEntries(TABLES.map((t, i) => [t, rows[i]])) as unknown as Local;
}

/** Aplica localmente o que a nuvem tem de mais novo. */
export async function applyRemote(shards: Map<string, Shard>, resetAt: string) {
  const plan = planPull(await readLocal(), shards, resetAt);
  if (!TABLES.some((t) => plan.puts[t].length || plan.deletes[t].length)) return;
  await db.transaction('rw', TABLES.map(localTable), async () => {
    for (const t of TABLES) {
      if (plan.deletes[t].length) await localTable(t).bulkDelete(plan.deletes[t]);
      if (plan.puts[t].length) await localTable(t).bulkPut(plan.puts[t]);
    }
  });
}

/** Troca todos os dados deste aparelho pelos da nuvem. */
export async function replaceLocalWithRemote(shards: Map<string, Shard>, resetAt: string) {
  const empty = Object.fromEntries(TABLES.map((t) => [t, []])) as unknown as Local;
  const plan = planPull(empty, shards, resetAt);
  await db.transaction('rw', TABLES.map(localTable), async () => {
    for (const t of TABLES) {
      await localTable(t).clear();
      if (plan.puts[t].length) await localTable(t).bulkPut(plan.puts[t]);
    }
    // Nuvem sem ajustes/categorias (improvável): garante o mínimo para o app abrir.
    if ((await db.settings.count()) === 0) await db.settings.put(defaultSettings(newId()));
    if ((await db.categories.count()) === 0) await db.categories.bulkPut([...DEFAULT_CATEGORIES, ADJUSTMENT_CATEGORY]);
  });
  setLocalResetAt(resetAt);
}

/** Marca todos os registros deste aparelho como os mais recentes (para vencerem na nuvem). */
export async function restampAllLocal(now: string) {
  setLocalResetAt(now);
  await db.transaction('rw', TABLES.map(localTable), async () => {
    for (const t of TABLES) {
      const rows = await localTable(t).toArray();
      if (rows.length) await localTable(t).bulkPut(rows.map((r) => ({ ...r, updatedAt: now })));
    }
  });
}

export async function hasMeaningfulLocalData(): Promise<boolean> {
  const [accounts, transactions] = await Promise.all([db.accounts.count(), db.transactions.count()]);
  return accounts + transactions > 0;
}

/** Observa qualquer gravação local (todo registro atualiza `updatedAt`). */
export function watchLocal(onChange: () => void, onError: (e: unknown) => void): () => void {
  const sub = liveQuery(() =>
    Promise.all(
      TABLES.map(async (t) => {
        const rows = await localTable(t).toArray();
        return `${rows.length}:${rows.reduce((m, r) => (String(r.updatedAt) > m ? String(r.updatedAt) : m), '')}`;
      }),
    ).then((parts) => parts.join('|')),
  ).subscribe({ next: () => onChange(), error: onError });
  return () => sub.unsubscribe();
}

/** Fila única: aplicar e enviar nunca rodam ao mesmo tempo. */
export function createSerial() {
  let chain: Promise<unknown> = Promise.resolve();
  return <T,>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.then(fn, fn);
    chain = p.catch(() => undefined);
    return p;
  };
}
