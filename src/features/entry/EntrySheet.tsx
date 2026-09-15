import { useMemo, useState } from 'react';
import type { Cents, Certainty, Frequency, ISODate, PaymentMethod } from '../../domain/types';
import { CERTAINTY_LABELS, PAYMENT_LABELS } from '../../domain/defaults';
import { buildSuggestions, FREQUENCY_LABELS, suggestForCategory } from '../../engine';
import { modeDirection, modeStatus, type EditScope, type EntryInput, type EntryMode } from '../../data/operations';
import { saveEntry, seriesInfo, updateEntry, type EditTarget } from '../../data/repository';
import { useFinance } from '../../state/finance';
import { useUI } from '../../state/ui';
import { Icon } from '../../ui/Icon';
import { AmountInput, Chip, DateShortcuts, Segmented, Sheet } from '../../ui/primitives';
import { ScopeSheet } from './ScopeSheet';
import { addDays } from '../../lib/date';

const MODES: { mode: EntryMode; title: string; caption: string }[] = [
  { mode: 'spent', title: 'Gastei', caption: 'Já saiu do bolso' },
  { mode: 'received', title: 'Recebi', caption: 'Já entrou' },
  { mode: 'willSpend', title: 'Vou gastar', caption: 'Conta ou gasto futuro' },
  { mode: 'willReceive', title: 'Vou receber', caption: 'Salário, pix a receber…' },
];

export interface EntryPreset {
  mode?: EntryMode;
  amount?: Cents;
  date?: ISODate;
  description?: string;
  categoryId?: string;
}

/**
 * Novo lançamento em poucos toques: Tipo → Valor → Categoria → Salvar.
 * Também edita lançamentos e ocorrências de séries.
 */
export function EntrySheet({ close, preset, target }: { close: () => void; preset?: EntryPreset; target?: EditTarget }) {
  const f = useFinance();
  const ui = useUI();
  const { snapshot, today } = f;
  const accounts = snapshot.accounts.filter((a) => !a.deletedAt).sort((a, b) => a.order - b.order);

  const initial = useMemo(() => {
    const src = target?.event ?? target?.tx;
    if (src) {
      const pending = Boolean(target?.event);
      const dir = src.direction;
      return {
        mode: (pending ? (dir === 'out' ? 'willSpend' : 'willReceive') : dir === 'out' ? 'spent' : 'received') as EntryMode,
        amount: src.amount,
        categoryId: src.categoryId,
        description: src.description,
        date: target?.event?.originalDate ?? target!.tx!.date,
        accountId: src.accountId,
        paymentMethod: src.paymentMethod,
        certainty: src.certainty,
        note: target?.tx?.note ?? '',
      };
    }
    return {
      mode: preset?.mode ?? null,
      amount: preset?.amount ?? 0,
      categoryId: preset?.categoryId ?? null,
      description: preset?.description ?? '',
      date: preset?.date ?? today,
      accountId: accounts.length === 1 ? accounts[0].id : null,
      paymentMethod: null,
      certainty: 'confirmed' as Certainty,
      note: '',
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editing = Boolean(target);
  const series = target ? seriesInfo(target) : null;
  const rule = series?.ruleId ? snapshot.rules.find((r) => r.id === series.ruleId) : null;

  const [mode, setMode] = useState<EntryMode | null>(initial.mode);
  const [amount, setAmount] = useState<Cents>(initial.amount);
  const [categoryId, setCategoryId] = useState<string | null>(initial.categoryId);
  const [description, setDescription] = useState(initial.description);
  const [date, setDate] = useState<ISODate>(initial.date);
  const [accountId, setAccountId] = useState<string | null>(initial.accountId);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(initial.paymentMethod);
  const [certainty, setCertainty] = useState<Certainty>(initial.certainty);
  const [note, setNote] = useState(initial.note);
  const [recurrence, setRecurrence] = useState<Frequency | null>(rule?.frequency ?? null);
  const [showMore, setShowMore] = useState(false);
  const [touchedExtras, setTouchedExtras] = useState(editing);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const direction = mode ? modeDirection(mode) : 'out';
  const status = mode ? modeStatus(mode) : 'done';
  const categories = f.categories.filter((c) => c.kind === direction || c.kind === 'both');

  const suggestions = useMemo(
    () => (editing || !mode ? [] : buildSuggestions(snapshot.transactions, direction, { query: description.length >= 2 ? description : '', limit: 3 })),
    [editing, mode, snapshot.transactions, direction, description],
  );

  const pickCategory = (id: string) => {
    setCategoryId(id);
    setError('');
    if (touchedExtras) return;
    const s = suggestForCategory(snapshot.transactions, id);
    if (s.paymentMethod) setPaymentMethod(s.paymentMethod);
    if (s.accountId && accounts.some((a) => a.id === s.accountId)) setAccountId(s.accountId);
  };

  const pickMode = (m: EntryMode) => {
    setMode(m);
    if (modeStatus(m) === 'done' && date > today) setDate(today);
    if (categoryId && !f.categories.some((c) => c.id === categoryId && (c.kind === modeDirection(m) || c.kind === 'both'))) setCategoryId(null);
  };

  const extrasSummary = [
    accountId ? accounts.find((a) => a.id === accountId)?.name : null,
    paymentMethod ? PAYMENT_LABELS[paymentMethod] : null,
    status === 'planned' && certainty !== 'confirmed' ? CERTAINTY_LABELS[certainty] : null,
    recurrence ? FREQUENCY_LABELS[recurrence] : null,
  ].filter(Boolean).join(' · ');

  const submit = async () => {
    if (!mode) return;
    if (amount <= 0) return setError('Informe um valor.');
    const input: EntryInput = {
      mode, amount, categoryId: categoryId ?? 'other', description, date, accountId, paymentMethod, certainty, note, recurrence,
    };
    const finish = (title: string) => {
      ui.closeAllSheets();
      ui.toast(title, status === 'done' ? 'Saldo atualizado.' : 'Previsão atualizada.');
    };
    const run = async (scope: EditScope) => {
      setSaving(true);
      try {
        if (target) {
          await updateEntry(target, input, scope);
          finish('✅ Alterações salvas');
        } else {
          await saveEntry(input);
          finish('✅ Lançamento salvo');
        }
      } finally {
        setSaving(false);
      }
    };
    if (series?.isSeries) ui.openSheet((c) => <ScopeSheet close={c} action="edit" onChoose={run} />);
    else await run('this');
  };

  if (!mode) {
    return (
      <Sheet title="Novo lançamento" onClose={close}>
        <div className="mode-grid">
          {MODES.map((m) => (
            <button key={m.mode} className="mode" onClick={() => pickMode(m.mode)}>
              <span className={`mode-icon ${modeDirection(m.mode)}`}>
                <Icon name={modeDirection(m.mode) === 'out' ? 'arrowDown' : 'arrowUp'} size={20} />
              </span>
              <span>
                <strong>{m.title}</strong>
                <br />
                <small>{m.caption}</small>
              </span>
            </button>
          ))}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      title={editing ? 'Editar lançamento' : 'Novo lançamento'}
      onClose={close}
      footer={
        <button className="btn btn-primary btn-block" disabled={saving} onClick={submit}>
          {editing ? 'Salvar alterações' : 'Salvar'}
        </button>
      }
    >
      <Segmented
        label="Tipo"
        value={mode}
        onChange={pickMode}
        options={MODES.map((m) => ({ value: m.mode, label: m.title }))}
      />

      <AmountInput value={amount} onChange={(v) => { setAmount(v); setError(''); }} autoFocus={!editing} label={direction === 'out' ? 'Quanto?' : 'Quanto entrou?'} />
      {error && <p className="form-error" role="alert">{error}</p>}

      {suggestions.length > 0 && (
        <div className="field">
          <span className="field-label">Sugestões</span>
          <div className="chips chips-scroll">
            {suggestions.map((s) => {
              const cat = f.category(s.categoryId);
              return (
                <Chip
                  key={s.key}
                  className="chip-suggest"
                  onClick={() => {
                    setCategoryId(s.categoryId);
                    setDescription(s.description);
                    if (s.paymentMethod) setPaymentMethod(s.paymentMethod);
                    if (s.accountId && accounts.some((a) => a.id === s.accountId)) setAccountId(s.accountId);
                    setTouchedExtras(true);
                  }}
                >
                  {cat.emoji} {s.description || cat.name}{s.paymentMethod ? ` · ${PAYMENT_LABELS[s.paymentMethod]}` : ''}
                </Chip>
              );
            })}
          </div>
        </div>
      )}

      <div className="field">
        <span className="field-label">Categoria</span>
        <div className="cat-grid">
          {categories.map((c) => (
            <button key={c.id} type="button" className="cat" aria-pressed={categoryId === c.id} onClick={() => pickCategory(c.id)}>
              <span>{c.emoji}</span>
              <span>{c.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Data</span>
        <DateShortcuts
          value={date}
          today={today}
          onChange={setDate}
          mode={status === 'done' ? 'past' : 'future'}
          max={status === 'done' ? today : addDays(today, 400)}
        />
      </div>

      <input
        className="input"
        placeholder="Descrição (opcional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        aria-label="Descrição"
      />

      <button className="more-toggle" onClick={() => setShowMore((v) => !v)} aria-expanded={showMore}>
        <span>Mais opções {!showMore && extrasSummary && <small>· {extrasSummary}</small>}</span>
        <Icon name="down" size={18} />
      </button>

      {showMore && (
        <div className="stack">
          {accounts.length > 0 && (
            <div className="field">
              <span className="field-label">Conta</span>
              <div className="chips">
                {accounts.map((a) => (
                  <Chip key={a.id} active={accountId === a.id} onClick={() => { setAccountId(a.id); setTouchedExtras(true); }}>
                    <span className="account-dot" style={{ background: a.color }} /> {a.name}
                  </Chip>
                ))}
                <Chip active={accountId === null} onClick={() => { setAccountId(null); setTouchedExtras(true); }}>Nenhuma</Chip>
              </div>
            </div>
          )}
          <div className="field">
            <span className="field-label">Forma de pagamento</span>
            <div className="chips">
              {(Object.keys(PAYMENT_LABELS) as PaymentMethod[]).map((p) => (
                <Chip key={p} active={paymentMethod === p} onClick={() => { setPaymentMethod(paymentMethod === p ? null : p); setTouchedExtras(true); }}>
                  {PAYMENT_LABELS[p]}
                </Chip>
              ))}
            </div>
          </div>
          {status === 'planned' && (
            <div className="field">
              <span className="field-label">Certeza</span>
              <Segmented
                value={certainty}
                onChange={setCertainty}
                options={(Object.keys(CERTAINTY_LABELS) as Certainty[]).map((c) => ({ value: c, label: CERTAINTY_LABELS[c] }))}
              />
            </div>
          )}
          <div className="field">
            <span className="field-label">Repetir</span>
            {series?.ruleId ? (
              <p className="field-hint">{rule ? FREQUENCY_LABELS[rule.frequency] : 'Faz parte de uma série'} — ao salvar, você escolhe onde aplicar.</p>
            ) : (
              <div className="chips">
                <Chip active={recurrence === null} onClick={() => setRecurrence(null)}>Não repete</Chip>
                {(Object.keys(FREQUENCY_LABELS) as Frequency[]).map((fq) => (
                  <Chip key={fq} active={recurrence === fq} onClick={() => setRecurrence(fq)}>{FREQUENCY_LABELS[fq]}</Chip>
                ))}
              </div>
            )}
          </div>
          <textarea className="input" placeholder="Observação" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Observação" />
        </div>
      )}
    </Sheet>
  );
}
