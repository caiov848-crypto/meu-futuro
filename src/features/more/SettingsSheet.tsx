import { useRef, useState } from 'react';
import type { Category } from '../../domain/types';
import {
  exportBackup, importBackup, loadDemo, resetAll, saveCategory, updateSettings,
} from '../../data/repository';
import { useFinance } from '../../state/finance';
import { useUI } from '../../state/ui';
import { AmountInput, Chip, ConfirmSheet, Field, Sheet, Toggle } from '../../ui/primitives';
import { AccountsSheet } from '../plan/sheets';
import { ExportPdfSheet } from '../export/ExportPdfSheet';
import { syncNow, useSyncStatus, type SyncState } from '../../data/sync';
import { saveFile } from '../../lib/saveFile';

export function SettingsSheet({ close }: { close: () => void }) {
  const f = useFinance();
  const ui = useUI();
  const s = f.snapshot.settings;
  const [safety, setSafety] = useState(s.safetyLimit);
  const fileRef = useRef<HTMLInputElement>(null);
  const includeExpected = s.certaintyWeights.expected.in > 0;

  const download = async () => {
    try {
      const blob = new Blob([await exportBackup()], { type: 'application/json' });
      if ((await saveFile(`meu-futuro-${f.today}.json`, blob)) === 'saved') ui.toast('Backup exportado', undefined, 'neutral');
    } catch (err) {
      ui.toast('Não foi possível exportar', err instanceof Error ? err.message : undefined, 'neutral');
    }
  };

  const confirm = (title: string, message: string, label: string, run: () => Promise<void>, done: string) =>
    ui.openSheet((c) => (
      <ConfirmSheet close={c} title={title} message={message} confirmLabel={label} danger
        onConfirm={async () => { await run(); ui.closeAllSheets(); ui.toast(done, undefined, 'neutral'); }} />
    ));

  return (
    <Sheet title="Ajustes" onClose={close}>
      <SyncCard />
      <div className="card stack">
        <Field label="Limite de segurança" hint="Saldo mínimo que você não quer ultrapassar. Usado na previsão e nos simuladores.">
          <AmountInput size="md" value={safety} onChange={setSafety} label="Limite de segurança" />
        </Field>
        {safety !== s.safetyLimit && (
          <button className="btn btn-primary" onClick={async () => { await updateSettings({ safetyLimit: safety }); ui.toast('✅ Segurança atualizada', 'Previsão recalculada.'); }}>
            Salvar segurança
          </button>
        )}
      </div>

      <div className="card card-list">
        <div className="settings-row">
          <div>
            <strong>Contar entradas “Previstas”</strong>
            <small>Desligue para uma previsão mais conservadora: só entradas confirmadas ou prováveis.</small>
          </div>
          <Toggle
            label="Contar entradas previstas"
            checked={includeExpected}
            onChange={(v) => updateSettings({ certaintyWeights: { ...s.certaintyWeights, expected: { ...s.certaintyWeights.expected, in: v ? 1 : 0 } } })}
          />
        </div>
        <div className="divider" />
        <button className="settings-row" onClick={() => ui.openSheet((c) => <AccountsSheet close={c} />)}>
          <div><strong>Contas e carteiras</strong><small>{f.model.accountBalances.length} conta(s)</small></div>
        </button>
      </div>

      <CategoriesCard categories={f.categories} />

      <div className="card card-list">
        <button className="settings-row" onClick={() => ui.openSheet((c) => <ExportPdfSheet close={c} />)}><div><strong>Exportar relatório em PDF</strong><small>Resumo, previsão, metas e lançamentos detalhados</small></div></button>
        <div className="divider" />
        <button className="settings-row" onClick={download}><div><strong>Exportar backup</strong><small>Arquivo JSON com todos os seus dados</small></div></button>
        <div className="divider" />
        <button className="settings-row" onClick={() => fileRef.current?.click()}><div><strong>Importar backup</strong><small>Substitui os dados deste aparelho</small></div></button>
        <input ref={fileRef} type="file" accept="application/json" hidden onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            await importBackup(await file.text());
            ui.closeAllSheets();
            ui.toast('✅ Backup importado');
          } catch (err) {
            ui.toast('Não foi possível importar', err instanceof Error ? err.message : undefined, 'neutral');
          }
          e.target.value = '';
        }} />
        <div className="divider" />
        <button className="settings-row" onClick={() => confirm('Carregar exemplo?', 'Seus dados atuais serão substituídos por dados de exemplo.', 'Carregar', loadDemo, 'Dados de exemplo carregados')}>
          <div><strong>Carregar dados de exemplo</strong><small>Para conhecer o app</small></div>
        </button>
        <div className="divider" />
        <button className="settings-row" onClick={() => confirm('Apagar tudo?', 'Todos os dados deste aparelho serão apagados. Exporte um backup antes se quiser guardar.', 'Apagar tudo', resetAll, 'Dados apagados')}>
          <div><strong style={{ color: 'var(--coral)' }}>Apagar todos os dados</strong></div>
        </button>
      </div>

      <p className="field-hint" style={{ textAlign: 'center' }}>Meu Futuro funciona offline. Seus dados ficam guardados neste aparelho.</p>
    </Sheet>
  );
}

const SYNC_TEXT: Record<SyncState, { title: string; detail: string; pill: string; label: string }> = {
  local: { title: 'Somente neste aparelho', detail: 'Abra o Meu Futuro pelo link do claude.ai para usar os mesmos dados no PC e no celular.', pill: 'pill', label: 'Local' },
  connecting: { title: 'Conectando…', detail: 'Buscando seus dados na nuvem.', pill: 'pill-info', label: 'Conectando' },
  synced: { title: 'Sincronizado', detail: 'PC e celular usam os mesmos dados. Mudanças aparecem nos dois em segundos.', pill: 'pill-ok', label: 'Em dia' },
  saving: { title: 'Salvando na nuvem…', detail: 'Enviando as últimas alterações.', pill: 'pill-info', label: 'Salvando' },
  error: { title: 'Não foi possível sincronizar', detail: 'Suas alterações continuam salvas neste aparelho e serão enviadas assim que der.', pill: 'pill-risk', label: 'Erro' },
};

function SyncCard() {
  const { state, detail, lastSyncedAt } = useSyncStatus();
  const t = SYNC_TEXT[state];
  const last = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;
  return (
    <div className="card stack" style={{ gap: 6 }}>
      <div className="row between">
        <strong>{t.title}</strong>
        <span className={`pill ${t.pill}`}>{t.label}</span>
      </div>
      <p className="field-hint" style={{ padding: 0 }}>{t.detail}</p>
      {state === 'error' && detail && <p className="field-hint" style={{ padding: 0 }}>{detail}</p>}
      {state !== 'local' && (
        <div className="row between">
          <span className="field-hint" style={{ padding: 0 }}>{last ? `Última sincronização às ${last}` : 'Ainda não sincronizou nesta sessão'}</span>
          <button className="btn btn-secondary btn-sm" onClick={syncNow} disabled={state === 'connecting' || state === 'saving'}>
            Sincronizar agora
          </button>
        </div>
      )}
    </div>
  );
}

function CategoriesCard({ categories }: { categories: Category[] }) {
  const ui = useUI();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🏷️');
  const [kind, setKind] = useState<Category['kind']>('out');

  return (
    <div className="card stack">
      <div className="row between">
        <strong>Categorias</strong>
        {!adding && <button className="link" onClick={() => setAdding(true)}>Nova categoria</button>}
      </div>
      <div className="chips">
        {categories.map((c) => <span key={c.id} className="chip">{c.emoji} {c.name}</span>)}
      </div>
      {adding && (
        <div className="stack">
          <div className="row">
            <input className="input" style={{ width: 64, textAlign: 'center' }} value={emoji} onChange={(e) => setEmoji(e.target.value)} aria-label="Emoji" maxLength={4} />
            <input className="input" placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="chips">
            <Chip active={kind === 'out'} onClick={() => setKind('out')}>Saída</Chip>
            <Chip active={kind === 'in'} onClick={() => setKind('in')}>Entrada</Chip>
            <Chip active={kind === 'both'} onClick={() => setKind('both')}>Ambos</Chip>
          </div>
          <button className="btn btn-primary" disabled={!name.trim()} onClick={async () => {
            await saveCategory({ name, emoji: emoji || '🏷️', kind });
            setAdding(false);
            setName('');
            ui.toast('✅ Categoria criada');
          }}>Criar categoria</button>
        </div>
      )}
    </div>
  );
}
