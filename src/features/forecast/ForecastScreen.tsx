import { useCallback, useMemo, useState } from 'react';
import type { ISODate } from '../../domain/types';
import { calculateLowestBalance, explainProjectedBalance, getDay, statusOf } from '../../engine';
import { addDays, diffDays, fmtDayMonth, fmtDayMonthUpper, fmtRelative, startOfMonth } from '../../lib/date';
import { useFinance } from '../../state/finance';
import { useUI } from '../../state/ui';
import { Icon } from '../../ui/Icon';
import { Money, Segmented } from '../../ui/primitives';
import { EventRow } from '../common/MovementRow';
import { StatusSentence } from '../common/StatusSentence';
import { DayPanel } from './DayPanel';
import { FinanceCalendar } from './FinanceCalendar';
import { ForecastChart } from './ForecastChart';

const RANGES = [
  { value: 30, label: '30 dias' },
  { value: 90, label: '3 meses' },
  { value: 180, label: '6 meses' },
  { value: 365, label: '1 ano' },
];

export function ForecastScreen() {
  const f = useFinance();
  const ui = useUI();
  const { model, today } = f;
  const selected = ui.forecastDate && ui.forecastDate >= today ? ui.forecastDate : f.monthEnd.date;
  const [rangePref, setRange] = useState(30);
  const needed = diffDays(selected, today) + 1;
  const range = rangePref >= needed ? rangePref : RANGES.find((r) => r.value >= needed)?.value ?? 365;
  const [month, setMonth] = useState(startOfMonth(selected));

  const select = useCallback((d: ISODate) => ui.setForecastDate(d), [ui]);
  const days = useMemo(() => model.days.slice(0, range), [model.days, range]);
  const lowest = calculateLowestBalance(model, today, addDays(today, range - 1));
  const b = explainProjectedBalance(model, selected);
  const status = statusOf(model, b.result);
  const day = getDay(model, selected);

  // O painel aceita dias passados (histórico); o resumo e o gráfico só datas de hoje em diante.
  const [pastPanelDate, setPastPanelDate] = useState<ISODate | null>(null);
  const panelDate = pastPanelDate && pastPanelDate < today ? pastPanelDate : selected;
  const selectFromCalendar = (d: ISODate) => {
    if (d < today) return setPastPanelDate(d);
    setPastPanelDate(null);
    select(d);
  };

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <p>O que vai acontecer com seu dinheiro</p>
          <h1>Previsão</h1>
        </div>
      </header>

      <section className="card">
        <div className="row between">
          <span className="eyebrow">Quanto vou ter em</span>
          <label className="chip" style={{ minHeight: 34 }}>
            <Icon name="calendar" size={16} /> {fmtRelative(selected, today)}
            <input
              type="date"
              className="date-native"
              value={selected}
              min={today}
              max={model.horizonEnd}
              onClick={(e) => e.currentTarget.showPicker?.()}
              onChange={(e) => {
                if (!e.target.value) return;
                select(e.target.value);
                setMonth(startOfMonth(e.target.value));
              }}
            />
          </label>
        </div>
        <Money className={`big-number tone-${status}`} cents={b.result} />
        <div style={{ marginTop: 4 }}><StatusSentence status={status} /></div>
        <dl className="kv" style={{ marginTop: 10 }}>
          <div><dt>Saldo atual</dt><dd><Money cents={b.startBalance} /></dd></div>
          <div><dt>Entradas até {fmtDayMonth(selected)}</dt><dd className="in"><Money cents={b.inflows} sign /></dd></div>
          <div><dt>Saídas até {fmtDayMonth(selected)}</dt><dd className="out"><Money cents={-b.outflows} /></dd></div>
          <div className="kv-total"><dt>Resultado</dt><dd><Money cents={b.result} /></dd></div>
        </dl>
      </section>

      <section className="card stack">
        <Segmented label="Período" value={rangePref >= needed ? rangePref : range} onChange={setRange} options={RANGES} />
        <ForecastChart days={days} floor={model.floor} selected={selected} lowestDate={lowest.date} onSelect={select} />
        <div className="chart-legend">
          <span><i />saldo previsto</span>
          <span><i className="dash" />segurança</span>
          <span><i className="dot" />menor saldo: {fmtDayMonth(lowest.date)}</span>
        </div>
        <div className="day-detail">
          <div className="day-detail-row">
            <strong>{fmtRelative(selected, today)}</strong>
            <span>Saldo previsto <Money cents={day.closing} /></span>
          </div>
          {day.events.length === 0 ? (
            <span className="muted">Nenhum movimento neste dia — o saldo continua igual.</span>
          ) : (
            day.events.map((e) => (
              <div key={e.key} className="day-detail-row">
                <span>{f.category(e.categoryId).emoji} {e.description || f.category(e.categoryId).name}</span>
                <Money className={e.direction === 'in' ? 'in' : 'out'} cents={e.direction === 'in' ? e.weighted : -e.weighted} sign />
              </div>
            ))
          )}
        </div>
      </section>

      <Segmented
        label="Visualização"
        value={ui.forecastView}
        onChange={ui.setForecastView}
        options={[{ value: 'calendar', label: 'Calendário' }, { value: 'statement', label: 'Extrato' }]}
      />

      {ui.forecastView === 'calendar' ? (
        <div className="calendar-layout">
          <section className="card">
            <FinanceCalendar month={month} onMonth={setMonth} selected={panelDate} onSelect={selectFromCalendar} />
          </section>
          <DayPanel date={panelDate} />
        </div>
      ) : (
        <Statement range={range} />
      )}
    </div>
  );
}

/** Extrato cronológico da previsão: saldo inicial, movimentos, saldo depois. */
function Statement({ range }: { range: number }) {
  const { model, today } = useFinance();
  const days = model.days.slice(0, range).filter((d, i) => i === 0 || d.events.length > 0);
  return (
    <section className="card card-list">
      {days.map((d) => (
        <div key={d.date} className="statement-day">
          <div className="day-label">{d.date === today ? 'Hoje' : fmtDayMonthUpper(d.date)}</div>
          <div className="statement-line"><span>Saldo inicial</span><Money cents={d.opening} /></div>
          {d.events.length === 0 && <div className="statement-line"><span>Sem movimentos previstos</span></div>}
          {d.events.map((e) => <EventRow key={e.key} event={e} />)}
          <div className="statement-line"><span>Depois</span><strong><Money cents={d.closing} /></strong></div>
          <div className="divider" />
        </div>
      ))}
    </section>
  );
}
