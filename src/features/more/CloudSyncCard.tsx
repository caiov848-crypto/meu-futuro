import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { buildSyncLink, connectAutoSync, disconnectAutoSync, isAutoSyncConfigured, loadConfig, syncAutoNow } from '../../data/autoSync';
import { useSyncStatus } from '../../data/sync';
import { Icon } from '../../ui/Icon';

/**
 * Card de Sincronização em Tempo Real (PC <-> Celular) via Firebase com QR Code.
 */
export function CloudSyncCard() {
  const { backend, state, detail, lastSyncedAt } = useSyncStatus();
  const [showQr, setShowQr] = useState(false);
  const isConfigured = isAutoSyncConfigured();

  if (backend === 'claude') return null;

  if (isConfigured && state !== 'error') {
    return (
      <div className="card stack" style={{ gap: 12 }}>
        <div className="row between">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '1.1rem' }}>🟢</span>
            <div>
              <strong style={{ fontSize: 'var(--fs-md)', display: 'block' }}>Sincronização Ativa</strong>
              <small className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
                {state === 'saving'
                  ? 'Salvando alterações na nuvem…'
                  : state === 'connecting'
                    ? 'Conectando…'
                    : lastSyncedAt
                      ? `Sincronizado ${new Date(lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                      : 'Pronto e espelhado'}
              </small>
            </div>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowQr(!showQr)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name="qr" size={16} /> {showQr ? 'Ocultar QR' : 'Conectar celular'}
          </button>
        </div>

        {showQr && <QrPanel onClose={() => setShowQr(false)} />}

        <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button className="link" style={{ fontSize: 'var(--fs-xs)' }} onClick={() => syncAutoNow()}>
            Sincronizar agora
          </button>
          <span className="muted">·</span>
          <button
            className="link"
            style={{ fontSize: 'var(--fs-xs)', color: 'var(--coral)' }}
            onClick={() => {
              if (window.confirm('Deseja desconectar a sincronização deste aparelho? Seus dados locais serão mantidos.')) {
                disconnectAutoSync();
              }
            }}
          >
            Desconectar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card stack" style={{ gap: 12 }}>
      <div>
        <strong style={{ fontSize: 'var(--fs-md)', display: 'block' }}>Sincronizar PC com Celular</strong>
        <p className="field-hint" style={{ padding: '2px 0 0' }}>
          Seus dados são cifrados no aparelho (AES-256) e sincronizados em tempo real entre todos os seus dispositivos.
        </p>
      </div>

      {state === 'error' && detail && (
        <p className="form-error" style={{ textAlign: 'left', margin: 0 }}>
          {detail}
        </p>
      )}

      <ConnectForm onConnected={() => setShowQr(true)} />
    </div>
  );
}

function QrPanel({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const link = buildSyncLink();
  const cfg = loadConfig();

  useEffect(() => {
    if (!link) return;
    QRCode.toDataURL(link, {
      width: 240,
      margin: 1,
      color: { dark: '#0E1B36', light: '#FFFFFF' },
    })
      .then(setQrDataUrl)
      .catch(console.error);
  }, [link]);

  if (!link) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard indisponível */
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        padding: '16px 12px',
        background: 'var(--surface-2)',
        borderRadius: 'var(--r-md)',
        gap: 12,
      }}
    >
      <strong style={{ fontSize: 'var(--fs-md)' }}>Aponte a câmera do celular</strong>
      <p className="field-hint" style={{ padding: 0, maxWidth: 360 }}>
        Abra a câmera do seu celular e aponte para o código abaixo. O app abrirá no celular já conectado e com todos os seus dados!
      </p>

      {qrDataUrl ? (
        <div style={{ background: '#fff', padding: 10, borderRadius: 16, boxShadow: 'var(--shadow)' }}>
          <img src={qrDataUrl} alt="QR Code de Sincronização" style={{ display: 'block', width: 220, height: 220 }} />
        </div>
      ) : (
        <div style={{ width: 220, height: 220, display: 'grid', placeItems: 'center', color: 'var(--ink-3)' }}>
          Gerando QR Code…
        </div>
      )}

      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
        <button className="btn btn-primary" onClick={copy} style={{ width: '100%' }}>
          {copied ? '✅ Link copiado!' : 'Copiar link mágico para enviar'}
        </button>
        <button className="link" onClick={onClose} style={{ alignSelf: 'center', fontSize: 'var(--fs-sm)' }}>
          Fechar
        </button>
      </div>

      {cfg && (
        <small className="muted" style={{ fontSize: '0.6875rem' }}>
          Banco: {cfg.databaseUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}
        </small>
      )}
    </div>
  );
}

function ConnectForm({ onConnected }: { onConnected: () => void }) {
  const [databaseUrl, setDatabaseUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showGuide, setShowGuide] = useState(false);

  const connect = async () => {
    if (!databaseUrl.trim()) {
      setError('Por favor, informe a URL do seu Firebase Realtime Database.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await connectAutoSync(databaseUrl.trim());
      onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <label className="field">
        <span className="field-label">URL do Firebase Realtime Database</span>
        <input
          type="url"
          className="input"
          placeholder="https://seu-projeto-default-rtdb.firebaseio.com"
          value={databaseUrl}
          onChange={(e) => {
            setDatabaseUrl(e.target.value);
            if (error) setError('');
          }}
        />
        <span className="field-hint">
          Copie a URL que aparece no topo da aba <b>Realtime Database</b> no console do Firebase.
        </span>
      </label>

      {error && <p className="form-error" style={{ textAlign: 'left', margin: 0 }}>{error}</p>}

      <button className="btn btn-primary" disabled={busy || !databaseUrl.trim()} onClick={connect}>
        {busy ? 'Conectando e criptografando…' : 'Ativar Sincronização'}
      </button>

      <div style={{ borderTop: '1px dashed var(--line)', paddingTop: 8, marginTop: 2 }}>
        <button
          className="link"
          style={{ fontSize: 'var(--fs-xs)', padding: '2px 0' }}
          onClick={() => setShowGuide(!showGuide)}
        >
          {showGuide ? 'Ocultar passo a passo' : '❓ Não tem um Firebase? Veja como criar em 1 minuto (100% grátis)'}
        </button>

        {showGuide && (
          <div
            style={{
              fontSize: 'var(--fs-xs)',
              color: 'var(--ink-2)',
              background: 'var(--surface-2)',
              padding: '10px 12px',
              borderRadius: 'var(--r-sm)',
              marginTop: 6,
              lineHeight: 1.5,
            }}
          >
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              <li>Acesse <b>console.firebase.google.com</b> com sua conta Google e clique em <b>Criar projeto</b>.</li>
              <li>No menu lateral, vá em <b>Build &gt; Realtime Database</b> e clique em <b>Criar banco de dados</b>.</li>
              <li>Na aba <b>Regras</b>, altere <code>.read</code> e <code>.write</code> para <code>true</code> (seus dados continuam 100% protegidos por criptografia militar AES-256 no aparelho).</li>
              <li>Copie a URL que termina com <code>firebaseio.com</code> e cole no campo acima!</li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
