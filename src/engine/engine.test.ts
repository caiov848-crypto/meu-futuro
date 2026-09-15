import { describe, expect, it } from 'vitest';
import {
  buildFinanceModel, calculateCurrentBalance, calculateGoalStatus, calculateLowestBalance,
  calculateProjectedBalance, calculateRequiredSavings, calculateSafeSpending, deriveAlerts,
  explainProjectedBalance, getDay, monthEnd, occurrencesBetween, simulateSpend, statusOf,
} from './index';
import { account, rule, scenario, TODAY, tx } from '../test/fixtures';
import type { Goal, Snapshot } from '../domain/types';

const model = (s: Snapshot = scenario(), today = TODAY) => buildFinanceModel(s, today);

const goal = (p: Partial<Goal>): Goal => ({
  id: 'g1', name: 'Viagem', amount: 80000, date: '2026-09-20', safetyOverride: null,
  createdAt: '', updatedAt: '', deletedAt: null, ...p,
});

describe('saldo real', () => {
  it('soma saldos de abertura e lançamentos realizados', () => {
    const s = scenario();
    s.accounts.push(account({ id: 'cash', name: 'Dinheiro', openingBalance: 18000 }));
    s.transactions.push(tx({ amount: 3500, date: TODAY, status: 'done', accountId: 'cash' }));
    s.transactions.push(tx({ direction: 'in', amount: 1000, date: '2026-09-10', status: 'done' }));
    expect(calculateCurrentBalance(s, TODAY)).toBe(56900 + 18000 - 3500 + 1000);
    const m = model(s);
    expect(m.accountBalances.map((a) => a.balance)).toEqual([57900, 14500]);
  });

  it('ignora excluídos, planejados e lançamentos de contas excluídas', () => {
    const s = scenario();
    s.accounts.push(account({ id: 'old', openingBalance: 99900, deletedAt: 'x' }));
    s.transactions.push(tx({ amount: 5000, date: TODAY, status: 'done', deletedAt: 'x' }));
    s.transactions.push(tx({ amount: 5000, date: TODAY, status: 'done', accountId: 'old' }));
    expect(calculateCurrentBalance(s, TODAY)).toBe(56900);
  });

  it('gasto marcado como feito numa data futura entra só na previsão', () => {
    const s = scenario();
    s.transactions.push(tx({ amount: 1000, date: '2026-09-16', status: 'done' }));
    const m = model(s);
    expect(m.currentBalance).toBe(56900);
    expect(calculateProjectedBalance(m, '2026-09-16')).toBe(55900);
  });
});

describe('cenário da especificação (seção 65)', () => {
  const m = model();

  it('saldo projetado dia a dia (base do gráfico e calendário)', () => {
    expect(calculateProjectedBalance(m, '2026-09-14')).toBe(56900);
    expect(calculateProjectedBalance(m, '2026-09-17')).toBe(56900);
    expect(calculateProjectedBalance(m, '2026-09-18')).toBe(141900);
    expect(calculateProjectedBalance(m, '2026-09-20')).toBe(71900);
    expect(calculateProjectedBalance(m, '2026-09-25')).toBe(51900);
    expect(calculateProjectedBalance(m, '2026-10-31')).toBe(51900);
  });

  it('explica entradas e saídas até a data', () => {
    const b = explainProjectedBalance(m, '2026-09-20');
    expect(b).toMatchObject({ startBalance: 56900, inflows: 85000, outflows: 70000, result: 71900 });
    expect(b.events.map((e) => e.description)).toEqual(['Salário', 'Aluguel']);
  });

  it('mostra os movimentos de cada dia', () => {
    expect(getDay(m, '2026-09-18')).toMatchObject({ opening: 56900, inflow: 85000, outflow: 0, closing: 141900 });
    expect(getDay(m, '2026-09-19').events).toHaveLength(0);
  });

  it('pior dia é 25/set com R$519', () => {
    const low = calculateLowestBalance(m, TODAY, '2026-09-30');
    expect(low).toMatchObject({ date: '2026-09-25', balance: 51900, status: 'comfortable' });
  });

  it('previsão do fim do mês', () => {
    expect(monthEnd(m)).toMatchObject({ date: '2026-09-30', balance: 51900 });
  });

  it('estados do calendário: confortável, atenção, risco', () => {
    expect(statusOf(m, 51900)).toBe('comfortable');
    expect(statusOf(m, 34000)).toBe('attention'); // margem automática R$75
    expect(statusOf(m, 29999)).toBe('risk');
  });

  it('quanto posso gastar hoje = menor saldo até 30/set − segurança', () => {
    const safe = calculateSafeSpending(m);
    expect(safe).toMatchObject({ amount: 21900, until: '2026-09-30', limitingDate: '2026-09-25' });
    expect(safe.perDay).toBe(Math.floor(21900 / 17));
  });

  it('quanto preciso juntar: R$800 em 20/set com segurança R$300', () => {
    const r = calculateRequiredSavings(m, { amount: 80000, date: '2026-09-20', safety: 30000 });
    expect(r).toMatchObject({ projected: 71900, needed: 110000, shortfall: 38100, guaranteed: false });
  });

  it('já garantido mostra a margem', () => {
    const r = calculateRequiredSavings(m, { amount: 20000, date: '2026-09-18' });
    expect(r).toMatchObject({ needed: 50000, projected: 141900, shortfall: 0, guaranteed: true, margin: 91900 });
    // depois do gasto, o pior dia (25/set, R$319) ainda fica acima da segurança
    expect(r.laterDip).toBeNull();
  });

  it('laterDip aparece quando um gasto garantido no dia estoura depois', () => {
    const r = calculateRequiredSavings(m, { amount: 60000, date: '2026-09-18' });
    expect(r.guaranteed).toBe(true);
    expect(r.laterDip).toEqual({ date: '2026-09-25', balance: -8100 });
  });

  it('simulador "posso gastar?" não altera a previsão', () => {
    const before = m.days.map((d) => d.closing);
    const ok = simulateSpend(m, { amount: 20000, date: TODAY });
    expect(ok).toMatchObject({ ok: true, margin: 1900, maxSafe: 21900, balanceAfter: 36900 });
    const no = simulateSpend(m, { amount: 30000, date: TODAY });
    expect(no).toMatchObject({ ok: false, margin: -8100, lowestAfter: { date: '2026-09-25', balance: 21900 } });
    expect(m.days.map((d) => d.closing)).toEqual(before);
  });

  it('simular num dia depois do salário usa a janela a partir daquele dia', () => {
    const r = simulateSpend(m, { amount: 21900, date: '2026-09-19' });
    expect(r.ok).toBe(true);
    expect(r.maxSafe).toBe(21900);
  });
});

describe('limite de segurança e dinheiro protegido', () => {
  it('dinheiro protegido reduz o livre e sobe o piso', () => {
    const s = scenario();
    s.protectedMoney.push({ id: 'p', name: 'Presente', amount: 10000, createdAt: '', updatedAt: '', deletedAt: null });
    const m = model(s);
    expect(m.freeBalance).toBe(46900);
    expect(m.floor).toBe(40000);
    expect(calculateSafeSpending(m).amount).toBe(11900);
    expect(m.currentBalance).toBe(56900); // não move dinheiro automaticamente
  });

  it('segurança maior gera alerta de saldo abaixo', () => {
    const s = scenario();
    s.settings.safetyLimit = 60000;
    const m = model(s);
    expect(calculateSafeSpending(m).amount).toBe(0);
    const alerts = deriveAlerts(m, []);
    expect(alerts[0]).toMatchObject({ kind: 'below-safety', date: '2026-09-14' });
  });

  it('reserva é só uma meta: não afeta o saldo', () => {
    const s = scenario();
    s.settings.reserveTarget = 500000;
    s.settings.reserveCurrent = 105000;
    expect(model(s).freeBalance).toBe(56900);
  });
});

describe('metas dinâmicas', () => {
  it('meta recalcula após nova despesa (nunca valor fixo)', () => {
    const s = scenario();
    const g = goal({ amount: 30000, date: '2026-09-20' });
    const before = calculateGoalStatus(model(s), g);
    expect(before).toMatchObject({ state: 'guaranteed', margin: 11900 });

    s.transactions.push(tx({ amount: 28000, date: '2026-09-19', description: 'Conserto' }));
    const after = calculateGoalStatus(model(s), g);
    expect(after).toMatchObject({ state: 'at-risk', shortfall: 16100 });
    expect(deriveAlerts(model(s), [after]).some((a) => a.kind === 'goal-at-risk')).toBe(true);
  });

  it('segurança própria da meta', () => {
    const r = calculateGoalStatus(model(), goal({ amount: 80000, safetyOverride: 0 }));
    expect(r).toMatchObject({ needed: 80000, shortfall: 8100 });
  });

  it('meta com data passada', () => {
    expect(calculateGoalStatus(model(), goal({ date: '2026-09-01' })).state).toBe('past');
  });
});

describe('recorrência', () => {
  it('mensal respeita fim de mês, datas puladas e fim da série', () => {
    const r = rule({ template: { amount: 100 }, startDate: '2026-01-31', skipDates: ['2026-03-31'], endDate: '2026-05-15' });
    expect(occurrencesBetween(r, '2026-01-01', '2026-12-31')).toEqual(['2026-01-31', '2026-02-28', '2026-04-30']);
  });

  it('semanal e anual', () => {
    const w = rule({ template: {}, frequency: 'weekly', startDate: '2026-09-01' });
    expect(occurrencesBetween(w, '2026-09-10', '2026-09-30')).toEqual(['2026-09-15', '2026-09-22', '2026-09-29']);
    const y = rule({ template: {}, frequency: 'yearly', startDate: '2024-02-29' });
    expect(occurrencesBetween(y, '2025-01-01', '2026-12-31')).toEqual(['2025-02-28', '2026-02-28']);
  });

  it('ocorrências entram na previsão; atrasadas entram hoje e viram alerta', () => {
    const s = scenario();
    s.rules.push(rule({ template: { amount: 7000, description: 'Internet', categoryId: 'bills' }, startDate: '2026-08-10' }));
    const m = model(s);
    const overdue = m.events.find((e) => e.overdue)!;
    expect(overdue).toMatchObject({ originalDate: '2026-08-10', date: TODAY, amount: 7000 });
    expect(m.events.filter((e) => e.overdue)).toHaveLength(2); // 10/ago e 10/set
    expect(calculateProjectedBalance(m, TODAY)).toBe(56900 - 14000);
    expect(calculateProjectedBalance(m, '2026-10-10')).toBe(51900 - 14000 - 7000);
    const alerts = deriveAlerts(m, []);
    expect(alerts.filter((a) => a.kind === 'overdue-bill')).toHaveLength(2);
  });

  it('ocorrência materializada substitui a virtual', () => {
    const s = scenario();
    const r = rule({ template: { amount: 7000 }, startDate: '2026-09-10' });
    s.rules.push(r);
    s.transactions.push(tx({ amount: 7000, date: '2026-09-12', status: 'done', recurrenceId: r.id, occurrenceDate: '2026-09-10' }));
    const m = model(s);
    expect(m.events.some((e) => e.overdue)).toBe(false);
    expect(m.currentBalance).toBe(49900);
  });
});

describe('certeza', () => {
  it('pesos permitem previsão conservadora', () => {
    const s = scenario();
    s.transactions[0].certainty = 'expected';
    s.settings.certaintyWeights = { ...s.settings.certaintyWeights, expected: { in: 0, out: 1 } };
    const m = model(s);
    expect(calculateProjectedBalance(m, '2026-09-18')).toBe(56900);
    expect(calculateLowestBalance(m, TODAY, '2026-09-30').balance).toBe(56900 - 90000);
  });
});
