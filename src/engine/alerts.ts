import type { Cents, ISODate } from '../domain/types';
import type { PendingEvent } from './forecast';
import { firstRiskDay, type FinanceModel } from './model';
import { safeHorizon, type GoalStatus } from './simulators';
import { addDays, maxDate } from '../lib/date';

export type AlertKind = 'overdue-bill' | 'late-income' | 'below-safety' | 'goal-at-risk';

export interface Alert {
  key: string;
  kind: AlertKind;
  severity: 'risk' | 'attention';
  amount: Cents;
  date: ISODate;
  event?: PendingEvent;
  goal?: GoalStatus;
}

/** Tudo o que precisa da atenção do usuário, do mais urgente ao menos urgente. */
export function deriveAlerts(model: FinanceModel, goals: GoalStatus[]): Alert[] {
  const alerts: Alert[] = [];

  for (const e of model.events) {
    if (!e.overdue) continue;
    alerts.push({
      key: `overdue:${e.key}`,
      kind: e.direction === 'out' ? 'overdue-bill' : 'late-income',
      severity: e.direction === 'out' ? 'risk' : 'attention',
      amount: e.amount,
      date: e.originalDate,
      event: e,
    });
  }

  const window = maxDate(safeHorizon(model.today), addDays(model.today, 30));
  const risk = firstRiskDay(model, model.today, window);
  if (risk) {
    alerts.push({
      key: `risk:${risk.date}`,
      kind: 'below-safety',
      severity: 'risk',
      amount: risk.closing,
      date: risk.date,
    });
  }

  for (const g of goals) {
    if (g.state !== 'at-risk') continue;
    alerts.push({
      key: `goal:${g.goal.id}`,
      kind: 'goal-at-risk',
      severity: 'attention',
      amount: g.shortfall,
      date: g.date,
      goal: g,
    });
  }

  const rank = { risk: 0, attention: 1 };
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || a.date.localeCompare(b.date));
}
