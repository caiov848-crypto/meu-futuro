import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Category, ISODate, Snapshot } from '../domain/types';
import { ADJUSTMENT_CATEGORY } from '../domain/defaults';
import {
  buildFinanceModel, calculateGoalStatus, calculateLowestBalance, calculateSafeSpending, deriveAlerts, monthEnd,
  type Alert, type FinanceModel, type GoalStatus, type LowPoint, type SafeSpending,
} from '../engine';
import { readSnapshot } from '../data/db';
import { ensureInitialized } from '../data/repository';
import { initCloudSync } from '../data/sync';
import { todayISO } from '../lib/date';

export interface Finance {
  today: ISODate;
  snapshot: Snapshot;
  model: FinanceModel;
  safe: SafeSpending;
  lowest: LowPoint;
  monthEnd: ReturnType<typeof monthEnd>;
  goals: GoalStatus[];
  alerts: Alert[];
  category: (id: string) => Category;
  categories: Category[];
}

const FinanceContext = createContext<Finance | null>(null);

/** Data de hoje que vira sozinha à meia-noite ou quando o app volta ao primeiro plano. */
function useToday(): ISODate {
  const [today, setToday] = useState(todayISO);
  useEffect(() => {
    const check = () => setToday((prev) => (prev === todayISO() ? prev : todayISO()));
    const timer = window.setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  return today;
}

const FALLBACK_CATEGORY: Category = { ...ADJUSTMENT_CATEGORY, id: 'other', name: 'Outros', emoji: '📦' };

/** Calcula tudo uma única vez por mudança de dados e entrega às telas. */
export function derive(snapshot: Snapshot, today: ISODate): Finance {
  const model = buildFinanceModel(snapshot, today);
  const safe = calculateSafeSpending(model);
  const goals = snapshot.goals
    .filter((g) => !g.deletedAt)
    .map((g) => calculateGoalStatus(model, g))
    .sort((a, b) => a.goal.date.localeCompare(b.goal.date));
  const byId = new Map(snapshot.categories.map((c) => [c.id, c]));
  const categories = snapshot.categories.filter((c) => !c.deletedAt && c.id !== 'adjustment').sort((a, b) => a.order - b.order);
  return {
    today,
    snapshot,
    model,
    safe,
    lowest: calculateLowestBalance(model, today, safe.until),
    monthEnd: monthEnd(model),
    goals,
    alerts: deriveAlerts(model, goals),
    category: (id) => byId.get(id) ?? byId.get('other') ?? FALLBACK_CATEGORY,
    categories,
  };
}

export function FinanceProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [ready, setReady] = useState(false);
  const today = useToday();
  useEffect(() => {
    ensureInitialized()
      .then(() => initCloudSync())
      .finally(() => setReady(true));
  }, []);
  const snapshot = useLiveQuery(() => (ready ? readSnapshot() : undefined), [ready]);
  const value = useMemo(() => (snapshot ? derive(snapshot, today) : null), [snapshot, today]);
  if (!value) return <>{fallback}</>;
  return <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>;
}

export function useFinance(): Finance {
  const ctx = useContext(FinanceContext);
  if (!ctx) throw new Error('useFinance fora do FinanceProvider');
  return ctx;
}
