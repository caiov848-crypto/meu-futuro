/**
 * Repositório: única porta de escrita da interface para o banco.
 * A lógica vive em `operations.ts` (pura); aqui só lemos o necessário e gravamos.
 */
import type {
  Account, Category, Cents, Goal, ProtectedMoney, Settings, Snapshot, Transaction,
} from '../domain/types';
import { ADJUSTMENT_CATEGORY, DEFAULT_CATEGORIES, defaultSettings } from '../domain/defaults';
import type { PendingEvent } from '../engine/forecast';
import { calculateCurrentBalance } from '../engine/forecast';
import { todayISO } from '../lib/date';
import { newId, nowStamp } from '../lib/id';
import { db } from './db';
import {
  adjustAccountBalance, createEntry, deleteOccurrence, deleteTransaction, editOccurrence, markEventDone,
  modeDirection, modeStatus, updateTransaction,
  type Changes, type Ctx, type EditScope, type EntryInput, type TxPatch,
} from './operations';
import { buildDemoSnapshot } from './seed';
import { markLocalReset } from './sync';

const ctx = (): Ctx => ({ now: nowStamp(), today: todayISO(), newId });

async function commit(c: Changes) {
  await db.transaction('rw', db.transactions, db.rules, async () => {
    if (c.transactions.length) await db.transactions.bulkPut(c.transactions);
    if (c.rules.length) await db.rules.bulkPut(c.rules);
  });
}

export async function ensureInitialized() {
  await db.transaction('rw', db.settings, db.categories, async () => {
    if (!(await db.settings.get('settings'))) await db.settings.put(defaultSettings(newId()));
    if ((await db.categories.count()) === 0) await db.categories.bulkPut([...DEFAULT_CATEGORIES, ADJUSTMENT_CATEGORY]);
  });
  // Pede ao navegador para não descartar os dados locais.
  navigator.storage?.persist?.().catch(() => undefined);
}

/* ---------------- Lançamentos ---------------- */

/** O que está sendo editado: um lançamento gravado, uma ocorrência prevista, ou ambos. */
export interface EditTarget {
  tx: Transaction | null;
  event: PendingEvent | null;
}

export function seriesInfo(target: EditTarget) {
  const ruleId = target.event?.ruleId ?? target.tx?.recurrenceId ?? null;
  const occurrenceDate = target.event?.occurrenceDate ?? target.tx?.occurrenceDate ?? null;
  const pending = target.event !== null || target.tx?.status === 'planned';
  return { ruleId, occurrenceDate, isSeries: Boolean(ruleId && occurrenceDate && pending) };
}

async function occurrenceRef(ruleId: string, occurrenceDate: string) {
  const rule = await db.rules.get(ruleId);
  if (!rule) return null;
  const seriesTxs = await db.transactions.where('recurrenceId').equals(ruleId).toArray();
  return { rule, occurrenceDate, seriesTxs };
}

function entryToPatch(input: EntryInput): TxPatch {
  const status = modeStatus(input.mode);
  return {
    direction: modeDirection(input.mode),
    amount: input.amount,
    categoryId: input.categoryId,
    description: input.description.trim(),
    accountId: input.accountId,
    paymentMethod: input.paymentMethod,
    certainty: status === 'done' ? 'confirmed' : input.certainty,
    note: input.note.trim(),
    date: input.date,
    status,
  };
}

export async function saveEntry(input: EntryInput) {
  await commit(createEntry(input, ctx()));
}

export async function updateEntry(target: EditTarget, input: EntryInput, scope: EditScope) {
  const c = ctx();
  const patch = entryToPatch(input);
  const info = seriesInfo(target);
  if (info.isSeries) {
    const ref = await occurrenceRef(info.ruleId!, info.occurrenceDate!);
    if (ref) return commit(editOccurrence(ref, scope, patch, c));
  }
  if (!target.tx) return;
  if (input.recurrence && !target.tx.recurrenceId) {
    // Transformar um lançamento avulso em série.
    const created = createEntry(input, c);
    const removed = deleteTransaction(target.tx, c);
    return commit({ transactions: [...removed.transactions, ...created.transactions], rules: created.rules });
  }
  return commit(updateTransaction(target.tx, patch, c));
}

export async function deleteEntry(target: EditTarget, scope: EditScope) {
  const c = ctx();
  const info = seriesInfo(target);
  if (info.isSeries) {
    const ref = await occurrenceRef(info.ruleId!, info.occurrenceDate!);
    if (ref) return commit(deleteOccurrence(ref, scope, c));
  }
  if (target.tx) return commit(deleteTransaction(target.tx, c));
}

export async function markDone(event: PendingEvent) {
  const [transactions, rules] = await Promise.all([db.transactions.toArray(), db.rules.toArray()]);
  await commit(markEventDone(event, transactions, rules, ctx()));
}

/* ---------------- Contas ---------------- */

export async function saveAccount(input: Pick<Account, 'name' | 'type' | 'color'> & { id?: string; balance: Cents }) {
  const c = ctx();
  if (!input.id) {
    const order = await db.accounts.count();
    await db.accounts.put({
      id: c.newId(), name: input.name.trim(), type: input.type, color: input.color, openingBalance: input.balance,
      order, createdAt: c.now, updatedAt: c.now, deletedAt: null,
    });
    return;
  }
  const account = await db.accounts.get(input.id);
  if (!account) return;
  const updated = { ...account, name: input.name.trim(), type: input.type, color: input.color, updatedAt: c.now };
  const current = await currentAccountBalance(account.id);
  await db.transaction('rw', db.accounts, db.transactions, db.rules, async () => {
    await db.accounts.put(updated);
    await commit(adjustAccountBalance(updated, current, input.balance, c));
  });
}

async function currentAccountBalance(accountId: string): Promise<Cents> {
  const [account, transactions] = await Promise.all([
    db.accounts.get(accountId),
    db.transactions.where('status').equals('done').toArray(),
  ]);
  if (!account) return 0;
  const snap = { accounts: [account], transactions: transactions.filter((t) => t.accountId === accountId) } as Snapshot;
  return calculateCurrentBalance(snap, todayISO());
}

export async function deleteAccount(id: string) {
  const account = await db.accounts.get(id);
  if (account) await db.accounts.put({ ...account, deletedAt: nowStamp(), updatedAt: nowStamp() });
}

/* ---------------- Metas, proteção, reserva, ajustes ---------------- */

export async function saveGoal(input: Pick<Goal, 'name' | 'amount' | 'date' | 'safetyOverride'> & { id?: string }) {
  const c = ctx();
  const existing = input.id ? await db.goals.get(input.id) : undefined;
  await db.goals.put({
    id: existing?.id ?? c.newId(),
    createdAt: existing?.createdAt ?? c.now,
    deletedAt: null,
    ...input,
    name: input.name.trim() || 'Meta',
    updatedAt: c.now,
  });
}

export async function deleteGoal(id: string) {
  const goal = await db.goals.get(id);
  if (goal) await db.goals.put({ ...goal, deletedAt: nowStamp(), updatedAt: nowStamp() });
}

export async function saveProtected(input: Pick<ProtectedMoney, 'name' | 'amount'> & { id?: string }) {
  const c = ctx();
  const existing = input.id ? await db.protectedMoney.get(input.id) : undefined;
  await db.protectedMoney.put({
    id: existing?.id ?? c.newId(),
    createdAt: existing?.createdAt ?? c.now,
    deletedAt: null,
    name: input.name.trim() || 'Separado',
    amount: input.amount,
    updatedAt: c.now,
  });
}

export async function deleteProtected(id: string) {
  const p = await db.protectedMoney.get(id);
  if (p) await db.protectedMoney.put({ ...p, deletedAt: nowStamp(), updatedAt: nowStamp() });
}

export async function updateSettings(patch: Partial<Omit<Settings, 'id'>>) {
  const current = await db.settings.get('settings');
  if (current) await db.settings.put({ ...current, ...patch, updatedAt: nowStamp() });
}

export async function saveCategory(input: Pick<Category, 'name' | 'emoji' | 'kind'>) {
  const c = ctx();
  const order = await db.categories.count();
  await db.categories.put({
    id: c.newId(), ...input, name: input.name.trim(), order: order + 10, builtin: false,
    createdAt: c.now, updatedAt: c.now, deletedAt: null,
  });
}

/* ---------------- Dados ---------------- */

async function replaceAll(snapshot: Snapshot) {
  // Carimba tudo com agora: numa substituição (backup, exemplo), estes dados vencem nos outros aparelhos.
  const now = nowStamp();
  markLocalReset(now);
  const stamp = <T extends { updatedAt: string }>(list: T[]) => list.map((r) => ({ ...r, updatedAt: now }));
  const s: Snapshot = {
    accounts: stamp(snapshot.accounts),
    transactions: stamp(snapshot.transactions),
    rules: stamp(snapshot.rules),
    categories: stamp(snapshot.categories),
    goals: stamp(snapshot.goals),
    protectedMoney: stamp(snapshot.protectedMoney),
    settings: { ...snapshot.settings, updatedAt: now },
  };
  await db.transaction('rw', db.dataTables, async () => {
    await Promise.all(db.dataTables.map((t) => t.clear()));
    await db.accounts.bulkPut(s.accounts);
    await db.transactions.bulkPut(s.transactions);
    await db.rules.bulkPut(s.rules);
    await db.categories.bulkPut(s.categories);
    await db.goals.bulkPut(s.goals);
    await db.protectedMoney.bulkPut(s.protectedMoney);
    await db.settings.put(s.settings);
  });
}

export async function loadDemo() {
  const settings = await db.settings.get('settings');
  await replaceAll(buildDemoSnapshot(todayISO(), newId, nowStamp(), settings?.userId ?? newId()));
}

export async function resetAll() {
  const now = nowStamp();
  markLocalReset(now);
  await db.transaction('rw', db.dataTables, async () => {
    await Promise.all(db.dataTables.map((t) => t.clear()));
  });
  await ensureInitialized();
  // Padrões recém-criados precisam valer também nos outros aparelhos.
  await db.transaction('rw', db.settings, db.categories, async () => {
    await db.settings.update('settings', { updatedAt: now });
    const cats = await db.categories.toArray();
    await db.categories.bulkPut(cats.map((c) => ({ ...c, updatedAt: now })));
  });
}

export async function completeOnboarding(input: { accountName: string; balance: Cents; safetyLimit: Cents }) {
  await saveAccount({ name: input.accountName || 'Minha conta', type: 'bank', color: '#3B82F6', balance: input.balance });
  await updateSettings({ safetyLimit: input.safetyLimit, onboarded: true });
}

const BACKUP_FORMAT = 'meu-futuro-backup';

export async function exportBackup(): Promise<string> {
  const [accounts, transactions, rules, categories, goals, protectedMoney, settings] = await Promise.all(
    db.dataTables.map((t) => t.toArray()),
  );
  return JSON.stringify(
    { format: BACKUP_FORMAT, version: 1, exportedAt: nowStamp(), data: { accounts, transactions, rules, categories, goals, protectedMoney, settings: settings[0] } },
    null,
    2,
  );
}

export async function importBackup(text: string) {
  const parsed = JSON.parse(text);
  if (parsed?.format !== BACKUP_FORMAT || !parsed.data?.settings) throw new Error('Arquivo de backup inválido.');
  const d = parsed.data;
  const list = (x: unknown) => (Array.isArray(x) ? x : []);
  await replaceAll({
    accounts: list(d.accounts),
    transactions: list(d.transactions),
    rules: list(d.rules),
    categories: list(d.categories),
    goals: list(d.goals),
    protectedMoney: list(d.protectedMoney),
    settings: { ...defaultSettings(newId()), ...d.settings, id: 'settings' },
  });
}
