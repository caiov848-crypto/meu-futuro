/**
 * Modelo de dados do Meu Futuro.
 *
 * Convenções:
 * - Valores monetários em centavos inteiros (nunca float).
 * - Datas de calendário como string ISO `YYYY-MM-DD` (sem fuso horário).
 * - Todo registro tem `id`, `createdAt`, `updatedAt` e `deletedAt` (tombstone)
 *   para permitir sincronização com nuvem no futuro sem migração.
 */

export type ISODate = string;
export type Cents = number;

export interface BaseRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type AccountType = 'bank' | 'cash' | 'wallet' | 'savings';

export interface Account extends BaseRecord {
  name: string;
  type: AccountType;
  color: string;
  /** Saldo no momento da criação. Ajustes posteriores viram lançamentos do tipo `adjustment`. */
  openingBalance: Cents;
  order: number;
}

export type Direction = 'in' | 'out';
/** `done` = já aconteceu (Gastei/Recebi). `planned` = vai acontecer (Vou gastar/Vou receber). */
export type TxStatus = 'done' | 'planned';
export type Certainty = 'confirmed' | 'probable' | 'expected';
export type PaymentMethod = 'pix' | 'debit' | 'credit' | 'cash' | 'boleto' | 'transfer' | 'other';
export type TxKind = 'regular' | 'adjustment';

export interface TxTemplate {
  direction: Direction;
  amount: Cents;
  categoryId: string;
  description: string;
  accountId: string | null;
  paymentMethod: PaymentMethod | null;
  certainty: Certainty;
  note: string;
}

export interface Transaction extends BaseRecord, TxTemplate {
  date: ISODate;
  status: TxStatus;
  kind: TxKind;
  /** Série recorrente de origem (quando é uma ocorrência materializada). */
  recurrenceId: string | null;
  /** Data original da ocorrência dentro da série. */
  occurrenceDate: ISODate | null;
}

export type Frequency = 'weekly' | 'monthly' | 'yearly';

export interface RecurringRule extends BaseRecord {
  template: TxTemplate;
  frequency: Frequency;
  interval: number;
  startDate: ISODate;
  endDate: ISODate | null;
  /** Ocorrências excluídas individualmente. */
  skipDates: ISODate[];
}

export interface Category extends BaseRecord {
  name: string;
  emoji: string;
  kind: Direction | 'both';
  order: number;
  builtin: boolean;
}

export interface Goal extends BaseRecord {
  name: string;
  amount: Cents;
  date: ISODate;
  /** Segurança específica da meta; `null` usa a segurança geral. */
  safetyOverride: Cents | null;
}

export interface ProtectedMoney extends BaseRecord {
  name: string;
  amount: Cents;
}

export type CertaintyWeights = Record<Certainty, { in: number; out: number }>;

export interface Settings {
  id: 'settings';
  userId: string;
  userName: string;
  safetyLimit: Cents;
  /** Faixa acima da segurança considerada "atenção". `null` = automático. */
  attentionMargin: Cents | null;
  reserveTarget: Cents;
  reserveCurrent: Cents;
  certaintyWeights: CertaintyWeights;
  onboarded: boolean;
  updatedAt: string;
}

export interface Snapshot {
  accounts: Account[];
  transactions: Transaction[];
  rules: RecurringRule[];
  categories: Category[];
  goals: Goal[];
  protectedMoney: ProtectedMoney[];
  settings: Settings;
}

export const DEFAULT_WEIGHTS: CertaintyWeights = {
  confirmed: { in: 1, out: 1 },
  probable: { in: 1, out: 1 },
  expected: { in: 1, out: 1 },
};
