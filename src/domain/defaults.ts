import type { Category, PaymentMethod, Settings, AccountType, Certainty } from './types';
import { DEFAULT_WEIGHTS } from './types';

const stamp = '2026-01-01T00:00:00.000Z';

const cat = (id: string, name: string, emoji: string, kind: Category['kind'], order: number): Category => ({
  id, name, emoji, kind, order, builtin: true, createdAt: stamp, updatedAt: stamp, deletedAt: null,
});

export const DEFAULT_CATEGORIES: Category[] = [
  cat('food', 'Alimentação', '🍔', 'out', 1),
  cat('transport', 'Transporte', '🚗', 'out', 2),
  cat('home', 'Casa', '🏠', 'out', 3),
  cat('bills', 'Contas', '💳', 'out', 4),
  cat('health', 'Saúde', '💊', 'out', 5),
  cat('leisure', 'Lazer', '🎬', 'out', 6),
  cat('shopping', 'Compras', '🛍️', 'out', 7),
  cat('salary', 'Salário', '💰', 'in', 8),
  cat('extra', 'Renda extra', '✨', 'in', 9),
  cat('other', 'Outros', '📦', 'both', 10),
];

export const ADJUSTMENT_CATEGORY: Category = cat('adjustment', 'Ajuste de saldo', '⚖️', 'both', 99);

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  pix: 'Pix',
  debit: 'Débito',
  credit: 'Crédito',
  cash: 'Dinheiro',
  boleto: 'Boleto',
  transfer: 'Transferência',
  other: 'Outro',
};

export const CERTAINTY_LABELS: Record<Certainty, string> = {
  confirmed: 'Confirmada',
  probable: 'Provável',
  expected: 'Prevista',
};

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  bank: 'Banco',
  wallet: 'Carteira digital',
  cash: 'Dinheiro',
  savings: 'Poupança',
};

export const ACCOUNT_COLORS = ['#E11D48', '#F97316', '#0EA5E9', '#8B5CF6', '#10B981', '#64748B', '#EAB308'];

export function defaultSettings(userId: string): Settings {
  return {
    id: 'settings',
    userId,
    userName: '',
    safetyLimit: 30000,
    attentionMargin: null,
    reserveTarget: 0,
    reserveCurrent: 0,
    certaintyWeights: DEFAULT_WEIGHTS,
    onboarded: false,
    updatedAt: stamp,
  };
}
