'use client';

import type { ReactNode } from 'react';
import clsx from 'clsx';
import Select from '../ui/Select';
import { formatMonth, shiftMonth } from '../../lib/api/hr';
import type { BusinessUnitRecord } from '../../lib/api/ledger';

/** The white card every dashboard page section sits in. */
export function Section({ title, subtitle, actions, children, className }: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx('flex flex-col gap-4 rounded-xl bg-white p-4 shadow-[0_0_35px_0_rgb(0_0_0/0.04)] md:p-5', className)}>
      {(title || actions) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {title && <p className="text-lg font-bold text-black">{title}</p>}
            {subtitle && <p className="text-sm text-gray-600">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

const PILL_TONES = {
  gray: 'bg-gray-50 text-gray-700 border-gray-200',
  green: 'bg-green-50 text-green-700 border-green-200',
  amber: 'bg-warning-25 text-warning-800 border-warning-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  blue: 'bg-sky-50 text-sky-700 border-sky-200',
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
} as const;

export type PillTone = keyof typeof PILL_TONES;

export function Pill({ tone = 'gray', children, title }: { tone?: PillTone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={clsx('inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', PILL_TONES[tone])}>
      {children}
    </span>
  );
}

export type Notice = { tone: 'ok' | 'error' | 'warn'; text: ReactNode } | null;

export function NoticeLine({ notice, onClose }: { notice: Notice; onClose?: () => void }) {
  if (!notice) return null;
  return (
    <div
      className={clsx(
        'flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm',
        notice.tone === 'ok' && 'border-green-200 bg-green-50 text-green-700',
        notice.tone === 'error' && 'border-red-300 bg-red-50 text-red-600',
        notice.tone === 'warn' && 'border-warning-200 bg-warning-25 text-warning-900',
      )}
    >
      <div>{notice.text}</div>
      {onClose && (
        <button type="button" onClick={onClose} className="shrink-0 text-xs opacity-70 hover:opacity-100" aria-label="Dismiss">
          ✕
        </button>
      )}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  counts,
}: {
  tabs: readonly T[];
  value: T;
  onChange: (t: T) => void;
  /** A number badge after a tab's label (hidden when 0). */
  counts?: Partial<Record<T, number>>;
}) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-gray-200">
      {tabs.map((t) => (
        <button
          key={t}
          role="tab"
          type="button"
          aria-selected={value === t}
          onClick={() => onChange(t)}
          className={clsx(
            '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition',
            value === t ? 'border-accent text-accent' : 'border-transparent text-gray-600 hover:text-gray-900',
          )}
        >
          {t}
          {counts?.[t] ? (
            <span className="ml-1.5 rounded-full bg-warning-100 px-1.5 py-0.5 text-[11px] font-semibold text-warning-800">{counts[t]}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function UnitPicker({
  units,
  value,
  onChange,
  allowAll,
  label,
}: {
  units: BusinessUnitRecord[];
  value: string;
  onChange: (id: string) => void;
  allowAll?: boolean;
  label?: string;
}) {
  return (
    <Select
      label={label}
      placeholder="All units"
      value={value}
      onChange={onChange}
      options={[
        ...(allowAll ? [{ label: 'All units', value: '' }] : []),
        ...units.map((u) => ({ label: `${u.name} (${u.code})`, value: u.id })),
      ]}
    />
  );
}

export function MonthPicker({ value, onChange, max }: { value: string; onChange: (m: string) => void; max?: string }) {
  const atMax = Boolean(max && value >= max);
  return (
    <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1">
      <button
        type="button"
        onClick={() => onChange(shiftMonth(value, -1))}
        className="rounded-md px-2 py-1 text-sm text-gray-700 hover:bg-gray-100"
        aria-label="Previous month"
      >
        ‹
      </button>
      <span className="min-w-32 text-center text-sm font-medium text-gray-900">{formatMonth(value)}</span>
      <button
        type="button"
        onClick={() => onChange(shiftMonth(value, 1))}
        disabled={atMax}
        className="rounded-md px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-30"
        aria-label="Next month"
      >
        ›
      </button>
    </div>
  );
}

/** A labelled figure in a stat strip. */
export function Figure({ label, value, tone, hint }: { label: string; value: ReactNode; tone?: 'danger' | 'accent'; hint?: string }) {
  return (
    <div className="min-w-0" title={hint}>
      <p className="truncate text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p
        className={clsx(
          'truncate text-sm font-semibold tabular-nums',
          tone === 'danger' ? 'text-danger' : tone === 'accent' ? 'text-accent' : 'text-gray-900',
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-normal text-gray-800 md:text-base">
        {label} {required && <span className="text-red-500"> *</span>}
      </span>
      <textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-gray-200 px-3.5 py-2 text-base text-gray-700 outline-none placeholder:text-gray-300 focus:border-gray-400"
      />
    </label>
  );
}
