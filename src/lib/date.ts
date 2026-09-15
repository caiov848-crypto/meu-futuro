import type { ISODate } from '../domain/types';

/** Utilitários de data em calendário puro (UTC interno, sem fuso). */

const pad = (n: number) => String(n).padStart(2, '0');

export function toISO(y: number, m: number, d: number): ISODate {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parts(date: ISODate): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y, m, d];
}

export function todayISO(now = new Date()): ISODate {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function toUTC(date: ISODate): number {
  const [y, m, d] = parts(date);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms: number): ISODate {
  const dt = new Date(ms);
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(date: ISODate, n: number): ISODate {
  return fromUTC(toUTC(date) + n * 86_400_000);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(a) - toUTC(b)) / 86_400_000);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Soma meses mantendo o dia desejado, limitado ao último dia do mês. */
export function addMonths(date: ISODate, n: number, preferredDay?: number): ISODate {
  const [y, m, d] = parts(date);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const day = Math.min(preferredDay ?? d, daysInMonth(ny, nm));
  return toISO(ny, nm, day);
}

export function endOfMonth(date: ISODate): ISODate {
  const [y, m] = parts(date);
  return toISO(y, m, daysInMonth(y, m));
}

export function startOfMonth(date: ISODate): ISODate {
  const [y, m] = parts(date);
  return toISO(y, m, 1);
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b;
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a < b ? a : b;
}

/** 0 = domingo */
export function weekday(date: ISODate): number {
  return new Date(toUTC(date)).getUTCDay();
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MONTHS_LONG = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export const monthName = (date: ISODate) => MONTHS_LONG[parts(date)[1] - 1];
export const monthShort = (date: ISODate) => MONTHS[parts(date)[1] - 1];

/** "20/set" */
export function fmtDayMonth(date: ISODate): string {
  const [, m, d] = parts(date);
  return `${d}/${MONTHS[m - 1]}`;
}

/** "20 SET" */
export function fmtDayMonthUpper(date: ISODate): string {
  const [, m, d] = parts(date);
  return `${pad(d)} ${MONTHS[m - 1].toUpperCase()}`;
}

/** "Hoje", "Amanhã", "Ontem" ou "qua, 20/set" */
export function fmtRelative(date: ISODate, today: ISODate): string {
  const delta = diffDays(date, today);
  if (delta === 0) return 'Hoje';
  if (delta === 1) return 'Amanhã';
  if (delta === -1) return 'Ontem';
  return `${WEEKDAYS[weekday(date)].slice(0, 3)}, ${fmtDayMonth(date)}`;
}

export function fmtLong(date: ISODate): string {
  const [y, m, d] = parts(date);
  return `${d} de ${MONTHS_LONG[m - 1]} de ${y}`;
}
