import { useRef, type ReactNode } from 'react';
import type { Cents, ISODate } from '../domain/types';
import type { FinancialStatus } from '../engine';
import { addDays, endOfMonth, fmtDayMonth } from '../lib/date';
import { digitsToCents, formatMoney, type MoneyFormat } from '../lib/money';
import { Icon } from './Icon';

export function Money({ cents, className = '', ...fmt }: { cents: Cents; className?: string } & MoneyFormat) {
  return <span className={`money ${className}`}>{formatMoney(cents, fmt)}</span>;
}

export function Sheet(props: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <>
      <header className="sheet-head">
        <span className="sheet-grip" />
        <div>
          <h2>{props.title}</h2>
          {props.subtitle && <p>{props.subtitle}</p>}
        </div>
        <button className="icon-btn" aria-label="Fechar" onClick={props.onClose}>
          <Icon name="close" size={20} />
        </button>
      </header>
      <div className="sheet-body">{props.children}</div>
      {props.footer && <footer className="sheet-foot">{props.footer}</footer>}
    </>
  );
}

export function Segmented<T extends string | number>(props: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button key={String(o.value)} aria-pressed={o.value === props.value} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip(props: { active?: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button type="button" className={`chip ${props.className ?? ''}`} aria-pressed={props.active ?? false} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

export function Field(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      {props.children}
      {props.hint && <span className="field-hint">{props.hint}</span>}
    </label>
  );
}

/** Campo de valor com máscara de centavos: digitar 3500 vira R$35,00. */
export function AmountInput(props: {
  value: Cents;
  onChange: (v: Cents) => void;
  autoFocus?: boolean;
  size?: 'lg' | 'md';
  label?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const toEnd = () => {
    const el = ref.current;
    if (el) requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
  };
  const input = (
    <input
      ref={ref}
      className={props.size === 'md' ? 'input amount-md' : 'amount-input'}
      inputMode="numeric"
      autoFocus={props.autoFocus}
      aria-label={props.label ?? 'Valor'}
      data-empty={props.value === 0 || undefined}
      value={formatMoney(props.value)}
      onFocus={toEnd}
      onClick={toEnd}
      onChange={(e) => {
        props.onChange(digitsToCents(e.target.value));
        toEnd();
      }}
    />
  );
  if (props.size === 'md') return input;
  return (
    <div className="amount-box">
      {props.label && <span className="field-label">{props.label}</span>}
      {input}
    </div>
  );
}

type DateMode = 'past' | 'future';

/** Atalhos de data + seletor nativo. */
export function DateShortcuts(props: {
  value: ISODate;
  today: ISODate;
  onChange: (d: ISODate) => void;
  mode: DateMode;
  min?: ISODate;
  max?: ISODate;
}) {
  const { today } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const options: { label: string; date: ISODate }[] =
    props.mode === 'past'
      ? [
          { label: 'Hoje', date: today },
          { label: 'Ontem', date: addDays(today, -1) },
        ]
      : [
          { label: 'Hoje', date: today },
          { label: 'Amanhã', date: addDays(today, 1) },
          { label: '7 dias', date: addDays(today, 7) },
          { label: '15 dias', date: addDays(today, 15) },
          { label: 'Fim do mês', date: endOfMonth(today) },
        ];
  const matched = options.some((o) => o.date === props.value);
  return (
    <div className="chips chips-scroll">
      {options.map((o) => (
        <Chip key={o.label} active={o.date === props.value && (o.label !== 'Fim do mês' || !options.slice(0, -1).some((x) => x.date === o.date))} onClick={() => props.onChange(o.date)}>
          {o.label}
        </Chip>
      ))}
      <label className="chip" aria-pressed={!matched} onClick={() => inputRef.current?.showPicker?.()}>
        <Icon name="calendar" size={16} />
        {matched ? 'Escolher data' : fmtDayMonth(props.value)}
        <input
          ref={inputRef}
          type="date"
          className="date-native"
          value={props.value}
          min={props.min}
          max={props.max}
          onChange={(e) => e.target.value && props.onChange(e.target.value)}
        />
      </label>
    </div>
  );
}

export function StatusText({ status, children }: { status: FinancialStatus; children: ReactNode }) {
  return <span className="status" data-status={status}>{children}</span>;
}

export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={props.checked} aria-label={props.label} className="toggle" onClick={() => props.onChange(!props.checked)} />
  );
}

export function ConfirmSheet(props: {
  close: () => void;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <Sheet
      title={props.title}
      onClose={props.close}
      footer={
        <>
          <button className="btn btn-ghost" onClick={props.close}>Cancelar</button>
          <button
            className={`btn ${props.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={async () => {
              await props.onConfirm();
              props.close();
            }}
          >
            {props.confirmLabel}
          </button>
        </>
      }
    >
      <p className="muted">{props.message}</p>
    </Sheet>
  );
}
