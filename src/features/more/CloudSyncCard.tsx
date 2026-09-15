import { useState } from 'react';
import {
  cancelGithubConnect, connectGithub, disconnectGithub, finishGithubConnect, type FinishMode,
} from '../../data/gistSync';
import { syncNow, useSyncStatus, type SyncState } from '../../data/sync';
import { useUI } from '../../state/ui';
import { ConfirmSheet, Field } from '../../ui/primitives';

const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=Meu%20Futuro%20-%20sincronizacao';

const STATE_TEXT: Record<SyncState, { title: string; pill: string; label: string }> = {
  local: { title: 'Somente neste aparelho', pill: 'pill', label: 'Local' },
  connecting: { title: 'Conectando…', pill: 'pill-info', label: 'Conectando' },
  synced: { title: 'Sincronizado', pill: 'pill-ok', label: 'Em dia' },
  saving: { title: 'Enviando alterações…', pill: 'pill-info', label: 'Salvando' },
  error: { title: 'Não foi possível sincronizar', pill: 'pill-risk', label: 'Erro' },
};

/** Sincronização entre aparelhos: status, e conexão com o GitHub fora do claude.ai. */
export function CloudSyncCard() {
  const { state, backend, detail, lastSyncedAt } = useSyncStatus();
  const t = STATE_TEXT[state];
  const last = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div className="row between">
        <strong>{t.title}</strong>
        <span className={`pill ${t.pill}`}>{t.label}</span>
      </div>

      {backend === 'none' ? (
        <GithubConnect />
      ) : (
        <>
          <p className="field-hint" style={{ padding: 0 }}>
            {backend === 'github'
              ? 'Sincronizando pelo seu GitHub, com os dados criptografados pela sua senha. Lançamentos aparecem nos outros aparelhos em poucos segundos.'
              : 'Sincronizando pelo claude.ai. PC e celular usam os mesmos dados.'}
          </p>
          {state === 'error' && detail && <p className="form-error" style={{ textAlign: 'left' }}>{detail}</p>}
          <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <span className="field-hint" style={{ padding: 0 }}>
              {last ? `Última sincronização às ${last}` : 'Ainda não sincronizou nesta sessão'}
            </span>
            <div className="row" style={{ gap: 8 }}>
              {backend === 'github' && <DisconnectButton />}
              <button className="btn btn-secondary btn-sm" onClick={syncNow} disabled={state === 'connecting' || state === 'saving'}>
                Sincronizar agora
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function DisconnectButton() {
  const ui = useUI();
  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={() => ui.openSheet((c) => (
        <ConfirmSheet
          close={c}
          title="Desligar a sincronização?"
          message="Este aparelho para de enviar e receber alterações. Os dados continuam aqui e na nuvem; dá para conectar de novo depois."
          confirmLabel="Desligar"
          danger
          onConfirm={() => {
            disconnectGithub();
            ui.toast('Sincronização desligada neste aparelho', undefined, 'neutral');
          }}
        />
      ))}
    >
      Desligar
    </button>
  );
}

function GithubConnect() {
  const ui = useUI();
  const [token, setToken] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [found, setFound] = useState<{ hasLocalData: boolean } | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const connect = () => run(async () => {
    const result = await connectGithub(token, passphrase);
    if (result.kind === 'created') {
      ui.toast('✅ Sincronização ativada', 'Agora conecte o outro aparelho com o mesmo token e a mesma senha.');
    } else if (!result.hasLocalData) {
      await finishGithubConnect('useCloud');
      ui.toast('✅ Dados sincronizados', 'Este aparelho recebeu os dados da nuvem.');
    } else {
      setFound({ hasLocalData: true });
    }
  });

  const finish = (mode: FinishMode, message: string) => run(async () => {
    await finishGithubConnect(mode);
    setFound(null);
    ui.toast('✅ Sincronização ativada', message);
  });

  if (found) {
    return (
      <div className="stack" style={{ gap: 8 }}>
        <p className="field-hint" style={{ padding: 0 }}>
          Já existe uma sincronização nessa conta, e este aparelho também tem dados. O que fazer com eles?
        </p>
        {error && <p className="form-error" style={{ textAlign: 'left' }}>{error}</p>}
        <button className="btn btn-primary" disabled={busy} onClick={() => finish('useCloud', 'Este aparelho agora mostra os dados da nuvem.')}>
          Usar os dados da nuvem neste aparelho
        </button>
        <button className="btn btn-secondary" disabled={busy} onClick={() => finish('merge', 'Os dados dos dois lugares foram combinados.')}>
          Juntar os dados dos dois
        </button>
        <button
          className="btn btn-danger"
          disabled={busy}
          onClick={() => ui.openSheet((c) => (
            <ConfirmSheet
              close={c}
              title="Substituir a nuvem?"
              message="Os dados deste aparelho passam a valer em todos os aparelhos conectados. O que estiver só na nuvem será apagado."
              confirmLabel="Substituir"
              danger
              onConfirm={() => finish('useThisDevice', 'Os dados deste aparelho foram enviados para a nuvem.')}
            />
          ))}
        >
          Enviar os deste aparelho (substitui a nuvem)
        </button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => { cancelGithubConnect(); setFound(null); }}>
          Cancelar
        </button>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <p className="field-hint" style={{ padding: 0 }}>
        Use o mesmo token e a mesma senha no PC e no celular para ver os mesmos dados. Tudo é criptografado com a sua senha antes de sair do aparelho.
      </p>
      <ol className="field-hint" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
        <li>
          <a href={TOKEN_URL} target="_blank" rel="noreferrer">Crie um token no GitHub</a> marcando só a permissão <b>gist</b> e com validade sem expiração (ou longa).
        </li>
        <li>Cole o token abaixo e escolha uma senha de sincronização.</li>
      </ol>
      <Field label="Token do GitHub">
        <input
          id="github-token"
          className="input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="ghp_…"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </Field>
      <Field label="Senha de sincronização" hint="Mínimo de 8 caracteres. Sem ela não dá para ler os dados na nuvem, e ela não pode ser recuperada.">
        <input
          id="sync-passphrase"
          className="input"
          type="password"
          autoComplete="new-password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
        />
      </Field>
      {error && <p className="form-error" style={{ textAlign: 'left' }}>{error}</p>}
      <button className="btn btn-primary" disabled={busy || !token.trim() || passphrase.length < 8} onClick={connect}>
        {busy ? 'Conectando…' : 'Conectar e sincronizar'}
      </button>
    </div>
  );
}
