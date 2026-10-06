import { memo, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Cents, ISODate } from '../../domain/types';
import type { ForecastDay } from '../../engine';
import { fmtDayMonth } from '../../lib/date';
import { formatCompact } from '../../lib/money';

const H = 210;
const PAD = { l: 8, r: 8, t: 24, b: 28 };

/** Gráfico de linha em degraus: saldo projetado, segurança, menor saldo e data selecionada com scrubber e tooltip. */
export const ForecastChart = memo(function ForecastChart(props: {
  days: ForecastDay[];
  floor: Cents;
  selected: ISODate;
  lowestDate: ISODate;
  onSelect: (date: ISODate) => void;
}) {
  const { days, floor, selected, lowestDate, onSelect } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(340);
  const dragging = useRef(false);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) {
        setW(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = days.length;
  if (n === 0) return null;

  const values = days.map((d) => d.closing);
  const min = Math.min(...values, floor);
  const max = Math.max(...values, floor);
  const span = max - min || 10000;
  const yMin = min - span * 0.12;
  const yMax = max + span * 0.15;
  const innerW = Math.max(1, w - PAD.l - PAD.r);
  const x = (i: number) => PAD.l + (n <= 1 ? 0 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b);
  const baseY = H - PAD.b;

  let line = `M${x(0)},${y(values[0])}`;
  for (let i = 1; i < n; i++) line += `H${x(i)}V${y(values[i])}`;
  const area = `${line}H${x(n - 1)}V${baseY}H${x(0)}Z`;

  const selIdx = Math.max(0, days.findIndex((d) => d.date === selected));
  const lowIdx = days.findIndex((d) => d.date === lowestDate);
  const floorY = y(floor);

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - rect.left - PAD.l) / innerW) * (n - 1));
    const d = days[Math.min(n - 1, Math.max(0, i))];
    if (d && d.date !== selected) onSelect(d.date);
  };

  const onKey = (e: KeyboardEvent) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const nextIdx = Math.min(n - 1, Math.max(0, selIdx + delta));
    onSelect(days[nextIdx].date);
  };

  const ticks = [0, Math.floor((n - 1) / 2), n - 1];

  // Tooltip no ponto ativo
  const selX = x(selIdx);
  const selY = y(values[selIdx]);
  const tooltipText = `${fmtDayMonth(days[selIdx].date)} · ${formatCompact(days[selIdx].closing)}`;
  const tooltipW = 104;
  const tooltipH = 22;
  const tooltipX = Math.min(Math.max(selX - tooltipW / 2, PAD.l), w - PAD.r - tooltipW);
  // Se estiver muito perto do topo, renderiza o tooltip abaixo do ponto; senão, acima
  const tooltipY = selY > PAD.t + 26 ? selY - 28 : selY + 12;

  // Rótulo da linha de segurança protegido contra clipping superior
  const safeLabelY = Math.max(PAD.t - 4, Math.min(floorY - 6, baseY - 6));

  return (
    <div className="chart-wrap" ref={wrap}>
      <svg
        width={w}
        height={H}
        role="slider"
        tabIndex={0}
        aria-label="Saldo previsto por dia"
        aria-valuenow={values[selIdx]}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={`${fmtDayMonth(days[selIdx].date)}: ${formatCompact(days[selIdx].closing)} reais`}
        onPointerDown={(e) => {
          dragging.current = true;
          (e.currentTarget as SVGSVGElement).setPointerCapture?.(e.pointerId);
          pick(e);
        }}
        onPointerMove={(e) => {
          if (dragging.current || (e.pointerType === 'mouse' && e.buttons === 1)) pick(e);
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          (e.currentTarget as SVGSVGElement).releasePointerCapture?.(e.pointerId);
        }}
        onPointerLeave={() => {
          dragging.current = false;
        }}
        onKeyDown={onKey}
        style={{ cursor: 'ew-resize' }}
      >
        <defs>
          <linearGradient id="mf-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--blue, #2563eb)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--blue, #2563eb)" stopOpacity="0.01" />
          </linearGradient>
          <filter id="mf-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#0e1b36" floodOpacity="0.12" />
          </filter>
        </defs>

        {floorY < baseY && (
          <rect x={PAD.l} y={floorY} width={innerW} height={Math.max(0, baseY - floorY)} fill="var(--coral, #dc5245)" opacity="0.05" />
        )}
        <path d={area} fill="url(#mf-area)" />

        {/* Linha de segurança */}
        <line
          x1={PAD.l}
          x2={PAD.l + innerW}
          y1={floorY}
          y2={floorY}
          stroke="var(--coral, #dc5245)"
          strokeWidth="1.5"
          strokeDasharray="4 4"
          opacity="0.8"
        />
        <text
          x={PAD.l + innerW}
          y={safeLabelY}
          textAnchor="end"
          fontSize="10"
          fill="var(--coral, #dc5245)"
          fontWeight="600"
          letterSpacing="0.02em"
        >
          segurança {formatCompact(floor)}
        </text>

        {/* Linha principal de projeção */}
        <path d={line} fill="none" stroke="var(--blue, #2563eb)" strokeWidth="2.5" strokeLinejoin="round" />

        {/* Marcadores de dias com movimento */}
        {days.map(
          (d, i) =>
            d.events.length > 0 &&
            i !== selIdx &&
            i !== lowIdx && (
              <circle
                key={d.date}
                cx={x(i)}
                cy={y(d.closing)}
                r="2.5"
                fill="#ffffff"
                stroke="var(--blue, #2563eb)"
                strokeWidth="1.5"
              />
            ),
        )}

        {/* Menor saldo (quando diferente do selecionado) */}
        {lowIdx >= 0 && lowIdx !== selIdx && (
          <g>
            <circle
              cx={x(lowIdx)}
              cy={y(values[lowIdx])}
              r="5"
              fill={values[lowIdx] < floor ? 'var(--coral, #dc5245)' : 'var(--amber, #b97d06)'}
              stroke="#ffffff"
              strokeWidth="2"
            />
            <text
              x={Math.min(Math.max(x(lowIdx), PAD.l + 18), w - PAD.r - 18)}
              y={Math.min(y(values[lowIdx]) + 16, baseY - 6)}
              textAnchor="middle"
              fontSize="10"
              fontWeight="650"
              fill="var(--ink-2, #46536b)"
            >
              menor
            </text>
          </g>
        )}

        {/* Scrubber ativo (linha vertical guia) */}
        <line
          x1={selX}
          x2={selX}
          y1={PAD.t - 10}
          y2={baseY}
          stroke="var(--navy, #0e1b36)"
          strokeWidth="1.25"
          strokeDasharray="2 2"
          opacity="0.3"
        />

        {/* Ponto selecionado */}
        <circle cx={selX} cy={selY} r="6.5" fill="var(--blue, #2563eb)" stroke="#ffffff" strokeWidth="2.5" />

        {/* Tooltip flutuante com data e saldo */}
        <g filter="url(#mf-shadow)">
          <rect
            x={tooltipX}
            y={tooltipY}
            width={tooltipW}
            height={tooltipH}
            rx="7"
            ry="7"
            fill="var(--navy, #0e1b36)"
          />
          <text
            x={tooltipX + tooltipW / 2}
            y={tooltipY + 15}
            textAnchor="middle"
            fontSize="10.5"
            fontWeight="650"
            fill="#ffffff"
            letterSpacing="-0.01em"
          >
            {tooltipText}
          </text>
        </g>

        {/* Eixo temporal com ticks */}
        {ticks.map((i, k) => (
          <text
            key={k}
            x={k === 0 ? PAD.l : k === 2 ? w - PAD.r : x(i)}
            y={H - 8}
            fontSize="11"
            fill="var(--ink-3, #7b879b)"
            fontWeight="500"
            textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}
          >
            {fmtDayMonth(days[i].date)}
          </text>
        ))}
      </svg>
    </div>
  );
});
