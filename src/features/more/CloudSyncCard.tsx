import { useState } from 'react';
import { connectGithub } from '../../data/gistSync';
import { useSyncStatus } from '../../data/sync';
import { Field } from '../../ui/primitives';

const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=Meu%20Futuro%20-%20sincronizacao';

/**
 * Sincronização entre aparelhos: uma vez conectado, some da tela e fica
 * rodando sozinho para sempre — sem status, sem botões, sem escolhas.
 * Só aparece algo aqui se ainda não foi configurado, ou se algo falhar.
 */
export function CloudSyncCard() {
  const { backend, state, detail } = useSyncStatus();

  if (backend === 'claude') return null; // sincroniza pelo claude.ai; nada a configurar aqui.
  if (backend === 'github' && state !== 'error') return null; // conectado e funcionando: invisível.

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <strong>Sincronizar com outros aparelhos</strong>
      {state === 'error' && detail && <p className="form-error" style={{ textAlign: 'left' }}>{detail}</p>}
      <GithubConnect />
    </div>
  );
}

function GithubConnect() {
  const [token, setToken] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      await connectGithub(token, passphrase);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <p className="field-hint" style={{ padding: 0 }}>
        Conecte uma vez em cada aparelho, com o mesmo token e a mesma senha. Depois disso fica sincronizando
        sozinho, sem precisar tocar em mais nada. Tudo é criptografado com a sua senha antes de sair do aparelho.
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
