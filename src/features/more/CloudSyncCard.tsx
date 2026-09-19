import { useState } from 'react';
import { buildSyncLink, connectAutoSync } from '../../data/autoSync';
import { useSyncStatus } from '../../data/sync';

/**
 * Sincronização Mágica (Zero Setup).
 * O usuário apenas clica em "Ativar Sincronização", o app provisiona a nuvem e exibe o link mágico.
 */
export function CloudSyncCard() {
  const { backend, state, detail } = useSyncStatus();
  const [showLink, setShowLink] = useState(false);

  if (backend === 'claude') return null;

  if (backend === 'github' && state !== 'error') { // mantivemos github como string no state para retrocompatibilidade visual
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
      <strong>Sincronização em Tempo Real</strong>
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
      /* clipboard indisponível */
    }
  };

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <strong>Link Mágico de Sincronização</strong>
      <p className="field-hint" style={{ padding: 0 }}>
        Nenhuma conta necessária. Seus dados estão sendo guardados num balde anônimo na internet e 
        protegidos por uma chave forte local.
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
        Para espelhar esse aparelho em outro, basta <b>abrir esse link no outro aparelho</b>. 
        Não envie para ninguém além de você mesmo.
      </p>
    </div>
  );
}

function ConnectForm({ onConnected }: { onConnected: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      await connectAutoSync(); // Sem parâmetros = gera nova nuvem automaticamente
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
        Ative a sincronização mágica para conectar com o seu celular. Sem cadastro, sem configuração e 100% automático.
      </p>
      {error && <p className="form-error" style={{ textAlign: 'left' }}>{error}</p>}
      <button className="btn btn-primary" disabled={busy} onClick={connect}>
        {busy ? 'Ativando nuvem invisível…' : 'Ativar Sincronização'}
      </button>
    </div>
  );
}
