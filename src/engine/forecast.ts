import type {
  Account, Cents, Certainty, Direction, ISODate, PaymentMethod, Snapshot, Transaction,
} from '../domain/types';
import { addDays, diffDays, maxDate } from '../lib/date';
import { occurrencesBetween } from './recurrence';

/** Quantos dias para trás uma ocorrência recorrente não paga ainda conta como atrasada. */
export const OVERDUE_LOOKBACK_DAYS = 60;

/** Um movimento que ainda vai afetar o saldo. */
export interface PendingEvent {
  key: string;
  txId: string | null;
  ruleId: string | null;
  occurrenceDate: ISODate | null;
  direction: Direction;
  amount: Cents;
  /** Valor considerado na previsão, após o peso de certeza. */
  weighted: Cents;
  categoryId: string;
  description: string;
  accountId: string | null;
  paymentMethod: PaymentMethod | null;
  certainty: Certainty;
  /** Data em que deveria acontecer. */
  originalDate: ISODate;
  /** Data em que entra na previsão (atrasados entram hoje). */
  date: ISODate;
  overdue: boolean;
}

export interface ForecastDay {
  date: ISODate;
  opening: Cents;
  inflow: Cents;
  outflow: Cents;
  closing: Cents;
  events: PendingEvent[];
}

export const signed = (direction: Direction, amount: Cents) => (direction === 'in' ? amount : -amount);

function activeAccountIds(accounts: Account[]): Set<string> {
  return new Set(accounts.filter((a) => !a.deletedAt).map((a) => a.id));
}

function belongsToActive(tx: Transaction, active: Set<string>): boolean {
  return !tx.deletedAt && (tx.accountId === null || active.has(tx.accountId));
}

const isRealized = (tx: Transaction, today: ISODate) => tx.status === 'done' && tx.date <= today;

export interface AccountBalance {
  account: Account;
  balance: Cents;
}

export function calculateAccountBalances(snapshot: Snapshot, today: ISODate): AccountBalance[] {
  const active = snapshot.accounts.filter((a) => !a.deletedAt).sort((a, b) => a.order - b.order);
  const totals = new Map(active.map((a) => [a.id, a.openingBalance]));
  for (const tx of snapshot.transactions) {
    if (tx.deletedAt || !tx.accountId || !isRealized(tx, today)) continue;
    const current = totals.get(tx.accountId);
    if (current !== undefined) totals.set(tx.accountId, current + signed(tx.direction, tx.amount));
  }
  return active.map((account) => ({ account, balance: totals.get(account.id) ?? 0 }));
}

/** Saldo real: dinheiro que existe agora. */
export function calculateCurrentBalance(snapshot: Snapshot, today: ISODate): Cents {
  const active = activeAccountIds(snapshot.accounts);
  let total = 0;
  for (const a of snapshot.accounts) if (!a.deletedAt) total += a.openingBalance;
  for (const tx of snapshot.transactions) {
    if (belongsToActive(tx, active) && isRealized(tx, today)) total += signed(tx.direction, tx.amount);
  }
  return total;
}

/** Todos os movimentos futuros (e atrasados) até `end`, em ordem cronológica. */
export function collectPendingEvents(snapshot: Snapshot, today: ISODate, end: ISODate): PendingEvent[] {
  const active = activeAccountIds(snapshot.accounts);
  const weights = snapshot.settings.certaintyWeights;
  const events: PendingEvent[] = [];
  const materialized = new Set<string>();

  const push = (e: Omit<PendingEvent, 'weighted' | 'date' | 'overdue'>) => {
    const overdue = e.originalDate < today;
    const weight = weights[e.certainty]?.[e.direction] ?? 1;
    events.push({ ...e, weighted: Math.round(e.amount * weight), date: maxDate(e.originalDate, today), overdue });
  };

  for (const tx of snapshot.transactions) {
    if (tx.deletedAt) continue;
    if (tx.recurrenceId && tx.occurrenceDate) materialized.add(`${tx.recurrenceId}|${tx.occurrenceDate}`);
    if (!belongsToActive(tx, active) || tx.date > end) continue;
    const pending = tx.status === 'planned' || (tx.status === 'done' && tx.date > today);
    if (!pending) continue;
    push({
      key: `tx:${tx.id}`,
      txId: tx.id,
      ruleId: tx.recurrenceId,
      occurrenceDate: tx.occurrenceDate,
      direction: tx.direction,
      amount: tx.amount,
      categoryId: tx.categoryId,
      description: tx.description,
      accountId: tx.accountId,
      paymentMethod: tx.paymentMethod,
      certainty: tx.status === 'done' ? 'confirmed' : tx.certainty,
      originalDate: tx.date,
    });
  }

  const lookback = addDays(today, -OVERDUE_LOOKBACK_DAYS);
  for (const rule of snapshot.rules) {
    if (rule.deletedAt) continue;
    const t = rule.template;
    if (t.accountId && !active.has(t.accountId)) continue;
    for (const date of occurrencesBetween(rule, lookback, end)) {
      if (materialized.has(`${rule.id}|${date}`)) continue;
      push({
        key: `rule:${rule.id}:${date}`,
        txId: null,
        ruleId: rule.id,
        occurrenceDate: date,
        direction: t.direction,
        amount: t.amount,
        categoryId: t.categoryId,
        description: t.description,
        accountId: t.accountId,
        paymentMethod: t.paymentMethod,
        certainty: t.certainty,
        originalDate: date,
      });
    }
  }

  return events.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.originalDate.localeCompare(b.originalDate) ||
      (a.direction === b.direction ? 0 : a.direction === 'in' ? -1 : 1),
  );
}

/** Saldo projetado dia a dia, de `today` até `end`. */
export function calculateForecast(
  startBalance: Cents,
  events: PendingEvent[],
  today: ISODate,
  end: ISODate,
): ForecastDay[] {
  const length = diffDays(end, today) + 1;
  const days: ForecastDay[] = new Array(Math.max(0, length));
  let balance = startBalance;
  let cursor = 0;
  for (let i = 0; i < length; i++) {
    const date = addDays(today, i);
    const opening = balance;
    let inflow = 0;
    let outflow = 0;
    const dayEvents: PendingEvent[] = [];
    while (cursor < events.length && events[cursor].date === date) {
      const e = events[cursor++];
      if (e.direction === 'in') inflow += e.weighted;
      else outflow += e.weighted;
      dayEvents.push(e);
    }
    balance = opening + inflow - outflow;
    days[i] = { date, opening, inflow, outflow, closing: balance, events: dayEvents };
  }
  return days;
}
