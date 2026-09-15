import { useRef, useState } from 'react';
import type { Cents } from '../../domain/types';
import { completeOnboarding, importBackup, loadDemo } from '../../data/repository';
import { AmountInput, Field } from '../../ui/primitives';

export function Welcome() {
  const [balance, setBalance] = useState<Cents>(0);
  const [accountName, setAccountName] = useState('');
  const [safety, setSafety] = useState<Cents>(30000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível concluir.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="welcome">
      <div className="welcome-brand"><img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" /> Meu Futuro</div>
      <div className="stack" style={{ gap: 8 }}>
        <h1>Veja quanto dinheiro você vai ter — antes de gastar.</h1>
        <p className="welcome-lead">Registre o que entra e sai. O app calcula o resto.</p>
      </div>
      <div className="promise">
        <div><b>1</b> Quanto posso gastar hoje?</div>
        <div><b>2</b> Quanto vou ter em qualquer data?</div>
        <div><b>3</b> Quanto preciso juntar para um gasto?</div>
      </div>

      <AmountInput value={balance} onChange={setBalance} label="Quanto você tem hoje?" />
      <Field label="Onde está esse dinheiro?">
        <input id="welcome-account" className="input" placeholder="Ex.: Nubank, Inter, carteira…" value={accountName} onChange={(e) => setAccountName(e.target.value)} />
      </Field>
      <Field label="Saldo mínimo de segurança" hint="Quanto você nunca quer ficar abaixo. Dá para mudar depois.">
        <AmountInput size="md" value={safety} onChange={setSafety} label="Segurança" />
      </Field>

      {error && <p className="form-error" role="alert">{error}</p>}

      <button className="btn btn-primary btn-block" disabled={busy} onClick={() => run(() => completeOnboarding({ accountName, balance, safetyLimit: safety }))}>
        Começar
      </button>
      <button className="btn btn-secondary btn-block" disabled={busy} onClick={() => fileRef.current?.click()}>
        Já uso o Meu Futuro: importar backup
      </button>
      <input
        ref={fileRef}
        id="welcome-import"
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void run(async () => importBackup(await file.text()));
        }}
      />
      <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => run(loadDemo)}>
        Explorar com dados de exemplo
      </button>
    </main>
  );
}
