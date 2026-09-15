import type { Cents } from '../domain/types';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const currencyRound = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

const nbsp = / /g;

export interface MoneyFormat {
  /** Mostra "+" em valores positivos. */
  sign?: boolean;
  /** Omite centavos quando o valor é inteiro. */
  smart?: boolean;
  /** Arredonda para reais. */
  round?: boolean;
}

export function formatMoney(cents: Cents, opts: MoneyFormat = {}): string {
  const value = cents / 100;
  const abs = Math.abs(value);
  const useRound = opts.round || (opts.smart && cents % 100 === 0);
  const body = (useRound ? currencyRound : currency).format(abs).replace(nbsp, '');
  const prefix = cents < 0 ? '-' : opts.sign && cents > 0 ? '+' : '';
  return prefix + body;
}

/** "1,4 mil" — rótulos discretos em calendário/gráfico. */
export function formatCompact(cents: Cents): string {
  const v = cents / 100;
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1).replace('.', ',')}mi`;
  if (abs >= 10_000) return `${sign}${Math.round(abs / 1000)}mil`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1).replace('.', ',')}mil`;
  return `${sign}${Math.round(abs)}`;
}

/** Converte a digitação de um campo mascarado ("12345" → 12345 centavos). */
export function digitsToCents(input: string): Cents {
  const digits = input.replace(/\D/g, '').slice(0, 11);
  return digits ? parseInt(digits, 10) : 0;
}

/** Aceita "1.234,56", "1234.56", "R$ 80" etc. */
export function parseMoney(input: string): Cents {
  const clean = input.replace(/[^\d,.-]/g, '');
  if (!clean) return 0;
  const lastComma = clean.lastIndexOf(',');
  const lastDot = clean.lastIndexOf('.');
  let normalized: string;
  if (lastComma > lastDot) normalized = clean.replace(/\./g, '').replace(',', '.');
  else if (lastDot > -1 && clean.length - lastDot - 1 === 3 && lastComma === -1) normalized = clean.replace(/\./g, '');
  else normalized = clean.replace(/,/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
