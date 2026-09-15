import { useState } from 'react';
import { useFinance } from '../../state/finance';
import { useUI } from '../../state/ui';
import { Chip, Field, Segmented, Sheet } from '../../ui/primitives';
import { PERIOD_LABELS, type ReportPeriod } from './pdfReport';

export function ExportPdfSheet({ close }: { close: () => void }) {
  const f = useFinance();
  const ui = useUI();
  const [period, setPeriod] = useState<ReportPeriod>('month');
  const [forecastDays, setForecastDays] = useState(60);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    setBusy(true);
    try {
      const { generateFinancePdf } = await import('./pdfReport');
      const { outcome } = await generateFinancePdf(f, { period, forecastDays });
      if (outcome === 'declined') return;
      close();
      ui.toast('📄 PDF gerado', 'Relatório salvo no aparelho.');
    } catch (err) {
      ui.toast('Não foi possível gerar o PDF', err instanceof Error ? err.message : undefined, 'neutral');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Exportar relatório em PDF"
      subtitle="Gerado no aparelho — funciona sem internet."
      onClose={close}
      footer={<button className="btn btn-primary btn-block" disabled={busy} onClick={generate}>{busy ? 'Gerando…' : 'Gerar PDF'}</button>}
    >
      <Field label="Lançamentos realizados de">
        <div className="chips">
          {(Object.keys(PERIOD_LABELS) as ReportPeriod[]).map((p) => (
            <Chip key={p} active={period === p} onClick={() => setPeriod(p)}>{PERIOD_LABELS[p]}</Chip>
          ))}
        </div>
      </Field>
      <Field label="Previsão para os próximos">
        <Segmented
          value={forecastDays}
          onChange={setForecastDays}
          options={[{ value: 30, label: '30 dias' }, { value: 60, label: '60 dias' }, { value: 90, label: '90 dias' }]}
        />
      </Field>
      <div className="card">
        <strong>O relatório inclui</strong>
        <ul className="muted" style={{ margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.7, fontSize: '0.875rem' }}>
          <li>Resumo: saldo real, livre, quanto pode gastar, fim do mês e pior dia</li>
          <li>Alertas, contas, dinheiro protegido e reserva</li>
          <li>Metas com situação atualizada</li>
          <li>Previsão dia a dia com saldo depois de cada movimento</li>
          <li>Recorrentes, lançamentos do período e gastos por categoria</li>
        </ul>
      </div>
    </Sheet>
  );
}
