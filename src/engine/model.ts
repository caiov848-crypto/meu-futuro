import type { Cents, ISODate, Snapshot, Transaction } from '../domain/types';
import { addDays, endOfMonth, maxDate } from '../lib/date';
import {
  calculateAccountBalances, calculateCurrentBalance, calculateForecast, collectPendingEvents,
  type AccountBalance, type ForecastDay, type PendingEvent,
} from './forecast';
import { financialStatus, resolveAttentionMargin, type FinancialStatus } from './status';

/** Horizonte mínimo da previsão. Simuladores aceitam datas até aqui. */
export const HORIZON_DAYS = 400;

/**
 * O modelo financeiro calculado uma única vez por mudança de dados.
 * Toda a interface lê daqui — nenhuma tela refaz contas.
 */
export interface FinanceModel {
  today: ISODate;
  horizonEnd: ISODate;
  currentBalance: Cents;
  accountBalances: AccountBalance[];
  unassignedBalance: Cents;
  protectedTotal: Cents;
  freeBalance: Cents;
  safetyLimit: Cents;
  attentionMargin: Cents;
  /** Segurança + dinheiro protegido: a linha que o saldo não deve cruzar. */
  floor: Cents;
  events: PendingEvent[];
  days: ForecastDay[];
  todayDone: Transaction[];
}

export function buildFinanceModel(snapshot: Snapshot, today: ISODate): FinanceModel {
  const goalsEnd = snapshot.goals
    .filter((g) => !g.deletedAt)
    .reduce((acc, g) => maxDate(acc, addDays(g.date, 45)), today);
  const horizonEnd = maxDate(addDays(today, HORIZON_DAYS), goalsEnd);

  const currentBalance = calculateCurrentBalance(snapshot, today);
  const accountBalances = calculateAccountBalances(snapshot, today);
  const assigned = accountBalances.reduce((s, a) => s + a.balance, 0);
  const protectedTotal = snapshot.protectedMoney.filter((p) => !p.deletedAt).reduce((s, p) => s + p.amount, 0);
  const { safetyLimit, attentionMargin } = snapshot.settings;
  const events = collectPendingEvents(snapshot, today, horizonEnd);

  return {
    today,
    horizonEnd,
    currentBalance,
    accountBalances,
    unassignedBalance: currentBalance - assigned,
    protectedTotal,
    freeBalance: currentBalance - protectedTotal,
    safetyLimit,
    attentionMargin: resolveAttentionMargin(safetyLimit, attentionMargin),
    floor: safetyLimit + protectedTotal,
    events,
    days: calculateForecast(currentBalance, events, today, horizonEnd),
    todayDone: snapshot.transactions
      .filter((t) => !t.deletedAt && t.status === 'done' && t.date === today)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

/* ---------- Consultas sobre o modelo (O(1) / O(n) sem recalcular) ---------- */

function dayIndex(model: FinanceModel, date: ISODate): number {
  if (date <= model.today) return 0;
  const idx = Math.round((Date.parse(date) - Date.parse(model.today)) / 86_400_000);
  return Math.min(idx, model.days.length - 1);
}

export function getDay(model: FinanceModel, date: ISODate): ForecastDay {
  return model.days[dayIndex(model, date)];
}

/** Saldo projetado ao fim do dia `date`. */
export function calculateProjectedBalance(model: FinanceModel, date: ISODate): Cents {
  return getDay(model, date).closing;
}

export interface Breakdown {
  date: ISODate;
  startBalance: Cents;
  inflows: Cents;
  outflows: Cents;
  result: Cents;
  events: PendingEvent[];
}

/** Explica o saldo projetado: saldo atual + entradas − saídas até a data. */
export function explainProjectedBalance(model: FinanceModel, date: ISODate): Breakdown {
  const end = dayIndex(model, date);
  let inflows = 0;
  let outflows = 0;
  const events: PendingEvent[] = [];
  for (let i = 0; i <= end; i++) {
    const d = model.days[i];
    inflows += d.inflow;
    outflows += d.outflow;
    events.push(...d.events);
  }
  return {
    date: model.days[end].date,
    startBalance: model.currentBalance,
    inflows,
    outflows,
    result: model.days[end].closing,
    events,
  };
}

export interface LowPoint {
  date: ISODate;
  balance: Cents;
  status: FinancialStatus;
}

/** Menor saldo previsto no intervalo (primeira ocorrência em caso de empate). */
export function calculateLowestBalance(model: FinanceModel, from: ISODate, to: ISODate): LowPoint {
  const start = dayIndex(model, from);
  const end = dayIndex(model, to);
  let best = model.days[start];
  for (let i = start + 1; i <= end; i++) if (model.days[i].closing < best.closing) best = model.days[i];
  return { date: best.date, balance: best.closing, status: statusOf(model, best.closing) };
}

export function statusOf(model: FinanceModel, balance: Cents, floor = model.floor): FinancialStatus {
  return financialStatus(balance, floor, model.attentionMargin);
}

export function monthEnd(model: FinanceModel) {
  const date = endOfMonth(model.today);
  const balance = calculateProjectedBalance(model, date);
  return { date, balance, status: statusOf(model, balance) };
}

/** Primeiro dia em que o saldo fica abaixo do piso, dentro do intervalo. */
export function firstRiskDay(model: FinanceModel, from: ISODate, to: ISODate): ForecastDay | null {
  const end = dayIndex(model, to);
  for (let i = dayIndex(model, from); i <= end; i++) if (model.days[i].closing < model.floor) return model.days[i];
  return null;
}
