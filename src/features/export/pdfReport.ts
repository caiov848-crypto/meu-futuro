/**
 * Relatório financeiro detalhado em PDF, gerado no próprio aparelho (funciona offline).
 * Só lê o modelo já calculado pelo motor — não refaz regras financeiras.
 */
import type { ISODate } from '../../domain/types';
import { ACCOUNT_TYPE_LABELS, CERTAINTY_LABELS, PAYMENT_LABELS } from '../../domain/defaults';
import { FREQUENCY_LABELS, STATUS_LABELS, explainProjectedBalance, calculateLowestBalance, statusOf } from '../../engine';
import type { Finance } from '../../state/finance';
import { addDays, addMonths, endOfMonth, fmtDayMonth, parts, startOfMonth } from '../../lib/date';
import { formatMoney } from '../../lib/money';
import { saveFile, type SaveOutcome } from '../../lib/saveFile';

export type ReportPeriod = 'month' | 'last' | '90' | 'all';

export const PERIOD_LABELS: Record<ReportPeriod, string> = {
  month: 'Este mês',
  last: 'Mês passado',
  '90': 'Últimos 90 dias',
  all: 'Todo o histórico',
};

export interface ReportOptions {
  period: ReportPeriod;
  forecastDays: number;
  /** `false` só gera o arquivo (útil para pré-visualização/testes). */
  download?: boolean;
}

const NAVY: [number, number, number] = [14, 27, 54];
const BLUE: [number, number, number] = [37, 99, 235];
const GREEN: [number, number, number] = [12, 154, 106];
const CORAL: [number, number, number] = [220, 82, 69];
const AMBER: [number, number, number] = [185, 125, 6];
const MUTED: [number, number, number] = [123, 135, 155];

const money = (c: number, sign = false) => formatMoney(c, { sign });
const fmtDate = (d: ISODate) => {
  const [y, m, day] = parts(d);
  return `${String(day).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
};
/** Fontes padrão do PDF não têm emoji; removemos para não gerar caracteres quebrados. */
const clean = (s: string) => s.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').replace(/[—–]/g, '-').trim();

export function periodRange(period: ReportPeriod, today: ISODate): [ISODate, ISODate] {
  if (period === 'month') return [startOfMonth(today), endOfMonth(today)];
  if (period === 'last') {
    const m = addMonths(startOfMonth(today), -1, 1);
    return [m, endOfMonth(m)];
  }
  if (period === '90') return [addDays(today, -90), today];
  return ['0000-01-01', today];
}

export async function generateFinancePdf(
  f: Finance,
  opts: ReportOptions,
): Promise<{ blob: Blob; pages: number; outcome: SaveOutcome | 'skipped' }> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const { model, snapshot, today, safe, lowest, monthEnd, goals, alerts } = f;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 14;
  let y = 0;

  const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const ensure = (space: number) => {
    if (y + space > doc.internal.pageSize.getHeight() - 16) {
      doc.addPage();
      y = 18;
    }
  };
  const section = (title: string, subtitle?: string) => {
    ensure(22);
    y += 8;
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...NAVY).text(title, M, y);
    if (subtitle) {
      y += 5;
      doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...MUTED).text(subtitle, M, y);
    }
    y += 3;
  };
  const table = (head: string[], body: (string | number)[][], extra: Record<string, unknown> = {}) => {
    autoTable(doc, {
      startY: y,
      head: [head],
      body,
      margin: { left: M, right: M },
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2, textColor: NAVY, lineColor: [227, 232, 240], lineWidth: 0.1 },
      headStyles: { fillColor: [244, 246, 250], textColor: MUTED, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [251, 252, 254] },
      ...extra,
    });
    y = lastY();
  };
  const colorAmounts = (cols: number[]) => ({
    didParseCell: (data: { section: string; column: { index: number }; cell: { raw: unknown; styles: { textColor: unknown; halign: string } } }) => {
      if (data.section !== 'body' || !cols.includes(data.column.index)) return;
      data.cell.styles.halign = 'right';
      const raw = String(data.cell.raw);
      if (raw.startsWith('+')) data.cell.styles.textColor = GREEN;
      else if (raw.startsWith('-')) data.cell.styles.textColor = CORAL;
    },
  });

  /* ---------- Cabeçalho ---------- */
  doc.setFillColor(...NAVY).rect(0, 0, W, 34, 'F');
  doc.setTextColor(255, 255, 255).setFont('helvetica', 'bold').setFontSize(18).text('Meu Futuro', M, 15);
  doc.setFont('helvetica', 'normal').setFontSize(10).text('Relatório financeiro detalhado', M, 22);
  const [from, to] = periodRange(opts.period, today);
  doc.setFontSize(8.5).setTextColor(200, 208, 222)
    .text(`Gerado em ${fmtDate(today)}  ·  Histórico: ${PERIOD_LABELS[opts.period]}${opts.period === 'all' ? '' : ` (${fmtDate(from)} a ${fmtDate(to)})`}  ·  Previsão: ${opts.forecastDays} dias`, M, 29);
  y = 40;

  /* ---------- Resumo ---------- */
  section('Resumo de hoje');
  const cards: [string, string, string][] = [
    ['Saldo real', money(model.currentBalance), 'Dinheiro que existe agora'],
    ['Dinheiro livre', money(model.freeBalance), `Protegido: ${money(model.protectedTotal)}`],
    ['Pode gastar hoje', money(safe.amount), `Sem ficar abaixo de ${money(model.safetyLimit)} até ${fmtDate(safe.until)}`],
    [`Fim do mês (${fmtDayMonth(monthEnd.date)})`, money(monthEnd.balance), STATUS_LABELS[monthEnd.status]],
    ['Dia mais apertado', money(lowest.balance), `${fmtDate(lowest.date)} · ${STATUS_LABELS[lowest.status]}`],
    ['Limite de segurança', money(model.safetyLimit), 'Saldo mínimo definido por você'],
  ];
  const cw = (W - M * 2 - 8) / 3;
  cards.forEach(([label, value, note], i) => {
    const cx = M + (i % 3) * (cw + 4);
    const cy = y + 2 + Math.floor(i / 3) * 25;
    doc.setFillColor(244, 246, 250).roundedRect(cx, cy, cw, 22, 2.5, 2.5, 'F');
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED).text(label, cx + 3, cy + 5.5);
    const tone = label === 'Dia mais apertado' ? { comfortable: GREEN, attention: AMBER, risk: CORAL }[lowest.status] : NAVY;
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...tone).text(value, cx + 3, cy + 12.5);
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...MUTED).text(doc.splitTextToSize(note, cw - 6)[0], cx + 3, cy + 18);
  });
  y += 2 + 25 * 2;

  /* ---------- Atenção ---------- */
  section('Precisa da sua atenção');
  if (alerts.length === 0) {
    y += 3;
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...GREEN).text('Nada preocupante no horizonte.', M, y);
    y += 2;
  } else {
    table(['Tipo', 'Detalhe', 'Data', 'Valor'], alerts.map((a) => {
      const e = a.event;
      const name = e ? clean(e.description || f.category(e.categoryId).name) : a.goal ? clean(a.goal.goal.name) : '';
      const kind = { 'overdue-bill': 'Conta vencida', 'late-income': 'Entrada atrasada', 'below-safety': 'Saldo abaixo da segurança', 'goal-at-risk': 'Meta em risco' }[a.kind];
      const detail = a.kind === 'below-safety' ? 'Saldo previsto abaixo do limite' : a.kind === 'goal-at-risk' ? `${name} · falta juntar` : name;
      return [kind, detail, fmtDate(a.date), money(a.amount)];
    }), { columnStyles: { 3: { halign: 'right' } } });
  }

  /* ---------- Contas ---------- */
  section('Contas e carteiras');
  table(
    ['Conta', 'Tipo', 'Saldo atual'],
    [
      ...model.accountBalances.map(({ account, balance }) => [clean(account.name), ACCOUNT_TYPE_LABELS[account.type], money(balance)]),
      ...(model.unassignedBalance !== 0 ? [['Sem conta', '-', money(model.unassignedBalance)]] : []),
    ],
    {
      columnStyles: { 2: { halign: 'right' } },
      foot: [['Total', '', money(model.currentBalance)]],
      footStyles: { fillColor: [244, 246, 250], textColor: NAVY, fontStyle: 'bold', halign: 'right' },
    },
  );
  const protectedList = snapshot.protectedMoney.filter((p) => !p.deletedAt);
  const { reserveTarget, reserveCurrent } = snapshot.settings;
  if (protectedList.length || reserveTarget > 0) {
    y += 4;
    table(
      ['Dinheiro separado', 'Valor'],
      [
        ...protectedList.map((p) => [`Protegido · ${clean(p.name)}`, money(p.amount)]),
        ...(reserveTarget > 0 ? [[`Reserva (meta manual) · ${Math.round((reserveCurrent / reserveTarget) * 100)}% da meta de ${money(reserveTarget)}`, money(reserveCurrent)]] : []),
      ],
      { columnStyles: { 1: { halign: 'right' } } },
    );
  }

  /* ---------- Metas ---------- */
  section('Metas', 'Recalculadas com a previsão atual');
  if (goals.length === 0) {
    y += 3;
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...MUTED).text('Nenhuma meta salva.', M, y);
    y += 2;
  } else {
    table(
      ['Meta', 'Data', 'Gasto', 'Necessário', 'Previsto na data', 'Situação'],
      goals.map((g) => [
        clean(g.goal.name), fmtDate(g.goal.date), money(g.amount), money(g.needed), money(g.projected),
        g.state === 'past' ? 'Data passou' : g.guaranteed ? `Garantido · margem ${money(g.margin)}` : `Faltam ${money(g.shortfall)}`,
      ]),
      {
        columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
        didParseCell: (d: { section: string; column: { index: number }; cell: { raw: unknown; styles: { textColor: unknown } } }) => {
          if (d.section === 'body' && d.column.index === 5) d.cell.styles.textColor = String(d.cell.raw).startsWith('Faltam') ? AMBER : GREEN;
        },
      },
    );
  }

  /* ---------- Previsão ---------- */
  const horizon = addDays(today, opts.forecastDays - 1);
  const b = explainProjectedBalance(model, horizon);
  const low = calculateLowestBalance(model, today, horizon);
  section(`Previsão · próximos ${opts.forecastDays} dias`, `Saldo atual ${money(b.startBalance)}  +  entradas ${money(b.inflows)}  -  saídas ${money(b.outflows)}  =  ${money(b.result)} em ${fmtDate(horizon)}.  Menor saldo: ${money(low.balance)} em ${fmtDate(low.date)}.`);
  const rows: string[][] = [];
  for (const day of model.days.slice(0, opts.forecastDays)) {
    day.events.forEach((e, i) => {
      const cat = f.category(e.categoryId);
      rows.push([
        i === 0 ? fmtDate(day.date) : '',
        clean(e.description || cat.name) + (e.overdue ? ` (atrasado, era ${fmtDayMonth(e.originalDate)})` : ''),
        clean(cat.name),
        e.ruleId ? `${CERTAINTY_LABELS[e.certainty]} · recorrente` : CERTAINTY_LABELS[e.certainty],
        money(e.direction === 'in' ? e.amount : -e.amount, true),
        i === day.events.length - 1 ? money(day.closing) : '',
        i === day.events.length - 1 ? STATUS_LABELS[statusOf(model, day.closing)] : '',
      ]);
    });
  }
  if (rows.length === 0) {
    y += 3;
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...MUTED).text('Nenhum movimento previsto no período.', M, y);
    y += 2;
  } else {
    table(['Data', 'Descrição', 'Categoria', 'Certeza', 'Valor', 'Saldo depois', 'Situação'], rows, {
      columnStyles: { 5: { halign: 'right' } },
      ...colorAmounts([4]),
    });
  }

  /* ---------- Recorrentes ---------- */
  const rules = snapshot.rules.filter((r) => !r.deletedAt && (!r.endDate || r.endDate >= today));
  if (rules.length) {
    section('Lançamentos recorrentes');
    table(
      ['Descrição', 'Categoria', 'Frequência', 'Desde', 'Valor'],
      rules.map((r) => {
        const cat = f.category(r.template.categoryId);
        return [
          clean(r.template.description || cat.name), clean(cat.name),
          `${FREQUENCY_LABELS[r.frequency]}${r.frequency === 'monthly' ? ` · dia ${parts(r.startDate)[2]}` : ''}`,
          fmtDate(r.startDate), money(r.template.direction === 'in' ? r.template.amount : -r.template.amount, true),
        ];
      }),
      colorAmounts([4]),
    );
  }

  /* ---------- Histórico ---------- */
  const history = snapshot.transactions
    .filter((t) => !t.deletedAt && t.status === 'done' && t.date >= from && t.date <= to)
    .sort((a, b2) => a.date.localeCompare(b2.date) || a.createdAt.localeCompare(b2.createdAt));
  const totals = history.reduce((acc, t) => { if (t.kind === 'regular') acc[t.direction] += t.amount; return acc; }, { in: 0, out: 0 });
  section(`Lançamentos realizados · ${PERIOD_LABELS[opts.period]}`, `${history.length} lançamento(s)  ·  Entradas ${money(totals.in)}  ·  Saídas ${money(totals.out)}  ·  Resultado ${money(totals.in - totals.out, true)}`);
  if (history.length === 0) {
    y += 3;
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...MUTED).text('Nenhum lançamento realizado no período.', M, y);
    y += 2;
  } else {
    const accounts = new Map(snapshot.accounts.map((a) => [a.id, a.name]));
    table(
      ['Data', 'Descrição', 'Categoria', 'Conta', 'Pagamento', 'Valor'],
      history.map((t) => {
        const cat = f.category(t.categoryId);
        return [
          fmtDate(t.date),
          clean(t.description || cat.name) + (t.note ? `\n${clean(t.note)}` : ''),
          t.kind === 'adjustment' ? 'Ajuste de saldo' : clean(cat.name),
          t.accountId ? clean(accounts.get(t.accountId) ?? '-') : '-',
          t.paymentMethod ? PAYMENT_LABELS[t.paymentMethod] : '-',
          money(t.direction === 'in' ? t.amount : -t.amount, true),
        ];
      }),
      colorAmounts([5]),
    );

    const byCat = new Map<string, number>();
    for (const t of history) if (t.kind === 'regular' && t.direction === 'out') byCat.set(t.categoryId, (byCat.get(t.categoryId) ?? 0) + t.amount);
    if (byCat.size) {
      section('Gastos por categoria', PERIOD_LABELS[opts.period]);
      table(
        ['Categoria', 'Total', '% dos gastos'],
        [...byCat.entries()].sort((a, c) => c[1] - a[1]).map(([id, v]) => [
          clean(f.category(id).name), money(v), `${((v / totals.out) * 100).toFixed(1).replace('.', ',')}%`,
        ]),
        { columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } } },
      );
    }
  }

  /* ---------- Rodapé ---------- */
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    const h = doc.internal.pageSize.getHeight();
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...MUTED);
    doc.text('Meu Futuro · valores previstos são estimativas baseadas nos seus lançamentos.', M, h - 8);
    doc.text(`Página ${i} de ${pages}`, W - M, h - 8, { align: 'right' });
  }
  doc.setDrawColor(...BLUE);

  const blob = doc.output('blob');
  const outcome: SaveOutcome | 'skipped' =
    opts.download === false ? 'skipped' : await saveFile(`meu-futuro-relatorio-${today}.pdf`, blob);
  return { blob, pages, outcome };
}
