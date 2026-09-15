import { describe, expect, it } from 'vitest';
import { buildSuggestions, suggestForCategory } from './suggestions';
import { tx } from '../test/fixtures';
import { digitsToCents, formatMoney, parseMoney } from '../lib/money';

describe('inteligência de lançamento', () => {
  const history = [
    tx({ amount: 3000, date: '2026-09-01', description: 'Almoço', categoryId: 'food', paymentMethod: 'pix', status: 'done' }),
    tx({ amount: 3200, date: '2026-09-05', description: 'almoço ', categoryId: 'food', paymentMethod: 'pix', status: 'done' }),
    tx({ amount: 3200, date: '2026-09-08', description: 'Almoco', categoryId: 'food', paymentMethod: 'pix', status: 'done' }),
    tx({ amount: 900, date: '2026-09-09', description: 'Uber', categoryId: 'transport', paymentMethod: 'credit', status: 'done' }),
    tx({ amount: 900, date: '2026-09-10', description: 'Uber', categoryId: 'transport', paymentMethod: 'credit', status: 'done' }),
    tx({ direction: 'in', amount: 85000, date: '2026-09-05', description: 'Salário', categoryId: 'salary', status: 'done' }),
  ];

  it('sugere as combinações mais frequentes por tipo', () => {
    const s = buildSuggestions(history, 'out');
    expect(s.map((x) => [x.description, x.categoryId, x.paymentMethod, x.count])).toEqual([
      ['Almoco', 'food', 'pix', 3],
      ['Uber', 'transport', 'credit', 2],
    ]);
  });

  it('filtra pela descrição digitada, sem acento', () => {
    expect(buildSuggestions(history, 'out', { query: 'almo' })[0].categoryId).toBe('food');
  });

  it('forma de pagamento mais usada por categoria', () => {
    expect(suggestForCategory(history, 'transport').paymentMethod).toBe('credit');
  });
});

describe('dinheiro', () => {
  it('formata e interpreta valores', () => {
    expect(formatMoney(106900)).toBe('R$1.069,00');
    expect(formatMoney(-3500, { smart: true })).toBe('-R$35');
    expect(formatMoney(85000, { sign: true, smart: true })).toBe('+R$850');
    expect(digitsToCents('R$ 1.234,56')).toBe(123456);
    expect(parseMoney('1.234,56')).toBe(123456);
    expect(parseMoney('80')).toBe(8000);
  });
});
