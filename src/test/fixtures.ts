import type { Account, RecurringRule, Snapshot, Transaction, TxTemplate } from '../domain/types';
import { DEFAULT_CATEGORIES, defaultSettings } from '../domain/defaults';
import type { Ctx } from '../data/operations';

export const TODAY = '2026-09-14';
const stamp = '2026-09-01T12:00:00.000Z';

let seq = 0;
export const ctx = (today = TODAY): Ctx => ({ now: '2026-09-14T12:00:00.000Z', today, newId: () => `id-${++seq}` });

export function account(p: Partial<Account> = {}): Account {
  return {
    id: 'acc-main', name: 'Inter', type: 'bank', color: '#F97316', openingBalance: 0, order: 0,
    createdAt: stamp, updatedAt: stamp, deletedAt: null, ...p,
  };
}

export function tx(p: Partial<Transaction> & Pick<Transaction, 'amount' | 'date'>): Transaction {
  return {
    id: `tx-${++seq}`, direction: 'out', categoryId: 'other', description: '', accountId: 'acc-main',
    paymentMethod: null, certainty: 'confirmed', note: '', status: 'planned', kind: 'regular',
    recurrenceId: null, occurrenceDate: null, createdAt: stamp, updatedAt: stamp, deletedAt: null, ...p,
  };
}

export function rule(p: Omit<Partial<RecurringRule>, 'template'> & { template: Partial<TxTemplate>; startDate: string }): RecurringRule {
  return {
    id: `rule-${++seq}`, frequency: 'monthly', interval: 1, endDate: null, skipDates: [],
    createdAt: stamp, updatedAt: stamp, deletedAt: null, ...p,
    template: {
      direction: 'out', amount: 0, categoryId: 'other', description: '', accountId: 'acc-main',
      paymentMethod: null, certainty: 'confirmed', note: '', ...p.template,
    },
  };
}

/** Cenário oficial da especificação (seção 65). */
export function scenario(): Snapshot {
  return {
    accounts: [account({ openingBalance: 56900 })],
    transactions: [
      tx({ direction: 'in', amount: 85000, date: '2026-09-18', categoryId: 'salary', description: 'Salário' }),
      tx({ amount: 70000, date: '2026-09-20', categoryId: 'home', description: 'Aluguel' }),
      tx({ amount: 20000, date: '2026-09-25', categoryId: 'other', description: 'Outras despesas' }),
    ],
    rules: [],
    categories: DEFAULT_CATEGORIES,
    goals: [],
    protectedMoney: [],
    settings: { ...defaultSettings('u1'), safetyLimit: 30000, onboarded: true },
  };
}
