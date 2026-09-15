import type { Cents, Direction, Transaction } from '../../domain/types';
import type { PendingEvent } from '../../engine';
import { useFinance } from '../../state/finance';
import { useUI } from '../../state/ui';
import { Money } from '../../ui/primitives';
import { MovementSheet } from '../entry/MovementSheet';

export function MovementRow(props: {
  emoji: string;
  title: string;
  subtitle?: string;
  amount: Cents;
  direction: Direction;
  tag?: { label: string; tone: 'risk' | 'attention' | 'info' | 'ok' };
  onClick?: () => void;
}) {
  return (
    <button className="movement" onClick={props.onClick}>
      <span className="emoji-badge" aria-hidden="true">{props.emoji}</span>
      <span className="movement-main">
        <span className="movement-title">{props.title}</span>
        {(props.subtitle || props.tag) && (
          <span className="movement-sub">
            {props.tag && <span className={`pill pill-${props.tag.tone}`}>{props.tag.label}</span>}
            {props.subtitle}
          </span>
        )}
      </span>
      <Money
        className={`movement-amount ${props.direction === 'in' ? 'in' : ''}`}
        cents={props.direction === 'in' ? props.amount : -props.amount}
        sign
      />
    </button>
  );
}

/** Linha de um movimento previsto (evento do motor). */
export function EventRow({ event, subtitle }: { event: PendingEvent; subtitle?: string }) {
  const { category } = useFinance();
  const ui = useUI();
  const cat = category(event.categoryId);
  return (
    <MovementRow
      emoji={cat.emoji}
      title={event.description || cat.name}
      subtitle={subtitle ?? (event.description ? cat.name : undefined)}
      amount={event.amount}
      direction={event.direction}
      tag={event.overdue ? { label: event.direction === 'out' ? 'Vencida' : 'Atrasada', tone: 'risk' } : event.certainty !== 'confirmed' ? { label: event.certainty === 'probable' ? 'Provável' : 'Prevista', tone: 'info' } : undefined}
      onClick={() => ui.openSheet((close) => <MovementSheet close={close} txId={event.txId} eventKey={event.key} />)}
    />
  );
}

/** Linha de um lançamento gravado. */
export function TxRow({ tx, subtitle }: { tx: Transaction; subtitle?: string }) {
  const { category } = useFinance();
  const ui = useUI();
  const cat = category(tx.categoryId);
  return (
    <MovementRow
      emoji={cat.emoji}
      title={tx.description || cat.name}
      subtitle={subtitle ?? (tx.description ? cat.name : undefined)}
      amount={tx.amount}
      direction={tx.direction}
      tag={tx.status === 'planned' ? { label: 'Previsto', tone: 'info' } : undefined}
      onClick={() => ui.openSheet((close) => <MovementSheet close={close} txId={tx.id} eventKey={tx.status === 'planned' ? `tx:${tx.id}` : null} />)}
    />
  );
}
