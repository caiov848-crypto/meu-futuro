import { useState } from 'react';
import type { AccountType, Cents, ISODate } from '../../domain/types';
import { ACCOUNT_COLORS, ACCOUNT_TYPE_LABELS } from '../../domain/defaults';
import { calculateRequiredSavings, simulateSpend } from '../../engine';
import {
  deleteAccount, deleteGoal, deleteProtected, saveAccount, saveGoal, saveProtected, updateSettings,
} from '../../data/repository';
import { addDays, fmtDayMonth } from '../../lib/date';
import { formatMoney } from '../../lib/money';
import { useFinance } from '../../state/finance';
import { useUI } from '../../state/ui';
import { AmountInput, Chip, ConfirmSheet, DateShortcuts, Field, Money, Sheet } from '../../ui/primitives';
import { EntrySheet } from '../entry/EntrySheet';

const fm = (c: Cents) => formatMoney(c, { smart: true });

/* ---------------- Posso gastar? ---------------- */

export function CanSpendSheet({ close }: { close: () => void }) {
  const f = useFinance();
  const ui = useUI();
  const [amount, setAmount] = useState<Cents>(0);
  const [date, setDate] = useState<ISODate>(f.today);
  const [safety, setSafety] = useState<Cents>(f.model.safetyLimit);
  const sim = amount > 0 ? simulateSpend(f.model, { amount, date, safety }) : null;

  return (
    <Sheet
      title="Posso gastar?"
      subtitle="Só um teste — nada é salvo."
      onClose={close}
      footer={
        sim && (
          <button
            className="btn btn-secondary btn-block"
            onClick={() => ui.openSheet((c) => (
              <EntrySheet close={c} preset={{ mode: date === f.today ? 'spent' : 'willSpend', amount, date }} />
            ))}
          >
            {date === f.today ? 'Registrar este gasto' : 'Salvar como gasto previsto'}
          </button>
        )
      }
    >
      <AmountInput value={amount} onChange={setAmount} autoFocus label="Vou gastar" />
      <Field label="Quando?">
        <DateShortcuts value={date} today={f.today} onChange={setDate} mode="future" min={f.today} max={f.model.horizonEnd} />
      </Field>
      <Field label="Segurança" hint="Saldo mínimo que você quer manter.">
        <AmountInput size="md" value={safety} onChange={setSafety} label="Segurança" />
      </Field>

      {sim ? (
        <div className="result" data-tone={sim.ok ? (sim.status === 'attention' ? 'warn' : 'ok') : 'bad'}>
          <span className="result-title">{sim.ok ? '✅ Pode gastar' : '⚠️ Melhor não'}</span>
          {sim.ok ? (
            <p>
              Seu menor saldo até {fmtDayMonth(sim.until)} fica em <b>{fm(sim.lowestAfter.balance)}</b> ({fmtDayMonth(sim.lowestAfter.date)}),{' '}
              {fm(sim.margin)} acima da segurança.
            </p>
          ) : (
            <p>
              Em {fmtDayMonth(sim.lowestAfter.date)} seu saldo ficaria em <b>{fm(sim.lowestAfter.balance)}</b>,{' '}
              {fm(-sim.margin)} abaixo da segurança. O máximo seguro nessa data é <b>{fm(sim.maxSafe)}</b>.
            </p>
          )}
          <dl className="kv">
            <div><dt>Saldo previsto em {fmtDayMonth(sim.date)}</dt><dd><Money cents={sim.balanceBefore} /></dd></div>
            <div><dt>Depois do gasto</dt><dd><Money cents={sim.balanceAfter} /></dd></div>
          </dl>
        </div>
      ) : (
        <p className="note">Hoje você pode gastar até <b>&nbsp;{fm(f.safe.amount)}&nbsp;</b> sem ficar abaixo da segurança.</p>
      )}
    </Sheet>
  );
}

/* ---------------- Quanto preciso juntar? / Meta ---------------- */

export function SaveUpSheet({ close, goalId }: { close: () => void; goalId?: string }) {
  const f = useFinance();
  const ui = useUI();
  const goal = goalId ? f.snapshot.goals.find((g) => g.id === goalId) : undefined;
  const [name, setName] = useState(goal?.name ?? '');
  const [amount, setAmount] = useState<Cents>(goal?.amount ?? 0);
  const [date, setDate] = useState<ISODate>(goal?.date ?? addDays(f.today, 7));
  const [safety, setSafety] = useState<Cents>(goal?.safetyOverride ?? f.model.safetyLimit);
  const r = amount > 0 ? calculateRequiredSavings(f.model, { amount, date, safety }) : null;

  const save = async () => {
    await saveGoal({
      id: goal?.id, name, amount, date,
      safetyOverride: safety === f.model.safetyLimit ? null : safety,
    });
    close();
    ui.toast(goal ? '✅ Meta atualizada' : '✅ Meta salva', 'Ela se recalcula sozinha com a previsão.');
  };

  return (
    <Sheet
      title={goal ? goal.name : 'Quanto preciso juntar?'}
      subtitle={goal ? 'Meta — recalculada a cada lançamento' : 'Teste à vontade; só salva se você quiser.'}
      onClose={close}
      footer={
        <>
          {goal && (
            <button
              className="btn btn-danger"
              onClick={() => ui.openSheet((c) => (
                <ConfirmSheet close={c} title="Excluir meta?" message={goal.name} confirmLabel="Excluir" danger
                  onConfirm={async () => { await deleteGoal(goal.id); close(); ui.toast('Meta excluída', undefined, 'neutral'); }} />
              ))}
            >
              Excluir
            </button>
          )}
          <button className="btn btn-primary" disabled={!r} onClick={save}>{goal ? 'Salvar' : 'Salvar como meta'}</button>
        </>
      }
    >
      <AmountInput value={amount} onChange={setAmount} autoFocus={!goal} label="Quero gastar" />
      <Field label="Data do gasto">
        <DateShortcuts value={date} today={f.today} onChange={setDate} mode="future" min={f.today} max={f.model.horizonEnd} />
      </Field>
      <Field label="Saldo mínimo de segurança">
        <AmountInput size="md" value={safety} onChange={setSafety} label="Segurança" />
      </Field>

      {r && (
        <>
          <div className="result" data-tone={r.guaranteed ? 'ok' : 'warn'}>
            {r.guaranteed ? (
              <>
                <span className="result-title">✅ Já está garantido</span>
                <p>Margem de <b>{fm(r.margin)}</b> em {fmtDayMonth(r.date)}.</p>
              </>
            ) : (
              <>
                <span className="result-title">⚠️ Ainda falta juntar</span>
                <Money className="result-amount" cents={r.shortfall} />
                <p>Até {fmtDayMonth(r.date)}{r.daysLeft > 0 ? ` (${r.daysLeft} dias)` : ''}.</p>
              </>
            )}
            <dl className="kv">
              <div><dt>Gasto desejado</dt><dd><Money cents={r.amount} /></dd></div>
              <div><dt>Segurança</dt><dd><Money cents={r.safety} /></dd></div>
              {r.protectedTotal > 0 && <div><dt>Dinheiro protegido</dt><dd><Money cents={r.protectedTotal} /></dd></div>}
              <div><dt>Necessário</dt><dd><Money cents={r.needed} /></dd></div>
              <div><dt>Saldo projetado em {fmtDayMonth(r.date)}</dt><dd><Money cents={r.projected} /></dd></div>
              <div className="kv-total">
                <dt>{r.guaranteed ? 'Margem' : 'Falta'}</dt>
                <dd><Money cents={r.guaranteed ? r.margin : r.shortfall} /></dd>
              </div>
            </dl>
          </div>
          {r.laterDip && (
            <p className="note">⚠️ Depois do gasto, em {fmtDayMonth(r.laterDip.date)} seu saldo ficaria em {fm(r.laterDip.balance)}, abaixo da segurança.</p>
          )}
          <Field label="Nome (para salvar como meta)">
            <input className="input" placeholder="Ex.: Viagem" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {goal && (
            <button className="btn btn-ghost" onClick={() => ui.openSheet((c) => (
              <EntrySheet close={c} preset={{ mode: 'willSpend', amount, date, description: goal.name }} />
            ))}>
              Lançar como gasto previsto
            </button>
          )}
        </>
      )}
    </Sheet>
  );
}

/* ---------------- Separar dinheiro ---------------- */

export function ProtectSheet({ close, id }: { close: () => void; id?: string }) {
  const f = useFinance();
  const ui = useUI();
  const existing = id ? f.snapshot.protectedMoney.find((p) => p.id === id) : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [amount, setAmount] = useState<Cents>(existing?.amount ?? 0);
  const freeAfter = f.model.freeBalance + (existing?.amount ?? 0) - amount;

  return (
    <Sheet
      title="Separar dinheiro"
      subtitle="Você decide. Nada é movido automaticamente."
      onClose={close}
      footer={
        <>
          {existing && (
            <button className="btn btn-danger" onClick={async () => { await deleteProtected(existing.id); close(); ui.toast('Dinheiro liberado', undefined, 'neutral'); }}>
              Liberar
            </button>
          )}
          <button className="btn btn-primary" disabled={amount <= 0} onClick={async () => {
            await saveProtected({ id: existing?.id, name, amount });
            close();
            ui.toast('🛡️ Dinheiro protegido', `Livre agora: ${fm(freeAfter)}`);
          }}>
            Proteger
          </button>
        </>
      }
    >
      <AmountInput value={amount} onChange={setAmount} autoFocus={!existing} label="Quanto separar?" />
      <Field label="Para quê?">
        <input className="input" placeholder="Ex.: Presente, IPVA…" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="card">
        <dl className="kv">
          <div><dt>Saldo real</dt><dd><Money cents={f.model.currentBalance} /></dd></div>
          <div><dt>Protegido</dt><dd><Money cents={f.model.protectedTotal - (existing?.amount ?? 0) + amount} /></dd></div>
          <div className="kv-total"><dt>Livre</dt><dd className={freeAfter < 0 ? 'out' : ''}><Money cents={freeAfter} /></dd></div>
        </dl>
      </div>
      <p className="field-hint">O valor protegido fica fora do "quanto posso gastar" e soma à sua segurança nas simulações.</p>
    </Sheet>
  );
}

/* ---------------- Contas ---------------- */

export function AccountSheet({ close, id }: { close: () => void; id?: string }) {
  const f = useFinance();
  const ui = useUI();
  const current = id ? f.model.accountBalances.find((a) => a.account.id === id) : undefined;
  const [name, setName] = useState(current?.account.name ?? '');
  const [type, setType] = useState<AccountType>(current?.account.type ?? 'bank');
  const [color, setColor] = useState(current?.account.color ?? ACCOUNT_COLORS[f.model.accountBalances.length % ACCOUNT_COLORS.length]);
  const [balance, setBalance] = useState<Cents>(current?.balance ?? 0);

  return (
    <Sheet
      title={current ? current.account.name : 'Adicionar conta'}
      onClose={close}
      footer={
        <>
          {current && (
            <button className="btn btn-danger" onClick={() => ui.openSheet((c) => (
              <ConfirmSheet close={c} title="Excluir conta?" danger confirmLabel="Excluir"
                message="O saldo e os lançamentos desta conta deixam de contar no total."
                onConfirm={async () => { await deleteAccount(current.account.id); close(); ui.toast('Conta excluída', undefined, 'neutral'); }} />
            ))}>
              Excluir
            </button>
          )}
          <button className="btn btn-primary" disabled={!name.trim()} onClick={async () => {
            await saveAccount({ id, name, type, color, balance });
            close();
            ui.toast(current ? '✅ Conta atualizada' : '✅ Conta adicionada', 'Saldo atualizado.');
          }}>
            Salvar
          </button>
        </>
      }
    >
      <Field label="Nome">
        <input className="input" placeholder="Ex.: Santander" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!current} />
      </Field>
      <Field label="Tipo">
        <div className="chips">
          {(Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((t) => (
            <Chip key={t} active={type === t} onClick={() => setType(t)}>{ACCOUNT_TYPE_LABELS[t]}</Chip>
          ))}
        </div>
      </Field>
      <Field label="Cor">
        <div className="swatches">
          {ACCOUNT_COLORS.map((c) => (
            <button key={c} type="button" className="swatch" style={{ background: c }} aria-pressed={color === c} aria-label={`Cor ${c}`} onClick={() => setColor(c)} />
          ))}
        </div>
      </Field>
      <Field label="Saldo atual" hint={current ? 'Se mudar, registramos um ajuste com a diferença.' : undefined}>
        <AmountInput size="md" value={balance} onChange={setBalance} label="Saldo atual" />
      </Field>
    </Sheet>
  );
}

export function AccountsSheet({ close }: { close: () => void }) {
  const f = useFinance();
  const ui = useUI();
  return (
    <Sheet
      title="Saldo real"
      subtitle="Dinheiro que existe agora"
      onClose={close}
      footer={<button className="btn btn-secondary btn-block" onClick={() => ui.openSheet((c) => <AccountSheet close={c} />)}>Adicionar conta</button>}
    >
      <div className="card card-list">
        {f.model.accountBalances.map(({ account, balance }, i) => (
          <div key={account.id}>
            {i > 0 && <div className="divider" />}
            <button className="settings-row" onClick={() => ui.openSheet((c) => <AccountSheet close={c} id={account.id} />)}>
              <span className="account-dot" style={{ background: account.color, width: 12, height: 12 }} />
              <div>
                <strong>{account.name}</strong>
                <small>{ACCOUNT_TYPE_LABELS[account.type]} · toque para ajustar</small>
              </div>
              <Money cents={balance} />
            </button>
          </div>
        ))}
        {f.model.unassignedBalance !== 0 && (
          <div className="settings-row"><div><strong>Sem conta</strong><small>Lançamentos sem conta definida</small></div><Money cents={f.model.unassignedBalance} /></div>
        )}
        <div className="divider" />
        <div className="settings-row"><div><strong>Total</strong></div><strong><Money cents={f.model.currentBalance} /></strong></div>
      </div>
    </Sheet>
  );
}

/* ---------------- Reserva ---------------- */

export function ReserveSheet({ close }: { close: () => void }) {
  const f = useFinance();
  const ui = useUI();
  const [target, setTarget] = useState<Cents>(f.snapshot.settings.reserveTarget);
  const [current, setCurrent] = useState<Cents>(f.snapshot.settings.reserveCurrent);
  return (
    <Sheet
      title="Reserva de segurança"
      subtitle="Uma meta manual — não mexe no seu saldo livre."
      onClose={close}
      footer={<button className="btn btn-primary btn-block" onClick={async () => {
        await updateSettings({ reserveTarget: target, reserveCurrent: current });
        close();
        ui.toast('✅ Reserva atualizada');
      }}>Salvar</button>}
    >
      <Field label="Meta"><AmountInput size="md" value={target} onChange={setTarget} label="Meta" /></Field>
      <Field label="Quanto já tenho guardado"><AmountInput size="md" value={current} onChange={setCurrent} label="Atual" /></Field>
    </Sheet>
  );
}
