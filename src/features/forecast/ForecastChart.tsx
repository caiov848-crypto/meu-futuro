import { memo, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Cents, ISODate } from '../../domain/types';
import type { ForecastDay } from '../../engine';
import { fmtDayMonth } from '../../lib/date';
import { formatCompact } from '../../lib/money';

const H = 210;
const PAD = { l: 6, r: 6, t: 18, b: 26 };

/** Gráfico de linha em degraus: saldo projetado, segurança, menor saldo e data selecionada. */
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
    const el = wrap.current!;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setW(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = days.length;
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
    if (d.date !== selected) onSelect(d.date);
  };
  const onKey = (e: KeyboardEvent) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    onSelect(days[Math.min(n - 1, Math.max(0, selIdx + delta))].date);
  };

  const ticks = [0, Math.floor((n - 1) / 2), n - 1];

  return (
    <div className="chart-wrap" ref={wrap}>
      <svg
        width={w}
        height={H}
        role="slider"
        tabIndex={0}
        aria-label="Saldo previsto por dia"
        aria-valuetext={`${fmtDayMonth(days[selIdx].date)}: ${formatCompact(days[selIdx].closing)} reais`}
        onPointerDown={(e) => { dragging.current = true; pick(e); }}
        onPointerMove={(e) => { if (dragging.current || e.pointerType === 'mouse' && e.buttons === 1) pick(e); }}
        onPointerUp={() => { dragging.current = false; }}
        onPointerLeave={() => { dragging.current = false; }}
        onKeyDown={onKey}
      >
        <defs>
          <linearGradient id="mf-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#2563eb" stopOpacity="0.16" />
            <stop offset="1" stopColor="#2563eb" stopOpacity="0" />
          </linearGradient>
        </defs>

        {floorY < baseY && <rect x={PAD.l} y={floorY} width={innerW} height={baseY - floorY} fill="#dc5245" opacity="0.05" />}
        <path d={area} fill="url(#mf-area)" />
        <line x1={PAD.l} x2={PAD.l + innerW} y1={floorY} y2={floorY} stroke="#dc5245" strokeWidth="1.5" strokeDasharray="5 5" opacity="0.75" />
        <text x={PAD.l + innerW} y={floorY - 6} textAnchor="end" fontSize="10.5" fill="#dc5245" fontWeight="600">
          segurança {formatCompact(floor)}
        </text>

        <path d={line} fill="none" stroke="#2563eb" strokeWidth="2.25" strokeLinejoin="round" />

        {days.map((d, i) => d.events.length > 0 && i !== selIdx && i !== lowIdx && (
          <circle key={d.date} cx={x(i)} cy={y(d.closing)} r="2.75" fill="#fff" stroke="#2563eb" strokeWidth="1.5" />
        ))}

        {lowIdx >= 0 && (
          <g>
            <circle cx={x(lowIdx)} cy={y(values[lowIdx])} r="5.5" fill={values[lowIdx] < floor ? '#dc5245' : '#b97d06'} stroke="#fff" strokeWidth="2" />
            <text x={Math.min(Math.max(x(lowIdx), 30), w - 30)} y={y(values[lowIdx]) + 18} textAnchor="middle" fontSize="10.5" fontWeight="600" fill="#46536b">
              menor
            </text>
          </g>
        )}

        <line x1={x(selIdx)} x2={x(selIdx)} y1={PAD.t - 8} y2={baseY} stroke="#0e1b36" strokeWidth="1" opacity="0.25" />
        <circle cx={x(selIdx)} cy={y(values[selIdx])} r="6.5" fill="#2563eb" stroke="#fff" strokeWidth="2.5" />

        {ticks.map((i, k) => (
          <text key={k} x={x(i)} y={H - 8} fontSize="11" fill="#7b879b" textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}>
            {fmtDayMonth(days[i].date)}
          </text>
        ))}
      </svg>
    </div>
  );
});
