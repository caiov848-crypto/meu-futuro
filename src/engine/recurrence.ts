import type { ISODate, RecurringRule } from '../domain/types';
import { addDays, addMonths, parts } from '../lib/date';

const MAX_ITERATIONS = 5000;

/** Data da n-ésima ocorrência (n = 0 é a data inicial). */
export function nthOccurrence(rule: Pick<RecurringRule, 'frequency' | 'interval' | 'startDate'>, n: number): ISODate {
  const step = Math.max(1, rule.interval) * n;
  const day = parts(rule.startDate)[2];
  switch (rule.frequency) {
    case 'weekly':
      return addDays(rule.startDate, 7 * step);
    case 'monthly':
      return addMonths(rule.startDate, step, day);
    case 'yearly':
      return addMonths(rule.startDate, 12 * step, day);
  }
}

/** Ocorrências da série entre `from` e `to` (inclusive), ignorando datas puladas. */
export function occurrencesBetween(rule: RecurringRule, from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  const end = rule.endDate && rule.endDate < to ? rule.endDate : to;
  if (rule.startDate > end) return out;
  const skip = rule.skipDates.length ? new Set(rule.skipDates) : null;
  for (let n = 0; n < MAX_ITERATIONS; n++) {
    const d = nthOccurrence(rule, n);
    if (d > end) break;
    if (d >= from && !skip?.has(d)) out.push(d);
  }
  return out;
}

export const FREQUENCY_LABELS = {
  weekly: 'Toda semana',
  monthly: 'Todo mês',
  yearly: 'Todo ano',
} as const;
