import type { Direction, ISODate, PaymentMethod, Transaction } from '../domain/types';

export interface Suggestion {
  key: string;
  description: string;
  categoryId: string;
  paymentMethod: PaymentMethod | null;
  accountId: string | null;
  count: number;
  lastDate: ISODate;
}

const normalize = (s: string) =>
  s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Combinações frequentes (descrição → categoria → pagamento → conta) do histórico,
 * para reduzir toques em lançamentos repetidos.
 */
export function buildSuggestions(
  transactions: Transaction[],
  direction: Direction,
  opts: { query?: string; limit?: number } = {},
): Suggestion[] {
  const query = normalize(opts.query ?? '');
  const groups = new Map<string, Suggestion>();
  for (const tx of transactions) {
    if (tx.deletedAt || tx.kind !== 'regular' || tx.direction !== direction) continue;
    const desc = normalize(tx.description);
    if (query && !desc.includes(query)) continue;
    const key = `${desc}|${tx.categoryId}|${tx.paymentMethod ?? ''}|${tx.accountId ?? ''}`;
    const g = groups.get(key);
    if (g) {
      g.count++;
      if (tx.date > g.lastDate) {
        g.lastDate = tx.date;
        g.description = tx.description.trim();
      }
    } else {
      groups.set(key, {
        key,
        description: tx.description.trim(),
        categoryId: tx.categoryId,
        paymentMethod: tx.paymentMethod,
        accountId: tx.accountId,
        count: 1,
        lastDate: tx.date,
      });
    }
  }
  return [...groups.values()]
    .filter((g) => g.count >= (query ? 1 : 2))
    .sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate))
    .slice(0, opts.limit ?? 3);
}

/** Forma de pagamento e conta mais usadas numa categoria. */
export function suggestForCategory(transactions: Transaction[], categoryId: string) {
  const pay = new Map<string, number>();
  const acc = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.deletedAt || tx.kind !== 'regular' || tx.categoryId !== categoryId) continue;
    if (tx.paymentMethod) pay.set(tx.paymentMethod, (pay.get(tx.paymentMethod) ?? 0) + 1);
    if (tx.accountId) acc.set(tx.accountId, (acc.get(tx.accountId) ?? 0) + 1);
  }
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { paymentMethod: top(pay) as PaymentMethod | null, accountId: top(acc) };
}
