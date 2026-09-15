import type { ISODate } from '../../domain/types';
import { deleteEntry, seriesInfo, type EditTarget } from '../../data/repository';
import { formatMoney } from '../../lib/money';
import { useFinance } from '../../state/finance';
import { useUI } from '../../state/ui';
import { ConfirmSheet } from '../../ui/primitives';
import { EntrySheet } from './EntrySheet';
import { ScopeSheet } from './ScopeSheet';

/** Editar, excluir (com confirmação) e lançar — compartilhado entre detalhes e painel do dia. */
export function useMovementActions() {
  const f = useFinance();
  const ui = useUI();

  const edit = (target: EditTarget) => ui.openSheet((c) => <EntrySheet close={c} target={target} />);

  const create = (date: ISODate) => ui.openSheet((c) => <EntrySheet close={c} preset={{ date }} />);

  const confirmDelete = (target: EditTarget) => {
    const base = target.event ?? target.tx;
    if (!base) return;
    const run = async (scope: 'this' | 'following' | 'all') => {
      await deleteEntry(target, scope);
      ui.closeAllSheets();
      ui.toast('Lançamento excluído', 'Previsão recalculada.', 'neutral');
    };
    if (seriesInfo(target).isSeries) {
      ui.openSheet((c) => <ScopeSheet close={c} action="delete" onChoose={run} />);
      return;
    }
    const name = base.description || f.category(base.categoryId).name;
    ui.openSheet((c) => (
      <ConfirmSheet
        close={c}
        title="Excluir lançamento?"
        message={`${name} — ${formatMoney(base.amount)}. O saldo e a previsão serão recalculados.`}
        confirmLabel="Excluir"
        danger
        onConfirm={() => run('this')}
      />
    ));
  };

  return { edit, create, confirmDelete };
}
