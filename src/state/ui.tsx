import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import type { ISODate } from '../domain/types';

export type Tab = 'today' | 'forecast' | 'plan' | 'more';
const TABS: Tab[] = ['today', 'forecast', 'plan', 'more'];

type SheetRender = (close: () => void) => ReactNode;
interface SheetEntry {
  id: number;
  render: SheetRender;
  closing: boolean;
}
interface ToastEntry {
  id: number;
  title: string;
  detail?: string;
  tone: 'success' | 'neutral';
}

interface UI {
  tab: Tab;
  setTab: (tab: Tab) => void;
  forecastDate: ISODate | null;
  forecastView: 'calendar' | 'statement';
  openForecast: (opts?: { date?: ISODate; view?: 'calendar' | 'statement' }) => void;
  setForecastDate: (date: ISODate | null) => void;
  setForecastView: (v: 'calendar' | 'statement') => void;
  openSheet: (render: SheetRender) => void;
  closeTopSheet: () => void;
  closeAllSheets: () => void;
  toast: (title: string, detail?: string, tone?: ToastEntry['tone']) => void;
}

const UIContext = createContext<UI | null>(null);
const SHEET_EXIT_MS = 200;

const tabFromHash = (): Tab => {
  const h = window.location.hash.replace('#/', '') as Tab;
  return TABS.includes(h) ? h : 'today';
};

export function UIProvider({ children }: { children: ReactNode }) {
  const [tab, setTabState] = useState<Tab>(tabFromHash);
  const [forecastDate, setForecastDate] = useState<ISODate | null>(null);
  const [forecastView, setForecastView] = useState<'calendar' | 'statement'>('calendar');
  const [sheets, setSheets] = useState<SheetEntry[]>([]);
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    const onHash = () => setTabState(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const setTab = useCallback((next: Tab) => {
    setTabState(next);
    if (window.location.hash !== `#/${next}`) window.history.replaceState(null, '', `#/${next}`);
    window.scrollTo({ top: 0 });
  }, []);

  const dismiss = useCallback((id: number) => {
    setSheets((s) => s.map((x) => (x.id === id ? { ...x, closing: true } : x)));
    window.setTimeout(() => setSheets((s) => s.filter((x) => x.id !== id)), SHEET_EXIT_MS);
  }, []);

  const openSheet = useCallback((render: SheetRender) => {
    const id = ++seq.current;
    setSheets((s) => [...s, { id, render, closing: false }]);
  }, []);

  const closeTopSheet = useCallback(() => {
    setSheets((s) => {
      const top = [...s].reverse().find((x) => !x.closing);
      if (top) window.setTimeout(() => dismiss(top.id));
      return s;
    });
  }, [dismiss]);

  const closeAllSheets = useCallback(() => {
    setSheets((s) => s.map((x) => ({ ...x, closing: true })));
    window.setTimeout(() => setSheets([]), SHEET_EXIT_MS);
  }, []);

  const toast = useCallback((title: string, detail?: string, tone: ToastEntry['tone'] = 'success') => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-1), { id, title, detail, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);

  const openForecast = useCallback<UI['openForecast']>((opts) => {
    if (opts?.date) setForecastDate(opts.date);
    if (opts?.view) setForecastView(opts.view);
    setTab('forecast');
  }, [setTab]);

  useEffect(() => {
    const active = sheets.some((s) => !s.closing);
    document.body.classList.toggle('sheet-open', active);
    if (!active) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeTopSheet();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheets, closeTopSheet]);

  const value = useMemo<UI>(
    () => ({
      tab, setTab, forecastDate, forecastView, openForecast, setForecastDate, setForecastView,
      openSheet, closeTopSheet, closeAllSheets, toast,
    }),
    [tab, setTab, forecastDate, forecastView, openForecast, openSheet, closeTopSheet, closeAllSheets, toast],
  );

  return (
    <UIContext.Provider value={value}>
      {children}
      {sheets.map((s) => (
        <div key={s.id} className="sheet-layer" data-closing={s.closing || undefined}>
          <div className="sheet-backdrop" onClick={() => dismiss(s.id)} />
          <div className="sheet" role="dialog" aria-modal="true">
            {s.render(() => dismiss(s.id))}
          </div>
        </div>
      ))}
      <div className="toast-host" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast" data-tone={t.tone}>
            <strong>{t.title}</strong>
            {t.detail && <span>{t.detail}</span>}
          </div>
        ))}
      </div>
    </UIContext.Provider>
  );
}

export function useUI(): UI {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI fora do UIProvider');
  return ctx;
}
