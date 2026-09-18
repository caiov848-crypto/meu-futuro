import { useState } from 'react';
import { buildSyncLink, connectGithub } from '../../data/gistSync';
import { useSyncStatus } from '../../data/sync';
import { Field } from '../../ui/primitives';

const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=Meu%20Futuro%20-%20sincronizacao';

/**
 * Sincronização entre aparelhos: uma vez conectado, some da tela e fica
 * rodando sozinho para sempre — sem status, sem botões, sem escolhas.
 * Conectar um segundo aparelho é um link de um clique (nada para digitar);
 * só o primeiro aparelho precisa do token+senha, que gera esse link.
 */
export function CloudSyncCard() {
  const { backend, state, detail } = useSyncStatus();
  const [showLink, setShowLink] = useState(false);

  if (backend === 'claude') return null; // sincroniza pelo claude.ai; nada a configurar aqui.

  if (backend === 'github' && state !== 'error') {
    if (!showLink) {
      return (
        <button className="link" style={{ padding: '6px 2px' }} onClick={() => setShowLink(true)}>
          Sincronizar outro aparelho
        </button>
      );
    }
    return <LinkPanel onClose={() => setShowLink(false)} />;
  }

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <strong>Sincronizar com outros aparelhos</strong>
      {state === 'error' && detail && <p className="form-error" style={{ textAlign: 'left' }}>{detail}</p>}
      <ConnectForm onConnected={() => setShowLink(true)} />
    </div>
  );
}

function LinkPanel({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const link = buildSyncLink();
  if (!link) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      /* clipboard indisponível: a pessoa seleciona e copia manualmente */
    }
  };

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <strong>Link para sincronizar outro aparelho</strong>
      <p className="field-hint" style={{ padding: 0 }}>
        Abra este link no outro aparelho — não precisa digitar nada. Ele conecta sozinho e depois some da tela,
        como aqui.
      </p>
      <input
        id="sync-link"
        className="input"
        readOnly
        value={link}
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-primary" onClick={copy}>{copied ? 'Copiado!' : 'Copiar link'}</button>
        <button className="btn btn-ghost" onClick={onClose}>Fechar</button>
      </div>
      <p className="field-hint" style={{ padding: 0 }}>
        Trate este link como uma senha: quem o abrir passa a ver e editar os seus dados. Envie só para você
        mesmo, por um canal de confiança.
      </p>
    </div>
  );
}

function ConnectForm({ onConnected }: { onConnected: () => void }) {
  const [token, setToken] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      await connectGithub(token, passphrase);
      onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <p className="field-hint" style={{ padding: 0 }}>
        Conecte uma vez, neste aparelho. Depois disso você recebe um link para abrir nos outros — sem digitar
        nada neles — e a sincronização fica rodando sozinha, para sempre.
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
        {busy ? 'Conectando…' : 'Conectar'}
      </button>
    </div>
  );
}
