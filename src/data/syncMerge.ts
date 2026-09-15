/**
 * Regras puras da sincronização (sem rede, sem banco) — testáveis.
 *
 * Na nuvem os dados ficam em poucos "blocos" (shards): um por tabela e,
 * para lançamentos, um por quinzena. Cada bloco guarda `records: {id: registro}`.
 * Conflitos: vence o registro com `updatedAt` mais recente.
 * Substituição (importar backup, exemplo, apagar tudo): `resetAt` — registros
 * mais antigos que ele são descartados em todos os aparelhos.
 */

export type TableName = 'accounts' | 'transactions' | 'rules' | 'categories' | 'goals' | 'protectedMoney' | 'settings';
export const TABLES: TableName[] = ['accounts', 'transactions', 'rules', 'categories', 'goals', 'protectedMoney', 'settings'];

export interface Rec {
  id: string;
  updatedAt: string;
  date?: string;
}

export type Local = Record<TableName, Rec[]>;

export interface Shard {
  table: TableName;
  records: Record<string, Rec>;
}

export function shardOf(table: TableName, rec: Rec): string {
  if (table !== 'transactions') return table;
  const date = typeof rec.date === 'string' && rec.date.length >= 10 ? rec.date : '0000-00-01';
  const half = Number(date.slice(8, 10)) <= 15 ? 'a' : 'b';
  return `tx-${date.slice(0, 7)}-${half}`;
}

const newer = (a: Rec, b: Rec | undefined) => !b || String(a.updatedAt) > String(b.updatedAt);
const alive = (r: Rec, resetAt: string) => !resetAt || String(r.updatedAt) >= resetAt;

function bestRemote(remote: Map<string, Shard>, resetAt: string): Map<TableName, Map<string, Rec>> {
  const best = new Map<TableName, Map<string, Rec>>(TABLES.map((t) => [t, new Map()]));
  for (const shard of remote.values()) {
    const byId = best.get(shard.table);
    if (!byId) continue;
    for (const rec of Object.values(shard.records ?? {})) {
      if (!rec || typeof rec.id !== 'string' || !alive(rec, resetAt)) continue;
      if (newer(rec, byId.get(rec.id))) byId.set(rec.id, rec);
    }
  }
  return best;
}

export interface PullPlan {
  puts: Record<TableName, Rec[]>;
  deletes: Record<TableName, string[]>;
}

/** O que gravar/apagar localmente para refletir a nuvem. */
export function planPull(local: Local, remote: Map<string, Shard>, resetAt: string): PullPlan {
  const best = bestRemote(remote, resetAt);
  const puts = {} as PullPlan['puts'];
  const deletes = {} as PullPlan['deletes'];
  for (const t of TABLES) {
    const localById = new Map(local[t].map((r) => [r.id, r]));
    const remoteById = best.get(t)!;
    puts[t] = [...remoteById.values()].filter((r) => newer(r, localById.get(r.id)));
    deletes[t] = local[t].filter((r) => !alive(r, resetAt) && !remoteById.has(r.id)).map((r) => r.id);
  }
  return { puts, deletes };
}

export interface ShardWrite {
  shard: string;
  table: TableName;
  records: Record<string, Rec>;
}

const signature = (records: Record<string, Rec>) =>
  Object.values(records)
    .map((r) => `${r.id}@${r.updatedAt}`)
    .sort()
    .join('|');

/** Blocos que precisam ser regravados na nuvem (já combinados com o que está lá). */
export function planPush(local: Local, remote: Map<string, Shard>, resetAt: string): ShardWrite[] {
  const best = bestRemote(remote, resetAt);
  const desired = new Map<string, ShardWrite>();
  const place = (t: TableName, rec: Rec) => {
    const shard = shardOf(t, rec);
    let w = desired.get(shard);
    if (!w) desired.set(shard, (w = { shard, table: t, records: {} }));
    w.records[rec.id] = rec;
  };

  for (const t of TABLES) {
    const merged = new Map<string, Rec>(best.get(t));
    for (const rec of local[t]) {
      if (alive(rec, resetAt) && newer(rec, merged.get(rec.id))) merged.set(rec.id, rec);
    }
    for (const rec of merged.values()) place(t, rec);
  }

  const writes: ShardWrite[] = [];
  const shards = new Set([...desired.keys(), ...remote.keys()]);
  for (const shard of shards) {
    const want = desired.get(shard);
    const have = remote.get(shard);
    if (!want) {
      // Bloco que ficou vazio (ex.: lançamento mudou de data, ou substituição).
      if (have && Object.keys(have.records ?? {}).length > 0) writes.push({ shard, table: have.table, records: {} });
      continue;
    }
    if (!have || signature(have.records ?? {}) !== signature(want.records)) writes.push(want);
  }
  return writes;
}
