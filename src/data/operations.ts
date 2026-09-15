/**
 * Operações de escrita puras: recebem o estado atual e devolvem as mudanças.
 * O repositório só aplica o resultado no banco — assim a lógica é testável sem IndexedDB.
 */
import type {
  Account, Cents, Certainty, Frequency, ISODate, PaymentMethod, RecurringRule, Transaction, TxTemplate,
} from '../domain/types';
import type { PendingEvent } from '../engine/forecast';
import { addDays, diffDays } from '../lib/date';

export interface Changes {
  transactions: Transaction[];
  rules: RecurringRule[];
}

export interface Ctx {
  now: string;
  today: ISODate;
  newId: () => string;
}

export type EntryMode = 'spent' | 'received' | 'willSpend' | 'willReceive';
export type EditScope = 'this' | 'following' | 'all';

export interface EntryInput {
  mode: EntryMode;
  amount: Cents;
  categoryId: string;
  description: string;
  date: ISODate;
  accountId: string | null;
  paymentMethod: PaymentMethod | null;
  certainty: Certainty;
  note: string;
  recurrence: Frequency | null;
}

export const modeDirection = (m: EntryMode) => (m === 'spent' || m === 'willSpend' ? 'out' : 'in');
export const modeStatus = (m: EntryMode) => (m === 'spent' || m === 'received' ? 'done' : 'planned');

function templateOf(input: EntryInput): TxTemplate {
  return {
    direction: modeDirection(input.mode),
    amount: input.amount,
    categoryId: input.categoryId,
    description: input.description.trim(),
    accountId: input.accountId,
    paymentMethod: input.paymentMethod,
    certainty: modeStatus(input.mode) === 'done' ? 'confirmed' : input.certainty,
    note: input.note.trim(),
  };
}

function baseTx(ctx: Ctx, template: TxTemplate, extra: Partial<Transaction> & { date: ISODate }): Transaction {
  return {
    id: ctx.newId(),
    createdAt: ctx.now,
    updatedAt: ctx.now,
    deletedAt: null,
    ...template,
    status: 'planned',
    kind: 'regular',
    recurrenceId: null,
    occurrenceDate: null,
    ...extra,
  };
}

/** Novo lançamento (com ou sem recorrência). */
export function createEntry(input: EntryInput, ctx: Ctx): Changes {
  const template = templateOf(input);
  const status = modeStatus(input.mode);
  if (!input.recurrence) {
    return { transactions: [baseTx(ctx, template, { date: input.date, status })], rules: [] };
  }
  const rule: RecurringRule = {
    id: ctx.newId(),
    createdAt: ctx.now,
    updatedAt: ctx.now,
    deletedAt: null,
    template: { ...template, certainty: input.certainty },
    frequency: input.recurrence,
    interval: 1,
    startDate: input.date,
    endDate: null,
    skipDates: [],
  };
  // "Gastei/Recebi" + recorrência: a primeira ocorrência já aconteceu.
  const transactions =
    status === 'done'
      ? [baseTx(ctx, template, { date: input.date, status, recurrenceId: rule.id, occurrenceDate: input.date })]
      : [];
  return { transactions, rules: [rule] };
}

export type TxPatch = Partial<TxTemplate> & { date?: ISODate; status?: Transaction['status'] };

const TEMPLATE_KEYS: (keyof TxTemplate)[] = [
  'direction', 'amount', 'categoryId', 'description', 'accountId', 'paymentMethod', 'certainty', 'note',
];

function pickTemplate(patch: TxPatch): Partial<TxTemplate> {
  const out: Partial<TxTemplate> = {};
  for (const k of TEMPLATE_KEYS) if (patch[k] !== undefined) (out as Record<string, unknown>)[k] = patch[k];
  return out;
}

export function updateTransaction(tx: Transaction, patch: TxPatch, ctx: Ctx): Changes {
  return { transactions: [{ ...tx, ...patch, updatedAt: ctx.now }], rules: [] };
}

export function deleteTransaction(tx: Transaction, ctx: Ctx): Changes {
  return { transactions: [{ ...tx, deletedAt: ctx.now, updatedAt: ctx.now }], rules: [] };
}

/** Referência a uma ocorrência de uma série (materializada ou virtual). */
export interface OccurrenceRef {
  rule: RecurringRule;
  occurrenceDate: ISODate;
  /** Todos os lançamentos já materializados desta série. */
  seriesTxs: Transaction[];
}

function materialize(ref: OccurrenceRef, ctx: Ctx, extra: Partial<Transaction>): Transaction {
  return baseTx(ctx, ref.rule.template, {
    date: ref.occurrenceDate,
    recurrenceId: ref.rule.id,
    occurrenceDate: ref.occurrenceDate,
    ...extra,
  });
}

const alive = (txs: Transaction[]) => txs.filter((t) => !t.deletedAt);

/** Editar uma ocorrência: só esta, esta e as próximas, ou a série inteira. */
export function editOccurrence(ref: OccurrenceRef, scope: EditScope, patch: TxPatch, ctx: Ctx): Changes {
  const { rule, occurrenceDate } = ref;
  const existing = alive(ref.seriesTxs).find((t) => t.occurrenceDate === occurrenceDate) ?? null;

  if (scope === 'this') {
    const tx = existing ? { ...existing, ...patch, updatedAt: ctx.now } : materialize(ref, ctx, patch);
    return { transactions: [tx], rules: [] };
  }

  if (scope === 'following' && occurrenceDate <= rule.startDate) scope = 'all';
  const templatePatch = pickTemplate(patch);
  const shift = patch.date ? diffDays(patch.date, occurrenceDate) : 0;
  const transactions: Transaction[] = [];

  if (scope === 'following') {
    const newRule: RecurringRule = {
      ...rule,
      id: ctx.newId(),
      createdAt: ctx.now,
      updatedAt: ctx.now,
      template: { ...rule.template, ...templatePatch },
      startDate: addDays(occurrenceDate, shift),
      skipDates: rule.skipDates.filter((d) => d >= occurrenceDate).map((d) => addDays(d, shift)),
    };
    const oldRule: RecurringRule = {
      ...rule,
      endDate: addDays(occurrenceDate, -1),
      skipDates: rule.skipDates.filter((d) => d < occurrenceDate),
      updatedAt: ctx.now,
    };
    for (const tx of alive(ref.seriesTxs)) {
      if (!tx.occurrenceDate || tx.occurrenceDate < occurrenceDate) continue;
      if (tx.status === 'planned') {
        // Edições individuais futuras são substituídas pela nova regra.
        transactions.push({ ...tx, deletedAt: ctx.now, updatedAt: ctx.now });
      } else {
        transactions.push({
          ...tx,
          recurrenceId: newRule.id,
          occurrenceDate: addDays(tx.occurrenceDate, shift),
          updatedAt: ctx.now,
        });
      }
    }
    return { transactions, rules: [oldRule, newRule] };
  }

  // scope === 'all'
  const updated: RecurringRule = {
    ...rule,
    template: { ...rule.template, ...templatePatch },
    startDate: addDays(rule.startDate, shift),
    skipDates: rule.skipDates.map((d) => addDays(d, shift)),
    endDate: rule.endDate ? addDays(rule.endDate, shift) : null,
    updatedAt: ctx.now,
  };
  for (const tx of alive(ref.seriesTxs)) {
    if (!tx.occurrenceDate) continue;
    if (tx.status === 'planned') transactions.push({ ...tx, deletedAt: ctx.now, updatedAt: ctx.now });
    else if (shift) transactions.push({ ...tx, occurrenceDate: addDays(tx.occurrenceDate, shift), updatedAt: ctx.now });
  }
  return { transactions, rules: [updated] };
}

/** Excluir uma ocorrência: só esta, esta e as próximas, ou a série inteira (histórico pago é mantido). */
export function deleteOccurrence(ref: OccurrenceRef, scope: EditScope, ctx: Ctx): Changes {
  const { rule, occurrenceDate } = ref;
  if (scope === 'following' && occurrenceDate <= rule.startDate) scope = 'all';
  const txs = alive(ref.seriesTxs);
  const kill = (t: Transaction): Transaction => ({ ...t, deletedAt: ctx.now, updatedAt: ctx.now });

  if (scope === 'this') {
    const tx = txs.find((t) => t.occurrenceDate === occurrenceDate);
    return {
      transactions: tx ? [kill(tx)] : [],
      rules: [{ ...rule, skipDates: [...new Set([...rule.skipDates, occurrenceDate])], updatedAt: ctx.now }],
    };
  }
  if (scope === 'following') {
    return {
      transactions: txs.filter((t) => t.status === 'planned' && (t.occurrenceDate ?? '') >= occurrenceDate).map(kill),
      rules: [{ ...rule, endDate: addDays(occurrenceDate, -1), updatedAt: ctx.now }],
    };
  }
  return {
    transactions: txs.filter((t) => t.status === 'planned').map(kill),
    rules: [{ ...rule, deletedAt: ctx.now, updatedAt: ctx.now }],
  };
}

/** "Marcar como pago/recebido": o dinheiro sai/entra hoje. */
export function markEventDone(event: PendingEvent, snapshotTxs: Transaction[], rules: RecurringRule[], ctx: Ctx): Changes {
  if (event.txId) {
    const tx = snapshotTxs.find((t) => t.id === event.txId);
    if (!tx) return { transactions: [], rules: [] };
    return { transactions: [{ ...tx, status: 'done', date: ctx.today, certainty: 'confirmed', updatedAt: ctx.now }], rules: [] };
  }
  const rule = rules.find((r) => r.id === event.ruleId);
  if (!rule || !event.occurrenceDate) return { transactions: [], rules: [] };
  const ref = { rule, occurrenceDate: event.occurrenceDate, seriesTxs: [] };
  return {
    transactions: [materialize(ref, ctx, { status: 'done', date: ctx.today, certainty: 'confirmed' })],
    rules: [],
  };
}

/** Ajustar saldo real de uma conta: registra a diferença como lançamento de ajuste. */
export function adjustAccountBalance(account: Account, currentBalance: Cents, target: Cents, ctx: Ctx): Changes {
  const diff = target - currentBalance;
  if (diff === 0) return { transactions: [], rules: [] };
  const tx = baseTx(
    ctx,
    {
      direction: diff > 0 ? 'in' : 'out',
      amount: Math.abs(diff),
      categoryId: 'adjustment',
      description: 'Ajuste de saldo',
      accountId: account.id,
      paymentMethod: null,
      certainty: 'confirmed',
      note: '',
    },
    { date: ctx.today, status: 'done', kind: 'adjustment' },
  );
  return { transactions: [tx], rules: [] };
}
