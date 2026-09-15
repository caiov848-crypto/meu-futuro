import type { Snapshot, Transaction, TxTemplate } from '../domain/types';
import { ADJUSTMENT_CATEGORY, DEFAULT_CATEGORIES, defaultSettings } from '../domain/defaults';
import { addDays } from '../lib/date';

/**
 * Dados de exemplo relativos a hoje, reproduzindo o cenário da especificação:
 * saldo R$569, salário +R$850 em 4 dias, aluguel −R$700 em 6, outras despesas −R$200 em 11.
 */
export function buildDemoSnapshot(today: string, newId: () => string, now: string, userId: string): Snapshot {
  const base = { createdAt: now, updatedAt: now, deletedAt: null };
  const inter = { id: newId(), name: 'Inter', type: 'bank' as const, color: '#F97316', order: 0, openingBalance: 0, ...base };
  const cash = { id: newId(), name: 'Dinheiro', type: 'cash' as const, color: '#10B981', order: 1, openingBalance: 18000, ...base };

  const t = (p: Partial<Transaction> & Pick<Transaction, 'amount' | 'date' | 'categoryId'>): Transaction => ({
    id: newId(), direction: 'out', description: '', accountId: inter.id, paymentMethod: 'pix', certainty: 'confirmed',
    note: '', status: 'done', kind: 'regular', recurrenceId: null, occurrenceDate: null, ...base, ...p,
  });
  const tpl = (p: Partial<TxTemplate> & Pick<TxTemplate, 'amount' | 'categoryId'>): TxTemplate => ({
    direction: 'out', description: '', accountId: inter.id, paymentMethod: 'pix', certainty: 'confirmed', note: '', ...p,
  });

  const history: Transaction[] = [
    t({ amount: 3200, date: addDays(today, -6), categoryId: 'food', description: 'Almoço' }),
    t({ amount: 2000, date: addDays(today, -5), categoryId: 'transport', description: 'Uber', paymentMethod: 'credit' }),
    t({ amount: 3000, date: addDays(today, -3), categoryId: 'food', description: 'Almoço' }),
    t({ amount: 8990, date: addDays(today, -2), categoryId: 'shopping', description: 'Farmácia e mercado', paymentMethod: 'debit' }),
    t({ amount: 3500, date: addDays(today, -1), categoryId: 'food', description: 'Almoço' }),
  ];
  const spent = history.reduce((s, x) => s + x.amount, 0);
  // Saldo real final: R$569 (R$389 no Inter + R$180 em dinheiro).
  inter.openingBalance = 38900 + spent;

  const salaryId = newId();
  const rentId = newId();
  const rule = (id: string, startDate: string, template: TxTemplate) => ({
    id, template, frequency: 'monthly' as const, interval: 1, startDate, endDate: null, skipDates: [], ...base,
  });

  return {
    accounts: [inter, cash],
    transactions: [
      ...history,
      t({ amount: 20000, date: addDays(today, 11), categoryId: 'other', description: 'Outras despesas', status: 'planned', certainty: 'probable' }),
    ],
    rules: [
      rule(salaryId, addDays(today, 4), tpl({ direction: 'in', amount: 85000, categoryId: 'salary', description: 'Salário', paymentMethod: 'transfer' })),
      rule(rentId, addDays(today, 6), tpl({ amount: 70000, categoryId: 'home', description: 'Aluguel', paymentMethod: 'boleto' })),
    ],
    categories: [...DEFAULT_CATEGORIES, ADJUSTMENT_CATEGORY],
    goals: [{ id: newId(), name: 'Viagem', amount: 80000, date: addDays(today, 6), safetyOverride: null, ...base }],
    protectedMoney: [],
    settings: {
      ...defaultSettings(userId),
      safetyLimit: 30000,
      reserveTarget: 500000,
      reserveCurrent: 105000,
      onboarded: true,
      updatedAt: now,
    },
  };
}
