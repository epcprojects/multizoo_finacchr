'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import Input from '../ui/Input';
import {
  previewAllocationRule,
  type RulePreview,
  type RuleTranchePayload,
} from '../../lib/api/allocation';
import { errorMessage, formatDate, formatMoney, isAmount, toPaisa } from '../../lib/money';

/**
 * "Safe to experiment with" (plan Part 04): what a rule would do to a
 * sample day's income, and what it would have done to the last month of
 * real income compared with the rules that actually applied.
 */
export default function RulePreviewPanel({
  businessUnitId,
  tranches,
  onProblems,
}: {
  businessUnitId: string;
  tranches: RuleTranchePayload[];
  /** Server-side problems (e.g. a reserve that's not this unit's) — the editor shows them. */
  onProblems?: (problems: string[]) => void;
}) {
  const [sample, setSample] = useState('100000');
  const [days, setDays] = useState(30);
  const [preview, setPreview] = useState<RulePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = JSON.stringify({ businessUnitId, tranches, sample, days });
  useEffect(() => {
    const ready = tranches.length && tranches.every((t) => t.lines.length && t.lines.every((l) => l.accountId || l.partnerId));
    if (!ready || !isAmount(sample)) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      previewAllocationRule({ businessUnitId, tranches, sampleAmount: sample, days })
        .then((p) => {
          if (cancelled) return;
          setPreview(p);
          setError(null);
          onProblems?.(p.problems);
        })
        .catch((err) => !cancelled && setError(errorMessage(err, 'Could not preview this rule.')))
        .finally(() => !cancelled && setLoading(false));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Re-run only when the rule, sample or period actually changes (key), not on every render.
  }, [key]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Input
          label="Try it on a day's income (Rs)"
          inputMode="decimal"
          value={sample}
          wrapperClassName="sm:max-w-60"
          onChange={(e) => setSample(e.target.value.replace(/[^\d.]/g, ''))}
          errorText={sample && !isAmount(sample) ? 'Up to 2 decimal places' : undefined}
        />
        <div className="flex gap-1.5 pb-0.5" role="group" aria-label="Replay period">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={clsx(
                'rounded-full border px-3 py-1.5 text-xs font-medium',
                days === d ? 'border-accent bg-accent text-white' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
              )}
            >
              Last {d} days
            </button>
          ))}
        </div>
        {loading && <span className="pb-2 text-xs text-gray-500">Updating…</span>}
      </div>

      {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      {preview?.sample && preview.history && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="overflow-hidden rounded-xl border border-gray-200">
            <p className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-900">
              {formatMoney(preview.sample.gross, { decimals: false })} would be earmarked as
            </p>
            <table className="w-full text-left text-sm">
              <tbody>
                {preview.sample.lines.map((l, i) => (
                  <tr key={`${l.key}-${i}`} className="border-t border-gray-100 first:border-t-0">
                    <td className="px-3 py-1.5 text-gray-900">
                      {l.label}
                      <span className="ml-1 text-xs text-gray-500">· {l.tranche}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right text-xs tabular-nums text-gray-500">{l.percentOfIncome}%</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-900">{formatMoney(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-200">
            <p className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-900">
              {formatDate(preview.history.from)} – {formatDate(preview.history.to)}, replayed
              <span className="block text-xs font-normal text-gray-600">
                {formatMoney(preview.history.totalIncome, { decimals: false })} of income on {preview.history.daysWithIncome}{' '}
                {preview.history.daysWithIncome === 1 ? 'day' : 'days'} · rules in force then vs this rule
              </span>
            </p>
            {preview.history.targets.length ? (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-1.5 font-medium">Goes to</th>
                    <th className="px-3 py-1.5 text-right font-medium">Actual</th>
                    <th className="px-3 py-1.5 text-right font-medium">This rule</th>
                    <th className="px-3 py-1.5 text-right font-medium">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.history.targets.map((t) => {
                    const diff = toPaisa(t.difference);
                    return (
                      <tr key={t.key} className="border-t border-gray-100">
                        <td className="px-3 py-1.5 text-gray-900">{t.label}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{formatMoney(t.current, { prefix: false })}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-900">{formatMoney(t.proposed, { prefix: false })}</td>
                        <td
                          className={clsx(
                            'px-3 py-1.5 text-right font-medium tabular-nums',
                            diff > 0n ? 'text-green-600' : diff < 0n ? 'text-red-600' : 'text-gray-400',
                          )}
                        >
                          {diff > 0n ? '+' : ''}
                          {diff === 0n ? '—' : formatMoney(t.difference, { prefix: false })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="px-3 py-4 text-sm text-gray-500">No income was recorded in this period.</p>
            )}
            {toPaisa(preview.history.unruledIncome) > 0n && (
              <p className="border-t border-gray-200 px-3 py-2 text-xs text-gray-500">
                {formatMoney(preview.history.unruledIncome, { decimals: false })} fell on days before any rule applied, so it has no
                “actual” figure.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
