import type { ReactNode } from 'react';
import type { Alert } from '../../engine';
import { markDone } from '../../data/repository';
import { fmtDayMonth, fmtDayMonthUpper, fmtLong, monthName, weekday } from '../../lib/date';
import { formatMoney } from '../../lib/money';
import { useFinance } from '../../state/finance';
import { useUI } from '../../state/ui';
import { Icon } from '../../ui/Icon';
import { Money } from '../../ui/primitives';
import { BreakdownSheet } from '../common/BreakdownSheet';
import { EventRow, TxRow } from '../common/MovementRow';
import { StatusSentence } from '../common/StatusSentence';
import { CanSpendSheet, SaveUpSheet } from '../plan/sheets';

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

export function TodayScreen() {
  const f = useFinance();
  const ui = useUI();
  const { model, safe, lowest, monthEnd, alerts, today } = f;
  const floorLabel = formatMoney(model.safetyLimit, { smart: true });
  const spendable = Math.floor(safe.amount / 100) * 100;

  const upcoming = model.events.filter((e) => !e.overdue).slice(0, 5);
  const todayDone = model.todayDone.slice(0, 3);

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <p>{WEEKDAYS[weekday(today)]}, {fmtLong(today).replace(/ de \d{4}$/, '')}</p>
          <h1>Hoje</h1>
        </div>
      </header>

      <section className="hero" aria-label="Resumo de hoje">
        <div className="hero-top">
          <div>
            <span className="eyebrow">Dinheiro livre</span>
            <Money className="hero-free" cents={model.freeBalance} />
          </div>
          <button className="hero-chip" onClick={() => ui.setTab('plan')}>
            <Icon name="shield" size={14} /> Protegido <Money cents={model.protectedTotal} smart />
          </button>
        </div>
        <p className="hero-caption">
          Seu saldo real agora{model.protectedTotal > 0 ? ', sem o dinheiro protegido' : ''}.
        </p>

        <div className="hero-spend">
          <span className="eyebrow">Você pode gastar hoje</span>
          <Money className={`hero-amount ${spendable === 0 ? 'zero' : ''}`} cents={spendable} round />
          {spendable > 0 ? (
            <>
              <p>Sem deixar seu saldo abaixo de {floorLabel} até {fmtDayMonth(safe.until)}.</p>
              <p className="per-day">Ou cerca de {formatMoney(safe.perDay, { round: true })} por dia até lá.</p>
            </>
          ) : (
            <p>
              O ideal é segurar os gastos: em {fmtDayMonth(safe.limitingDate)} seu saldo previsto fica perto ou abaixo de {floorLabel}.
            </p>
          )}
          <div className="hero-actions">
            <button className="btn btn-on-dark btn-sm" onClick={() => ui.openSheet((c) => <CanSpendSheet close={c} />)}>
              Simular um gasto
            </button>
          </div>
        </div>
      </section>

      <div className="grid-2">
        <button className="card card-button" onClick={() => ui.openSheet((c) => <BreakdownSheet close={c} date={monthEnd.date} />)}>
          <span className="card-label">Fim de {monthName(today)}</span>
          <Money className="card-value" cents={monthEnd.balance} />
          <span className="card-caption">Saldo estimado no fim do mês. Toque para ver a conta.</span>
        </button>
        <button className="card card-button" onClick={() => ui.openForecast({ date: lowest.date })}>
          <span className="card-label">Dia mais apertado</span>
          <Money className={`card-value tone-${lowest.status}`} cents={lowest.balance} />
          <span className="card-caption">em {fmtDayMonth(lowest.date)}</span>
          <StatusSentence status={lowest.status} />
        </button>
      </div>

      <section className="section" aria-label="Precisa da sua atenção">
        <div className="section-head"><h2>Precisa da sua atenção</h2></div>
        {alerts.length === 0 ? (
          <div className="calm"><Icon name="check" size={18} /> Nada preocupante no horizonte.</div>
        ) : (
          alerts.slice(0, 4).map((a) => <AlertCard key={a.key} alert={a} />)
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Próximos movimentos</h2>
          <button className="link" onClick={() => ui.openForecast({ view: 'statement' })}>Ver todos</button>
        </div>
        <div className="card card-list">
          {todayDone.length === 0 && upcoming.length === 0 && (
            <p className="muted" style={{ padding: '14px 16px' }}>Nenhum movimento previsto. Toque em + para lançar.</p>
          )}
          {todayDone.length > 0 && <div className="day-label">Hoje</div>}
          {todayDone.map((t) => <TxRow key={t.id} tx={t} />)}
          {groupByDate(upcoming, (e) => e.date).map(([date, evs]) => (
            <div key={date}>
              <div className="day-label">{date === today ? 'Hoje · previsto' : fmtDayMonthUpper(date)}</div>
              {evs.map((e) => <EventRow key={e.key} event={e} />)}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function groupByDate<T>(items: T[], key: (t: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    map.set(k, [...(map.get(k) ?? []), it]);
  }
  return [...map.entries()];
}

function AlertCard({ alert }: { alert: Alert }) {
  const f = useFinance();
  const ui = useUI();
  let title: string;
  let detail: ReactNode;
  let action: { label: string; run: () => void };

  switch (alert.kind) {
    case 'overdue-bill':
    case 'late-income': {
      const e = alert.event!;
      const cat = f.category(e.categoryId);
      const isIn = alert.kind === 'late-income';
      title = `${isIn ? 'Entrada atrasada' : 'Conta vencida'} — ${e.description || cat.name}`;
      detail = <>{formatMoney(e.amount, { smart: true })} · {isIn ? 'era para' : 'venceu em'} {fmtDayMonth(e.originalDate)}</>;
      action = {
        label: isIn ? 'Recebi' : 'Paguei',
        run: async () => {
          await markDone(e);
          ui.toast(isIn ? '✅ Marcado como recebido' : '✅ Marcado como pago', 'Saldo atualizado.');
        },
      };
      break;
    }
    case 'below-safety':
      title = 'Saldo abaixo da segurança';
      detail = <>Em {fmtDayMonth(alert.date)} a previsão é {formatMoney(alert.amount, { smart: true })}.</>;
      action = { label: 'Ver', run: () => ui.openForecast({ date: alert.date }) };
      break;
    case 'goal-at-risk':
      title = `Meta em risco — ${alert.goal!.goal.name}`;
      detail = <>Faltam {formatMoney(alert.amount, { smart: true })} até {fmtDayMonth(alert.date)}.</>;
      action = { label: 'Ver meta', run: () => ui.openSheet((c) => <SaveUpSheet close={c} goalId={alert.goal!.goal.id} />) };
      break;
  }

  return (
    <div className="alert" data-severity={alert.severity}>
      <div className="alert-body">
        <div className="alert-title">{title}</div>
        <div className="alert-detail">{detail}</div>
      </div>
      <button className="btn btn-secondary btn-sm" onClick={action.run}>{action.label}</button>
    </div>
  );
}
