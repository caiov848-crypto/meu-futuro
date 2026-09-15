import Dexie, { type Table } from 'dexie';
import type {
  Account, Category, Goal, ProtectedMoney, RecurringRule, Settings, Snapshot, Transaction,
} from '../domain/types';

/**
 * Persistência local (IndexedDB). Registros nunca são apagados fisicamente:
 * `deletedAt` funciona como tombstone para uma futura sincronização.
 */
export class MeuFuturoDB extends Dexie {
  accounts!: Table<Account, string>;
  transactions!: Table<Transaction, string>;
  rules!: Table<RecurringRule, string>;
  categories!: Table<Category, string>;
  goals!: Table<Goal, string>;
  protectedMoney!: Table<ProtectedMoney, string>;
  settings!: Table<Settings, string>;

  constructor() {
    super('meu-futuro');
    this.version(1).stores({
      accounts: 'id, updatedAt',
      transactions: 'id, date, status, recurrenceId, updatedAt',
      rules: 'id, updatedAt',
      categories: 'id, updatedAt',
      goals: 'id, updatedAt',
      protectedMoney: 'id, updatedAt',
      settings: 'id',
    });
  }

  get dataTables() {
    return [this.accounts, this.transactions, this.rules, this.categories, this.goals, this.protectedMoney, this.settings];
  }
}

export const db = new MeuFuturoDB();

export async function readSnapshot(): Promise<Snapshot | null> {
  const [accounts, transactions, rules, categories, goals, protectedMoney, settings] = await Promise.all([
    db.accounts.toArray(),
    db.transactions.toArray(),
    db.rules.toArray(),
    db.categories.toArray(),
    db.goals.toArray(),
    db.protectedMoney.toArray(),
    db.settings.get('settings'),
  ]);
  if (!settings) return null;
  return { accounts, transactions, rules, categories, goals, protectedMoney, settings };
}
