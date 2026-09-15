import type { EditScope } from '../../data/operations';
import { Sheet } from '../../ui/primitives';
import { Icon } from '../../ui/Icon';

const OPTIONS: { scope: EditScope; title: string; detail: string }[] = [
  { scope: 'this', title: 'Somente este', detail: 'Os outros meses continuam iguais.' },
  { scope: 'following', title: 'Este e os próximos', detail: 'Os anteriores não mudam.' },
  { scope: 'all', title: 'Toda a série', detail: 'Pagamentos já feitos são mantidos.' },
];

export function ScopeSheet(props: { close: () => void; action: 'edit' | 'delete'; onChoose: (s: EditScope) => void | Promise<void> }) {
  return (
    <Sheet title={props.action === 'edit' ? 'Aplicar alteração em…' : 'Excluir…'} subtitle="Este lançamento se repete." onClose={props.close}>
      <div className="card card-list">
        {OPTIONS.map((o, i) => (
          <div key={o.scope}>
            {i > 0 && <div className="divider" />}
            <button className="settings-row" onClick={() => props.onChoose(o.scope)}>
              <div>
                <strong style={{ color: props.action === 'delete' ? 'var(--coral)' : undefined }}>{o.title}</strong>
                <small>{o.detail}</small>
              </div>
              <Icon name="right" size={18} />
            </button>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
