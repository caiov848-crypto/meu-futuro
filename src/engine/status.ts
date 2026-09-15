import type { Cents } from '../domain/types';

export type FinancialStatus = 'comfortable' | 'attention' | 'risk';

export const STATUS_LABELS: Record<FinancialStatus, string> = {
  comfortable: 'Confortável',
  attention: 'Atenção',
  risk: 'Risco',
};

export const STATUS_EMOJI: Record<FinancialStatus, string> = {
  comfortable: '🟢',
  attention: '🟡',
  risk: '🔴',
};

/** Faixa de atenção automática: 25% da segurança, no mínimo R$50. */
export function resolveAttentionMargin(safetyLimit: Cents, custom: Cents | null): Cents {
  if (custom !== null && custom >= 0) return custom;
  return Math.max(Math.round(safetyLimit * 0.25), 5000);
}

export function financialStatus(balance: Cents, floor: Cents, margin: Cents): FinancialStatus {
  if (balance < floor) return 'risk';
  if (balance < floor + margin) return 'attention';
  return 'comfortable';
}
