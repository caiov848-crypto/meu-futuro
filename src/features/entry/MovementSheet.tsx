import { useEffect } from 'react';
import { ACCOUNT_TYPE_LABELS, CERTAINTY_LABELS, PAYMENT_LABELS } from '../../domain/defaults';
import { FREQUENCY_LABELS } from '../../engine';
import { markDone, type EditTarget } from '../../data/repository';
import { fmtLong, fmtRelative, parts } from '../../lib/date';
import { useFinance } from '../../state/finance';
import { useUI } from '../../state/ui';
import { Icon } from '../../ui/Icon';
import { Money, Sheet } from '../../ui/primitives';
import { useMovementActions } from './useMovementActions';

/** Detalhes de um lançamento ou ocorrência prevista, sempre lido ao vivo do estado. */
export function MovementSheet({ close, txId, eventKey }: { close: () => void; txId: string | null; eventKey: string | null }) {
  const f = useFinance();
  const ui = useUI();
  const actions = useMovementActions();
  const tx = txId ? f.snapshot.transactions.find((t) => t.id === txId && !t.deletedAt) ?? null : null;
  const event = eventKey ? f.model.events.find((e) => e.key === eventKey) ?? null : null;
  const gone = !tx && !event;

  useEffect(() => {
    if (gone) close();
  }, [gone, close]);
  if (gone) return null;

  const target: EditTarget = { tx, event };
  const base = event ?? tx!;
  const cat = f.category(base.categoryId);
  const date = event?.originalDate ?? tx!.date;
  const pending = Boolean(event);
  const ruleId = event?.ruleId ?? tx?.recurrenceId ?? null;
  const rule = ruleId ? f.snapshot.rules.find((r) => r.id === ruleId) : null;
  const account = base.accountId ? f.snapshot.accounts.find((a) => a.id === base.accountId) : null;
  const isIn = base.direction === 'in';
  const isAdjustment = tx?.kind === 'adjustment';

  const statusPill = event?.overdue
    ? <span className="pill pill-risk">{isIn ? 'Entrada atrasada' : 'Conta vencida'}</span>
    : pending
      ? <span className="pill pill-info">Previsto</span>
      : <span className="pill pill-ok">{isIn ? 'Recebido' : 'Pago'}</span>;

  const onMarkDone = async () => {
    if (!event) return;
    await markDone(event);
    close();
    ui.toast(isIn ? '✅ Marcado como recebido' : '✅ Marcado como pago', 'Saldo atualizado.');
  };

  const onDelete = () => actions.confirmDelete(target);

  const rows: [string, string][] = [
    ['Data', `${fmtRelative(date, f.today)} · ${fmtLong(date)}`],
    ['Categoria', `${cat.emoji} ${cat.name}`],
  ];
  if (account) rows.push(['Conta', `${account.name} · ${ACCOUNT_TYPE_LABELS[account.type]}`]);
  if (base.paymentMethod) rows.push(['Pagamento', PAYMENT_LABELS[base.paymentMethod]]);
  if (pending) rows.push(['Certeza', CERTAINTY_LABELS[base.certainty]]);
  if (rule) rows.push(['Repete', `${FREQUENCY_LABELS[rule.frequency]}${rule.frequency === 'monthly' ? ` · dia ${parts(rule.startDate)[2]}` : ''}`]);
  const note = event ? (tx?.note ?? rule?.template.note ?? '') : tx?.note ?? '';

  return (
    <Sheet
      title={base.description || cat.name}
      onClose={close}
      footer={
        isAdjustment ? (
          <button className="btn btn-danger" onClick={onDelete}><Icon name="trash" size={18} /> Desfazer ajuste</button>
        ) : (
          <>
            <button className="btn btn-ghost" onClick={onDelete} aria-label="Excluir"><Icon name="trash" size={18} /></button>
            <button className="btn btn-ghost" onClick={() => actions.edit(target)}>
              <Icon name="edit" size={18} /> Editar
            </button>
            {pending && (
              <button className="btn btn-primary" onClick={onMarkDone}>
                <Icon name="check" size={18} /> {isIn ? 'Recebido' : 'Pago'}
              </button>
            )}
          </>
        )
      }
    >
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span className="emoji-badge" style={{ width: 52, height: 52, fontSize: '1.6rem' }}>{cat.emoji}</span>
        <div style={{ flex: 1 }}>
          <Money className={`big-number ${isIn ? 'in' : ''}`} cents={isIn ? base.amount : -base.amount} sign />
          <div style={{ marginTop: 4 }}>{statusPill}</div>
        </div>
      </div>
      <div className="card">
        <dl className="kv">
          {rows.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
        {note && <p className="note" style={{ marginTop: 8 }}>{note}</p>}
      </div>
      {pending && !event!.overdue && (
        <p className="field-hint">Este movimento ainda não afetou seu saldo real; ele entra na previsão.</p>
      )}
    </Sheet>
  );
}
