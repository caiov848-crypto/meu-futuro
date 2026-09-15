import { describe, expect, it } from 'vitest';
import {
  adjustAccountBalance, createEntry, deleteOccurrence, deleteTransaction, editOccurrence, markEventDone,
  updateTransaction, type Changes, type EntryInput,
} from './operations';
import { account, ctx, rule, scenario, TODAY } from '../test/fixtures';
import { buildFinanceModel, calculateLowestBalance, calculateProjectedBalance, calculateRequiredSavings, calculateSafeSpending } from '../engine';
import type { Snapshot } from '../domain/types';

function apply(s: Snapshot, c: Changes): Snapshot {
  const merge = <T extends { id: string }>(list: T[], up: T[]) => {
    const map = new Map(list.map((x) => [x.id, x]));
    for (const u of up) map.set(u.id, u);
    return [...map.values()];
  };
  return { ...s, transactions: merge(s.transactions, c.transactions), rules: merge(s.rules, c.rules) };
}

const entry = (p: Partial<EntryInput>): EntryInput => ({
  mode: 'spent', amount: 1000, categoryId: 'food', description: '', date: TODAY, accountId: 'acc-main',
  paymentMethod: null, certainty: 'confirmed', note: '', recurrence: null, ...p,
});

describe('lançamentos', () => {
  it('gastei atualiza o saldo real; vou gastar só a previsão', () => {
    let s = apply(scenario(), createEntry(entry({ amount: 3500 }), ctx()));
    expect(buildFinanceModel(s, TODAY).currentBalance).toBe(53400);
    s = apply(s, createEntry(entry({ mode: 'willSpend', amount: 5000, date: '2026-09-15' }), ctx()));
    const m = buildFinanceModel(s, TODAY);
    expect(m.currentBalance).toBe(53400);
    expect(calculateProjectedBalance(m, '2026-09-15')).toBe(48400);
  });

  it('editar o salário de R$850 para R$1.000 atualiza tudo que depende dele', () => {
    const s = scenario();
    const salary = s.transactions[0];
    const before = buildFinanceModel(s, TODAY);
    const after = buildFinanceModel(apply(s, updateTransaction(salary, { amount: 100000 }, ctx())), TODAY);
    expect(calculateProjectedBalance(after, '2026-09-20')).toBe(calculateProjectedBalance(before, '2026-09-20') + 15000);
    expect(calculateLowestBalance(after, TODAY, '2026-09-30')).toMatchObject({ date: '2026-09-14', balance: 56900 });
    expect(calculateSafeSpending(after).amount).toBe(26900);
    expect(calculateRequiredSavings(after, { amount: 80000, date: '2026-09-20' }).shortfall).toBe(23100);
  });

  it('excluir recalcula e some da previsão', () => {
    const s = scenario();
    const rent = s.transactions[1];
    const m = buildFinanceModel(apply(s, deleteTransaction(rent, ctx())), TODAY);
    expect(m.events.map((e) => e.description)).toEqual(['Salário', 'Outras despesas']);
    expect(calculateProjectedBalance(m, '2026-09-30')).toBe(121900);
  });

  it('marcar conta como paga move para o saldo real hoje', () => {
    const s = scenario();
    const m = buildFinanceModel(s, TODAY);
    const rent = m.events.find((e) => e.description === 'Aluguel')!;
    const next = buildFinanceModel(apply(s, markEventDone(rent, s.transactions, s.rules, ctx())), TODAY);
    expect(next.currentBalance).toBe(-13100);
    expect(calculateProjectedBalance(next, '2026-09-30')).toBe(51900);
  });

  it('ajuste de saldo cria lançamento com a diferença', () => {
    const s = scenario();
    const c = adjustAccountBalance(account(), 56900, 60000, ctx());
    expect(c.transactions[0]).toMatchObject({ direction: 'in', amount: 3100, kind: 'adjustment', status: 'done' });
    expect(buildFinanceModel(apply(s, c), TODAY).currentBalance).toBe(60000);
  });
});

describe('séries recorrentes', () => {
  const setup = () => {
    const s = scenario();
    s.transactions = [];
    const r = rule({ template: { amount: 70000, description: 'Aluguel' }, startDate: '2026-09-20' });
    s.rules = [r];
    return { s, r };
  };
  const occDates = (s: Snapshot) =>
    buildFinanceModel(s, TODAY).events.filter((e) => e.date <= '2026-12-31').map((e) => `${e.date}:${e.amount}`);

  it('recebi + recorrência materializa a primeira ocorrência', () => {
    const s = scenario();
    const c = createEntry(entry({ mode: 'received', amount: 85000, recurrence: 'monthly' }), ctx());
    expect(c.rules).toHaveLength(1);
    expect(c.transactions[0]).toMatchObject({ status: 'done', occurrenceDate: TODAY, recurrenceId: c.rules[0].id });
    const m = buildFinanceModel(apply(s, c), TODAY);
    expect(m.currentBalance).toBe(141900);
    expect(m.events.filter((e) => e.ruleId).map((e) => e.date).slice(0, 2)).toEqual(['2026-10-14', '2026-11-14']);
  });

  it('editar somente esta ocorrência', () => {
    const { s, r } = setup();
    const c = editOccurrence({ rule: r, occurrenceDate: '2026-10-20', seriesTxs: [] }, 'this', { amount: 75000 }, ctx());
    expect(occDates(apply(s, c))).toEqual(['2026-09-20:70000', '2026-10-20:75000', '2026-11-20:70000', '2026-12-20:70000']);
  });

  it('editar esta e as próximas divide a série', () => {
    const { s, r } = setup();
    const c = editOccurrence({ rule: r, occurrenceDate: '2026-11-20', seriesTxs: [] }, 'following', { amount: 80000 }, ctx());
    expect(c.rules).toHaveLength(2);
    expect(occDates(apply(s, c))).toEqual(['2026-09-20:70000', '2026-10-20:70000', '2026-11-20:80000', '2026-12-20:80000']);
  });

  it('editar a série inteira (inclusive mudando o dia)', () => {
    const { s, r } = setup();
    const c = editOccurrence({ rule: r, occurrenceDate: '2026-10-20', seriesTxs: [] }, 'all', { amount: 72000, date: '2026-10-22' }, ctx());
    expect(occDates(apply(s, c))).toEqual(['2026-09-22:72000', '2026-10-22:72000', '2026-11-22:72000', '2026-12-22:72000']);
  });

  it('excluir somente esta, esta e as próximas, ou toda a série', () => {
    const { s, r } = setup();
    const ref = { rule: r, occurrenceDate: '2026-10-20', seriesTxs: [] };
    expect(occDates(apply(s, deleteOccurrence(ref, 'this', ctx())))).toEqual(['2026-09-20:70000', '2026-11-20:70000', '2026-12-20:70000']);
    expect(occDates(apply(s, deleteOccurrence(ref, 'following', ctx())))).toEqual(['2026-09-20:70000']);
    expect(occDates(apply(s, deleteOccurrence(ref, 'all', ctx())))).toEqual([]);
  });

  it('série inteira mantém histórico pago', () => {
    const { s, r } = setup();
    const m = buildFinanceModel(s, TODAY);
    const first = m.events[0];
    let next = apply(s, markEventDone(first, s.transactions, s.rules, ctx()));
    expect(buildFinanceModel(next, TODAY).currentBalance).toBe(-13100);
    next = apply(next, deleteOccurrence({ rule: r, occurrenceDate: '2026-10-20', seriesTxs: next.transactions }, 'all', ctx()));
    const after = buildFinanceModel(next, TODAY);
    expect(after.currentBalance).toBe(-13100);
    expect(after.events).toHaveLength(0);
  });
});
