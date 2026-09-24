'use client';

import clsx from 'clsx';
import type { RuleTranche } from '../../lib/api/allocation';
import { formatMoney } from '../../lib/money';

/** One colour per tranche, in order — the bar and the cards share them. */
export const TRANCHE_COLORS = ['#673DE6', '#0EA5E9', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6', '#EC4899'];

export function pct(value: string) {
  return `${value}%`;
}

/** The share bar: each tranche's slice of a day's income, to scale. */
export function TrancheBar({
  tranches,
  className,
}: {
  tranches: { name: string; share: string }[];
  className?: string;
}) {
  return (
    <div className={clsx('flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100', className)} aria-hidden="true">
      {tranches.map((t, i) => (
        <span
          key={`${t.name}-${i}`}
          title={`${t.name} · ${pct(t.share)}`}
          style={{ width: `${Number(t.share)}%`, backgroundColor: TRANCHE_COLORS[i % TRANCHE_COLORS.length] }}
          className="h-full border-r border-white last:border-r-0"
        />
      ))}
    </div>
  );
}

/**
 * A rule as the waterfall it is (plan Fig. 3): the day's income split into
 * tranches, each tranche split among its lines. `amounts` (keyed by line
 * id or label) shows what a given day's income would put in each.
 */
export default function RuleWaterfall({
  tranches,
  amounts,
}: {
  tranches: RuleTranche[];
  amounts?: Map<string, string>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <TrancheBar tranches={tranches} className="h-3" />
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {tranches.map((t, i) => (
            <span key={t.id} className="flex items-center gap-1.5 text-xs text-gray-700">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: TRANCHE_COLORS[i % TRANCHE_COLORS.length] }} />
              {t.name} · <span className="font-semibold">{pct(t.share)}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {tranches.map((t, i) => (
          <section key={t.id} className="rounded-xl border border-gray-200 bg-white">
            <header
              className="flex items-center justify-between gap-2 rounded-t-xl border-b border-gray-200 px-3 py-2"
              style={{ borderTop: `3px solid ${TRANCHE_COLORS[i % TRANCHE_COLORS.length]}` }}
            >
              <p className="text-sm font-semibold text-gray-900">{t.name}</p>
              <p className="text-xs text-gray-600">
                {pct(t.share)} of income · {t.method === 'PERCENT' ? 'split by %' : 'split by parts'}
              </p>
            </header>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-1.5 font-medium">Goes to</th>
                  <th className="px-3 py-1.5 text-right font-medium">{t.method === 'PERCENT' ? 'Of tranche' : 'Parts'}</th>
                  <th className="px-3 py-1.5 text-right font-medium">Of income</th>
                  {amounts && <th className="px-3 py-1.5 text-right font-medium">Amount</th>}
                </tr>
              </thead>
              <tbody>
                {t.lines.map((l) => (
                  <tr key={l.id} className="border-t border-gray-100">
                    <td className="px-3 py-1.5 text-gray-900">
                      {l.label}
                      {l.targetType === 'PARTNER' && (
                        <span className="ml-1.5 rounded-full bg-orange-50 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">
                          partner
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                      {t.method === 'PERCENT' ? pct(l.weight) : l.weight}
                    </td>
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums text-gray-900">{pct(l.percentOfIncome)}</td>
                    {amounts && (
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-900">
                        {formatMoney(amounts.get(l.id) ?? '0')}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </div>
  );
}
