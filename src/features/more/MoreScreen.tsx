import { useDeferredValue, useMemo, useState } from 'react';
import type { Transaction } from '../../domain/types';
import { addDays, addMonths, endOfMonth, fmtDayMonthUpper, startOfMonth } from '../../lib/date';
import { useFinance } from '../../state/finance';
import { useUI } from '../../state/ui';
import { Icon } from '../../ui/Icon';
import { Chip, Money } from '../../ui/primitives';
import { EventRow, TxRow } from '../common/MovementRow';
import { SettingsSheet } from './SettingsSheet';
import { ExportPdfSheet } from '../export/ExportPdfSheet';

type Kind = 'all' | 'out' | 'in' | 'planned';
type Period = 'month' | 'last' | '90' | 'all';

const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function MoreScreen() {
  const f = useFinance();
  const ui = useUI();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [period, setPeriod] = useState<Period>('month');
  const [categoryId, setCategoryId] = useState('');
  const q = useDeferredValue(normalize(query.trim()));

  const range = useMemo((): [string, string] => {
    const t = f.today;
    if (period === 'month') return [startOfMonth(t), endOfMonth(t)];
    if (period === 'last') { const m = addMonths(startOfMonth(t), -1, 1); return [m, endOfMonth(m)]; }
    if (period === '90') return [addDays(t, -90), t];
    return ['0000-01-01', '9999-12-31'];
  }, [period, f.today]);

  const matchesText = (desc: string, catId: string) =>
    !q || normalize(desc).includes(q) || normalize(f.category(catId).name).includes(q);

  const history = useMemo(() => {
    if (kind === 'planned') return [];
    return f.snapshot.transactions
      .filter((t) => !t.deletedAt && t.status === 'done' && t.date >= range[0] && t.date <= range[1])
      .filter((t) => kind === 'all' || t.direction === kind)
      .filter((t) => !categoryId || t.categoryId === categoryId)
      .filter((t) => matchesText(t.description, t.categoryId))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.snapshot.transactions, kind, range, categoryId, q]);

  const planned = useMemo(
    () => kind !== 'planned' ? [] : f.model.events
      .filter((e) => period === 'all' || (e.date >= f.today && e.date <= (period === 'month' ? endOfMonth(f.today) : addDays(f.today, 90))))
      .filter((e) => !categoryId || e.categoryId === categoryId)
      .filter((e) => matchesText(e.description, e.categoryId))
      .slice(0, 200),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, f.model.events, period, categoryId, q],
  );

  const totals = history.reduce((acc, t) => {
    if (t.kind === 'regular') acc[t.direction] += t.amount;
    return acc;
  }, { in: 0, out: 0 });

  const groups = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const t of history) map.set(t.date, [...(map.get(t.date) ?? []), t]);
    return [...map.entries()];
  }, [history]);

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <p>O que aconteceu</p>
          <h1>Histórico</h1>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => ui.openSheet((c) => <ExportPdfSheet close={c} />)}>
            Exportar PDF
          </button>
          <button className="icon-btn" aria-label="Ajustes" onClick={() => ui.openSheet((c) => <SettingsSheet close={c} />)}>
            <Icon name="settings" size={20} />
          </button>
        </div>
      </header>

      <div className="search">
        <Icon name="search" size={18} />
        <input className="input" type="search" placeholder="Buscar lançamentos" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar" />
      </div>

      <div className="chips chips-scroll">
        {([['all', 'Tudo'], ['out', 'Saídas'], ['in', 'Entradas'], ['planned', 'Previstos']] as [Kind, string][]).map(([k, l]) => (
          <Chip key={k} active={kind === k} onClick={() => setKind(k)}>{l}</Chip>
        ))}
        <select className="input select" style={{ minHeight: 38, width: 'auto', borderRadius: 999, fontSize: '0.8125rem' }} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Categoria">
          <option value="">Todas as categorias</option>
          {f.categories.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
        </select>
      </div>
      <div className="chips chips-scroll">
        {(kind === 'planned'
          ? [['month', 'Até o fim do mês'], ['90', 'Próximos 90 dias'], ['all', 'Tudo']]
          : [['month', 'Este mês'], ['last', 'Mês passado'], ['90', '90 dias'], ['all', 'Tudo']]
        ).map(([p, l]) => (
          <Chip key={p} active={period === p} onClick={() => setPeriod(p as Period)}>{l}</Chip>
        ))}
      </div>

      {kind !== 'planned' && (
        <div className="summary-line">
          <span>{history.length} lançamento{history.length === 1 ? '' : 's'}</span>
          <span>Entradas <Money className="in" cents={totals.in} smart /></span>
          <span>Saídas <Money className="out" cents={totals.out} smart /></span>
        </div>
      )}

      <section className="card card-list">
        {kind === 'planned' ? (
          planned.length === 0 ? <Empty /> : planned.map((e) => <EventRow key={e.key} event={e} subtitle={fmtDayMonthUpper(e.originalDate)} />)
        ) : groups.length === 0 ? (
          <Empty />
        ) : (
          groups.map(([date, txs]) => (
            <div key={date}>
              <div className="day-label">{date === f.today ? 'Hoje' : fmtDayMonthUpper(date)}</div>
              {txs.map((t) => <TxRow key={t.id} tx={t} />)}
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function Empty() {
  return <p className="muted" style={{ padding: '18px 16px', textAlign: 'center' }}>Nada encontrado com esses filtros.</p>;
}
