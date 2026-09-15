import type { ISODate } from '../../domain/types';
import { explainProjectedBalance, statusOf } from '../../engine';
import { fmtDayMonth } from '../../lib/date';
import { useFinance } from '../../state/finance';
import { useUI } from '../../state/ui';
import { Money, Sheet } from '../../ui/primitives';
import { EventRow } from './MovementRow';
import { StatusSentence } from './StatusSentence';

/** "Quanto vou ter em X?" com a composição do número. */
export function BreakdownSheet({ close, date, title }: { close: () => void; date: ISODate; title?: string }) {
  const f = useFinance();
  const ui = useUI();
  const b = explainProjectedBalance(f.model, date);
  const status = statusOf(f.model, b.result);
  return (
    <Sheet
      title={title ?? `Previsão para ${fmtDayMonth(date)}`}
      onClose={close}
      footer={
        <button className="btn btn-secondary btn-block" onClick={() => { close(); ui.openForecast({ date }); }}>
          Ver no gráfico
        </button>
      }
    >
      <div className="card">
        <span className="eyebrow">Saldo previsto</span>
        <Money className={`big-number tone-${status}`} cents={b.result} />
        <div style={{ marginTop: 6 }}><StatusSentence status={status} /></div>
        <dl className="kv" style={{ marginTop: 12 }}>
          <div><dt>Saldo atual</dt><dd><Money cents={b.startBalance} /></dd></div>
          <div><dt>Entradas até a data</dt><dd className="in"><Money cents={b.inflows} sign /></dd></div>
          <div><dt>Saídas até a data</dt><dd className="out"><Money cents={-b.outflows} /></dd></div>
          <div className="kv-total"><dt>Resultado</dt><dd><Money cents={b.result} /></dd></div>
        </dl>
      </div>
      {b.events.length > 0 && (
        <div className="card card-list">
          {b.events.map((e) => <EventRow key={e.key} event={e} subtitle={fmtDayMonth(e.originalDate)} />)}
        </div>
      )}
    </Sheet>
  );
}
