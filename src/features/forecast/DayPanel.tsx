import type { ISODate, Transaction } from '../../domain/types';
import { getDay, statusOf, type PendingEvent } from '../../engine';
import type { EditTarget } from '../../data/repository';
import { fmtLong, fmtRelative } from '../../lib/date';
import { useFinance } from '../../state/finance';
import { Icon } from '../../ui/Icon';
import { Money } from '../../ui/primitives';
import { StatusSentence } from '../common/StatusSentence';
import { useMovementActions } from '../entry/useMovementActions';

interface DayItem {
  key: string;
  target: EditTarget;
  base: Transaction | PendingEvent;
  status: 'done' | 'planned' | 'overdue';
}

/** Lançamentos de um dia do calendário, com totais e ações. Lê tudo ao vivo do modelo. */
export function DayPanel({ date }: { date: ISODate }) {
  const f = useFinance();
  const actions = useMovementActions();
  const { model, snapshot, today } = f;
  const isPast = date < today;

  const realized: DayItem[] = snapshot.transactions
    .filter((t) => !t.deletedAt && t.status === 'done' && t.date === date && t.date <= today)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((t) => ({ key: `tx:${t.id}`, target: { tx: t, event: null }, base: t, status: 'done' }));

  const day = isPast ? null : getDay(model, date);
  const pending: DayItem[] = (day?.events ?? []).map((e) => ({
    key: e.key,
    target: { tx: e.txId ? snapshot.transactions.find((t) => t.id === e.txId) ?? null : null, event: e },
    base: e,
    status: e.overdue ? 'overdue' : 'planned',
  }));

  const items = [...realized, ...pending];
  const totals = items.reduce(
    (acc, it) => {
      acc[it.base.direction] += it.base.amount;
      return acc;
    },
    { in: 0, out: 0 },
  );
  const dayStatus = day ? statusOf(model, day.closing) : null;

  return (
    <section className="card day-panel" aria-label={`Lançamentos de ${fmtLong(date)}`}>
      <header className="day-panel-head">
        <div>
          <span className="eyebrow">{fmtRelative(date, today)}</span>
          <h3>{fmtLong(date)}</h3>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => actions.create(date)}>
          <Icon name="plus" size={16} /> Lançar
        </button>
      </header>

      <dl className="day-totals">
        <div><dt>Receitas</dt><dd className="in"><Money cents={totals.in} sign smart /></dd></div>
        <div><dt>Despesas</dt><dd className="out"><Money cents={-totals.out} smart /></dd></div>
        <div>
          <dt>Saldo previsto</dt>
          <dd>{day ? <Money className={`tone-${dayStatus}`} cents={day.closing} smart /> : <span className="muted">—</span>}</dd>
        </div>
      </dl>
      {day && dayStatus && <StatusSentence status={dayStatus} />}
      {isPast && <p className="field-hint">Dia passado: aparecem só os lançamentos realizados.</p>}

      <div className="day-list">
        {items.length === 0 ? (
          <p className="muted day-empty">Nenhum lançamento neste dia.</p>
        ) : (
          items.map((it) => <DayRow key={it.key} item={it} onEdit={() => actions.edit(it.target)} onDelete={() => actions.confirmDelete(it.target)} />)
        )}
      </div>
    </section>
  );
}

const STATUS_PILL = {
  done: { label: 'Realizado', cls: 'pill-ok' },
  planned: { label: 'Previsto', cls: 'pill-info' },
  overdue: { label: 'Atrasado', cls: 'pill-risk' },
} as const;

function DayRow({ item, onEdit, onDelete }: { item: DayItem; onEdit: () => void; onDelete: () => void }) {
  const { category } = useFinance();
  const cat = category(item.base.categoryId);
  const isIn = item.base.direction === 'in';
  const pill = STATUS_PILL[item.status];
  const isAdjustment = item.target.tx?.kind === 'adjustment';
  const title = item.base.description || cat.name;

  return (
    <div className="day-row">
      <span className="emoji-badge" aria-hidden="true">{cat.emoji}</span>
      <span className="movement-main">
        <span className="movement-title">{title}</span>
        <span className="movement-sub">
          <span className={`pill ${pill.cls}`}>{pill.label}</span>
          {cat.name}
        </span>
      </span>
      <Money className={`movement-amount ${isIn ? 'in' : ''}`} cents={isIn ? item.base.amount : -item.base.amount} sign smart />
      <span className="day-row-actions">
        {!isAdjustment && (
          <button className="icon-btn icon-btn-sm" aria-label={`Editar ${title}`} onClick={onEdit}>
            <Icon name="edit" size={16} />
          </button>
        )}
        <button className="icon-btn icon-btn-sm" aria-label={`Excluir ${title}`} onClick={onDelete}>
          <Icon name="trash" size={16} />
        </button>
      </span>
    </div>
  );
}
