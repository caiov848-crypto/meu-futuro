import type { Cents, Goal, ISODate } from '../domain/types';
import { addDays, diffDays, endOfMonth, maxDate, minDate } from '../lib/date';
import { calculateLowestBalance, calculateProjectedBalance, statusOf, type FinanceModel } from './model';
import type { FinancialStatus } from './status';

/**
 * Janela usada para "quanto posso gastar": até o fim do mês,
 * ou até o fim do mês seguinte quando faltam menos de 7 dias.
 */
export function safeHorizon(date: ISODate): ISODate {
  const eom = endOfMonth(date);
  return diffDays(eom, date) < 7 ? endOfMonth(addDays(eom, 1)) : eom;
}

function floorFor(model: FinanceModel, safety?: Cents | null): Cents {
  return (safety ?? model.safetyLimit) + model.protectedTotal;
}

function clampDate(model: FinanceModel, date: ISODate): ISODate {
  return minDate(maxDate(date, model.today), model.horizonEnd);
}

export interface SafeSpending {
  amount: Cents;
  perDay: Cents;
  until: ISODate;
  limitingDate: ISODate;
  floor: Cents;
  status: FinancialStatus;
}

/** Quanto pode sair em `date` sem que o saldo fique abaixo da segurança até o fim da janela. */
export function calculateSafeSpending(model: FinanceModel, date = model.today, safety?: Cents | null): SafeSpending {
  const from = clampDate(model, date);
  const until = minDate(safeHorizon(from), model.horizonEnd);
  const floor = floorFor(model, safety);
  const low = calculateLowestBalance(model, from, until);
  const amount = Math.max(0, low.balance - floor);
  const days = diffDays(until, from) + 1;
  return {
    amount,
    perDay: Math.floor(amount / days),
    until,
    limitingDate: low.date,
    floor,
    status: statusOf(model, low.balance, floor),
  };
}

export interface SpendSimulation {
  amount: Cents;
  date: ISODate;
  floor: Cents;
  until: ISODate;
  balanceBefore: Cents;
  balanceAfter: Cents;
  lowestAfter: { date: ISODate; balance: Cents };
  /** Positivo = sobra acima da segurança; negativo = quanto ultrapassa. */
  margin: Cents;
  maxSafe: Cents;
  ok: boolean;
  status: FinancialStatus;
}

/** "Posso gastar?" — não altera nada, só responde. */
export function simulateSpend(
  model: FinanceModel,
  input: { amount: Cents; date: ISODate; safety?: Cents | null },
): SpendSimulation {
  const date = clampDate(model, input.date);
  const safe = calculateSafeSpending(model, date, input.safety);
  const low = calculateLowestBalance(model, date, safe.until);
  const balanceBefore = calculateProjectedBalance(model, date);
  const lowestBalance = low.balance - input.amount;
  const margin = lowestBalance - safe.floor;
  return {
    amount: input.amount,
    date,
    floor: safe.floor,
    until: safe.until,
    balanceBefore,
    balanceAfter: balanceBefore - input.amount,
    lowestAfter: { date: low.date, balance: lowestBalance },
    margin,
    maxSafe: safe.amount,
    ok: margin >= 0,
    status: statusOf(model, lowestBalance, safe.floor),
  };
}

export interface SavingsResult {
  amount: Cents;
  date: ISODate;
  safety: Cents;
  protectedTotal: Cents;
  projected: Cents;
  needed: Cents;
  shortfall: Cents;
  margin: Cents;
  guaranteed: boolean;
  /** Se, depois do gasto, algum dia seguinte cair abaixo da segurança. */
  laterDip: { date: ISODate; balance: Cents } | null;
  daysLeft: number;
  isPast: boolean;
}

/** "Quanto preciso juntar?" — simulador reverso, sempre consultando a previsão atual. */
export function calculateRequiredSavings(
  model: FinanceModel,
  input: { amount: Cents; date: ISODate; safety?: Cents | null },
): SavingsResult {
  const isPast = input.date < model.today;
  const date = clampDate(model, input.date);
  const safety = input.safety ?? model.safetyLimit;
  const floor = safety + model.protectedTotal;
  const projected = calculateProjectedBalance(model, date);
  const needed = input.amount + floor;
  const shortfall = Math.max(0, needed - projected);

  let laterDip: SavingsResult['laterDip'] = null;
  const windowEnd = minDate(addDays(date, 30), model.horizonEnd);
  if (windowEnd > date) {
    const low = calculateLowestBalance(model, addDays(date, 1), windowEnd);
    if (low.balance - input.amount < floor) laterDip = { date: low.date, balance: low.balance - input.amount };
  }

  return {
    amount: input.amount,
    date,
    safety,
    protectedTotal: model.protectedTotal,
    projected,
    needed,
    shortfall,
    margin: projected - needed,
    guaranteed: shortfall === 0,
    laterDip,
    daysLeft: Math.max(0, diffDays(date, model.today)),
    isPast,
  };
}

export interface GoalStatus extends SavingsResult {
  goal: Goal;
  state: 'guaranteed' | 'at-risk' | 'past';
}

/** Meta dinâmica: recalculada a cada mudança da previsão. Nunca guarda o "falta" fixo. */
export function calculateGoalStatus(model: FinanceModel, goal: Goal): GoalStatus {
  const r = calculateRequiredSavings(model, { amount: goal.amount, date: goal.date, safety: goal.safetyOverride });
  return { ...r, goal, state: r.isPast ? 'past' : r.guaranteed ? 'guaranteed' : 'at-risk' };
}
