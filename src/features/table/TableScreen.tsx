import { useMemo } from 'react';
import { useFinance } from '../../state/finance';
import { formatCents } from '../../lib/currency';
import { formatDateShort } from '../../lib/date';
import { Icon } from '../../ui/Icon';
import { useUI } from '../../state/ui';
import { EntrySheet } from '../entry/EntrySheet';

export function TableScreen() {
  const { snapshot, category } = useFinance();
  const ui = useUI();

  // Filter out deleted transactions and sort by date descending
  const transactions = useMemo(() => {
    return snapshot.transactions
      .filter((t) => !t.deletedAt)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }, [snapshot.transactions]);

  const accountName = (id: string | null) => {
    if (!id) return '-';
    const acc = snapshot.accounts.find(a => a.id === id);
    return acc ? acc.name : '-';
  };

  return (
    <div className="screen table-screen">
      <header className="header">
        <div className="header-title">
          <h1>Tabela de Lançamentos</h1>
        </div>
      </header>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Descrição</th>
              <th>Categoria</th>
              <th>Conta</th>
              <th className="amount-cell">Valor</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx) => {
              const cat = category(tx.categoryId);
              return (
                <tr key={tx.id} className={tx.status === 'planned' ? 'planned-row' : ''}>
                  <td className="date-cell">{formatDateShort(tx.date)}</td>
                  <td className="desc-cell">
                    <span className="desc-text">{tx.description}</span>
                    {tx.note && <span className="desc-note" title={tx.note}> 📝</span>}
                  </td>
                  <td className="cat-cell">
                    <span className="cat-emoji">{cat.emoji}</span> {cat.name}
                  </td>
                  <td className="acc-cell">{accountName(tx.accountId)}</td>
                  <td className={`amount-cell ${tx.direction}`}>
                    {tx.direction === 'out' ? '-' : '+'}{formatCents(tx.amount)}
                  </td>
                  <td className="status-cell">
                    {tx.status === 'done' ? (
                      <span className="badge badge-done">Realizado</span>
                    ) : (
                      <span className="badge badge-planned">Previsto</span>
                    )}
                  </td>
                  <td className="actions-cell">
                    <button 
                      className="icon-btn" 
                      onClick={() => ui.openSheet((c) => <EntrySheet close={c} target={{ tx, event: null }} />)}
                      aria-label="Editar"
                    >
                      <Icon name="edit" size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {transactions.length === 0 && (
              <tr>
                <td colSpan={7} className="empty-cell">Nenhum lançamento encontrado.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
