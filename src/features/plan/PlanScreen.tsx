import type { IconName } from '../../ui/Icon';
import { FREQUENCY_LABELS, type GoalStatus } from '../../engine';
import { fmtDayMonth, parts } from '../../lib/date';
import { formatMoney } from '../../lib/money';
import { useFinance } from '../../state/finance';
import { useUI } from '../../state/ui';
import { Icon } from '../../ui/Icon';
import { Money } from '../../ui/primitives';
import { MovementSheet } from '../entry/MovementSheet';
import { AccountSheet, AccountsSheet, CanSpendSheet, ProtectSheet, ReserveSheet, SaveUpSheet } from './sheets';

export function PlanScreen() {
  const f = useFinance();
  const ui = useUI();
  const { model, snapshot, goals } = f;
  const protectedList = snapshot.protectedMoney.filter((p) => !p.deletedAt);
  const rules = snapshot.rules.filter((r) => !r.deletedAt && (!r.endDate || r.endDate >= f.today));
  const { reserveTarget, reserveCurrent } = snapshot.settings;
  const reservePct = reserveTarget > 0 ? Math.min(100, Math.round((reserveCurrent / reserveTarget) * 100)) : 0;

  const tools: { icon: IconName; title: string; caption: string; open: () => void }[] = [
    { icon: 'spend', title: 'Posso gastar?', caption: 'Teste antes de gastar', open: () => ui.openSheet((c) => <CanSpendSheet close={c} />) },
    { icon: 'target', title: 'Quanto preciso juntar?', caption: 'Para um gasto numa data', open: () => ui.openSheet((c) => <SaveUpSheet close={c} />) },
    { icon: 'shield', title: 'Separar dinheiro', caption: 'Proteger um valor', open: () => ui.openSheet((c) => <ProtectSheet close={c} />) },
    { icon: 'wallet', title: 'Adicionar conta', caption: 'Banco, carteira, dinheiro', open: () => ui.openSheet((c) => <AccountSheet close={c} />) },
  ];

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <p>O que você quer fazer</p>
          <h1>Planejar</h1>
        </div>
      </header>

      <section className="card row between">
        <div>
          <span className="eyebrow">Saldo real</span>
          <Money className="big-number" cents={model.currentBalance} />
          <div className="summary-line" style={{ padding: 0, marginTop: 4 }}>
            {model.accountBalances.map(({ account, balance }) => (
              <span key={account.id} className="row" style={{ gap: 5 }}>
                <span className="account-dot" style={{ background: account.color }} />{account.name} {formatMoney(balance, { smart: true })}
              </span>
            ))}
          </div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => ui.openSheet((c) => <AccountsSheet close={c} />)}>Ajustar</button>
      </section>

      <div className="tool-grid">
        {tools.map((t) => (
          <button key={t.title} className="tool" onClick={t.open}>
            <span className="tool-icon"><Icon name={t.icon} size={20} /></span>
            <strong>{t.title}</strong>
            <small>{t.caption}</small>
          </button>
        ))}
      </div>

      <section className="section">
        <div className="section-head"><h2>Metas</h2></div>
        {goals.length === 0 ? (
          <p className="note">Use “Quanto preciso juntar?” e salve como meta para acompanhar aqui.</p>
        ) : (
          goals.map((g) => <GoalCard key={g.goal.id} g={g} />)
        )}
      </section>

      {protectedList.length > 0 && (
        <section className="section">
          <div className="section-head"><h2>Dinheiro protegido</h2><Money className="muted" cents={model.protectedTotal} /></div>
          <div className="card card-list">
            {protectedList.map((p, i) => (
              <div key={p.id}>
                {i > 0 && <div className="divider" />}
                <button className="settings-row" onClick={() => ui.openSheet((c) => <ProtectSheet close={c} id={p.id} />)}>
                  <Icon name="shield" size={18} />
                  <div><strong>{p.name}</strong></div>
                  <Money cents={p.amount} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head"><h2>Reserva</h2></div>
        <button className="card card-button" onClick={() => ui.openSheet((c) => <ReserveSheet close={c} />)}>
          {reserveTarget > 0 ? (
            <>
              <div className="row between" style={{ width: '100%' }}>
                <span><Money className="card-value" cents={reserveCurrent} /> <span className="muted">de {formatMoney(reserveTarget, { smart: true })}</span></span>
                <strong>{reservePct}%</strong>
              </div>
              <div className="progress" style={{ width: '100%' }} data-tone={reservePct >= 100 ? 'ok' : undefined}><span style={{ width: `${reservePct}%` }} /></div>
              <span className="card-caption">Meta manual. Não retira dinheiro do saldo livre.</span>
            </>
          ) : (
            <>
              <strong>Definir uma reserva</strong>
              <span className="card-caption">Uma meta de segurança de longo prazo, atualizada por você.</span>
            </>
          )}
        </button>
      </section>

      {rules.length > 0 && (
        <section className="section">
          <div className="section-head"><h2>Contas recorrentes</h2></div>
          <div className="card card-list">
            {rules.map((r, i) => {
              const cat = f.category(r.template.categoryId);
              const next = model.events.find((e) => e.ruleId === r.id);
              return (
                <div key={r.id}>
                  {i > 0 && <div className="divider" />}
                  <button
                    className="movement"
                    disabled={!next}
                    onClick={() => next && ui.openSheet((c) => <MovementSheet close={c} txId={next.txId} eventKey={next.key} />)}
                  >
                    <span className="emoji-badge">{cat.emoji}</span>
                    <span className="movement-main">
                      <span className="movement-title">{r.template.description || cat.name}</span>
                      <span className="movement-sub">
                        <Icon name="repeat" size={12} />
                        {FREQUENCY_LABELS[r.frequency]}{r.frequency === 'monthly' ? ` · dia ${parts(r.startDate)[2]}` : ''}
                        {next ? ` · próxima ${fmtDayMonth(next.originalDate)}` : ''}
                      </span>
                    </span>
                    <Money className={`movement-amount ${r.template.direction === 'in' ? 'in' : ''}`} cents={r.template.direction === 'in' ? r.template.amount : -r.template.amount} sign smart />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function GoalCard({ g }: { g: GoalStatus }) {
  const ui = useUI();
  const pct = g.needed > 0 ? Math.max(0, Math.min(100, Math.round((g.projected / g.needed) * 100))) : 100;
  return (
    <button className="card card-button goal" onClick={() => ui.openSheet((c) => <SaveUpSheet close={c} goalId={g.goal.id} />)}>
      <div className="row between" style={{ width: '100%' }}>
        <div>
          <strong>{g.goal.name}</strong>
          <div className="card-caption">{fmtDayMonth(g.goal.date)} · gasto de {formatMoney(g.amount, { smart: true })}</div>
        </div>
        {g.state === 'guaranteed' && <span className="pill pill-ok">✅ Garantido</span>}
        {g.state === 'at-risk' && <span className="pill pill-attention">⚠️ Faltam {formatMoney(g.shortfall, { smart: true })}</span>}
        {g.state === 'past' && <span className="pill">Data passou</span>}
      </div>
      <div className="progress" style={{ width: '100%' }} data-tone={g.guaranteed ? 'ok' : 'warn'}><span style={{ width: `${pct}%` }} /></div>
      <div className="summary-line" style={{ padding: 0 }}>
        <span>Necessário {formatMoney(g.needed, { smart: true })}</span>
        <span>Previsto {formatMoney(g.projected, { smart: true })}</span>
        {g.guaranteed && <span>Margem {formatMoney(g.margin, { smart: true })}</span>}
      </div>
    </button>
  );
}
