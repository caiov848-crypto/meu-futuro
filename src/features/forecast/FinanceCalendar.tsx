import { useMemo } from 'react';
import type { ISODate } from '../../domain/types';
import { getDay, statusOf } from '../../engine';
import { addMonths, daysInMonth, monthName, parts, startOfMonth, toISO, weekday } from '../../lib/date';
import { formatCompact } from '../../lib/money';
import { useFinance } from '../../state/finance';
import { Icon } from '../../ui/Icon';

const WD = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
/** Quantos meses para trás o calendário permite consultar o histórico. */
const HISTORY_MONTHS = 12;

export function FinanceCalendar(props: {
  month: ISODate;
  onMonth: (m: ISODate) => void;
  selected: ISODate;
  onSelect: (d: ISODate) => void;
}) {
  const { model, snapshot, today } = useFinance();
  const [y, m] = parts(props.month);
  const offset = weekday(props.month);
  const total = daysInMonth(y, m);
  const canPrev = props.month > addMonths(startOfMonth(today), -HISTORY_MONTHS, 1);
  const canNext = addMonths(props.month, 1) <= model.horizonEnd;

  const realizedDays = useMemo(() => {
    const set = new Set<ISODate>();
    for (const t of snapshot.transactions) if (!t.deletedAt && t.status === 'done' && t.date < today) set.add(t.date);
    return set;
  }, [snapshot.transactions, today]);

  return (
    <div>
      <div className="calendar-head">
        <button className="icon-btn" aria-label="Mês anterior" disabled={!canPrev} style={{ opacity: canPrev ? 1 : 0.3 }} onClick={() => props.onMonth(addMonths(props.month, -1, 1))}>
          <Icon name="left" size={18} />
        </button>
        <h3>{monthName(props.month)} {y}</h3>
        <button className="icon-btn" aria-label="Próximo mês" disabled={!canNext} style={{ opacity: canNext ? 1 : 0.3 }} onClick={() => props.onMonth(addMonths(props.month, 1, 1))}>
          <Icon name="right" size={18} />
        </button>
      </div>
      <div className="calendar-grid">
        {WD.map((d, i) => <div key={i} className="calendar-wd">{d}</div>)}
        {Array.from({ length: offset }, (_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: total }, (_, i) => {
          const date = toISO(y, m, i + 1);
          if (date < today) {
            return (
              <button
                key={date}
                className="cal-day"
                data-past
                aria-pressed={date === props.selected}
                aria-label={`${i + 1}: dia passado`}
                onClick={() => props.onSelect(date)}
              >
                {realizedDays.has(date) && <span className="cal-ev" />}
                <span className="cal-num">{i + 1}</span>
              </button>
            );
          }
          const day = getDay(model, date);
          const status = statusOf(model, day.closing);
          return (
            <button
              key={date}
              className="cal-day"
              data-today={date === today || undefined}
              data-status={status}
              aria-pressed={date === props.selected}
              aria-label={`${i + 1}: saldo previsto ${formatCompact(day.closing)} reais`}
              onClick={() => props.onSelect(date)}
            >
              {day.events.length > 0 && <span className="cal-ev" />}
              <span className="cal-num">{i + 1}</span>
              <span className="cal-dot" data-status={status} />
              <span className="cal-bal">{formatCompact(day.closing)}</span>
            </button>
          );
        })}
      </div>
      <div className="chart-legend" style={{ marginTop: 10 }}>
        <span className="status" data-status="comfortable">confortável</span>
        <span className="status" data-status="attention">atenção</span>
        <span className="status" data-status="risk">abaixo da segurança</span>
      </div>
    </div>
  );
}
