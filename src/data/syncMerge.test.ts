import { describe, expect, it } from 'vitest';
import { applyShardWrites, planPull, planPush, shardOf, TABLES, type Local, type Rec, type Shard } from './syncMerge';

const empty = (): Local => Object.fromEntries(TABLES.map((t) => [t, []])) as unknown as Local;
const r = (id: string, updatedAt: string, date?: string): Rec => ({ id, updatedAt, ...(date ? { date } : {}) });
const shards = (...list: [string, Shard][]) => new Map(list);

describe('sincronização: blocos', () => {
  it('lançamentos são agrupados por quinzena', () => {
    expect(shardOf('transactions', r('a', '1', '2026-09-15'))).toBe('tx-2026-09-a');
    expect(shardOf('transactions', r('a', '1', '2026-09-16'))).toBe('tx-2026-09-b');
    expect(shardOf('accounts', r('a', '1'))).toBe('accounts');
  });
});

describe('sincronização: trazer da nuvem', () => {
  it('traz o que é mais novo e mantém o que é mais novo aqui', () => {
    const local = empty();
    local.accounts = [r('a1', '2026-09-15T10:00'), r('a2', '2026-09-15T12:00')];
    const remote = shards(['accounts', { table: 'accounts', records: { a1: r('a1', '2026-09-15T11:00'), a2: r('a2', '2026-09-15T09:00'), a3: r('a3', '2026-09-15T08:00') } }]);
    const plan = planPull(local, remote, '');
    expect(plan.puts.accounts.map((x) => x.id).sort()).toEqual(['a1', 'a3']);
    expect(plan.deletes.accounts).toEqual([]);
  });

  it('um aparelho novo recebe tudo e descarta os padrões antigos após uma substituição', () => {
    const local = empty();
    local.settings = [r('settings', '2026-01-01T00:00')];
    local.categories = [r('food', '2026-01-01T00:00'), r('mine', '2026-01-01T00:00')];
    const remote = shards(
      ['settings', { table: 'settings', records: { settings: r('settings', '2026-09-15T10:00') } }],
      ['categories', { table: 'categories', records: { food: r('food', '2026-09-15T10:00') } }],
    );
    const plan = planPull(local, remote, '2026-09-15T10:00');
    expect(plan.puts.settings.map((x) => x.id)).toEqual(['settings']);
    expect(plan.deletes.categories).toEqual(['mine']);
  });
});

describe('sincronização: enviar para a nuvem', () => {
  it('não grava nada quando já está igual', () => {
    const local = empty();
    local.accounts = [r('a1', 't1')];
    expect(planPush(local, shards(['accounts', { table: 'accounts', records: { a1: r('a1', 't1') } }]), '')).toEqual([]);
  });

  it('combina com a nuvem: não apaga o que o outro aparelho gravou', () => {
    const local = empty();
    local.transactions = [r('t1', '2026-09-15T10:00', '2026-09-03')];
    const remote = shards(['tx-2026-09-a', { table: 'transactions', records: { t2: r('t2', '2026-09-15T09:00', '2026-09-04') } }]);
    const [w] = planPush(local, remote, '');
    expect(w.shard).toBe('tx-2026-09-a');
    expect(Object.keys(w.records).sort()).toEqual(['t1', 't2']);
  });

  it('lançamento que mudou de data regrava os dois blocos', () => {
    const local = empty();
    local.transactions = [r('t1', '2026-09-15T11:00', '2026-09-20')];
    const remote = shards(['tx-2026-09-a', { table: 'transactions', records: { t1: r('t1', '2026-09-15T10:00', '2026-09-03') } }]);
    const writes = planPush(local, remote, '');
    expect(writes.find((w) => w.shard === 'tx-2026-09-a')?.records).toEqual({});
    expect(Object.keys(writes.find((w) => w.shard === 'tx-2026-09-b')!.records)).toEqual(['t1']);
  });

  it('aplicar gravações remove blocos vazios e atualiza os demais', () => {
    const local = empty();
    local.transactions = [r('t1', '2026-09-15T11:00', '2026-09-20')];
    const remote = shards(['tx-2026-09-a', { table: 'transactions', records: { t1: r('t1', '2026-09-15T10:00', '2026-09-03') } }]);
    const next = applyShardWrites(remote, planPush(local, remote, ''));
    expect([...next.keys()]).toEqual(['tx-2026-09-b']);
    expect(planPush(local, next, '')).toEqual([]);
  });

  it('substituição remove da nuvem os registros antigos', () => {
    const local = empty();
    local.accounts = [r('novo', '2026-09-15T12:00')];
    const remote = shards(['accounts', { table: 'accounts', records: { velho: r('velho', '2026-09-14T08:00') } }]);
    const [w] = planPush(local, remote, '2026-09-15T12:00');
    expect(Object.keys(w.records)).toEqual(['novo']);
  });
});
