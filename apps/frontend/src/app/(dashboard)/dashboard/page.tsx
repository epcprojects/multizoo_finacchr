'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { useUser } from '../../../components/layout/UserProvider';
import StatCard from '../../../components/ui/StatCard';
import Button from '../../../components/ui/Button';
import NewEntryPanel from '../../../components/ledger/NewEntryPanel';
import EntryDetailModal from '../../../components/ledger/EntryDetailModal';
import { PlusIcon } from '../../../components/ui/icons';
import PdfButton from '../../../components/reports/PdfButton';
import {
  getCashPosition,
  KIND_LABELS,
  listBusinessUnits,
  listJournalEntries,
  type BusinessUnitRecord,
  type CashPosition,
  type JournalEntryRecord,
} from '../../../lib/api/ledger';
import { formatDate, formatMoney, todayIso, toPaisa } from '../../../lib/money';

const money = (v: string) => formatMoney(v, { decimals: false });

/**
 * The Daily Cash Position report (architecture plan Part 08), live: every
 * unit's cash in hand, bank and Easypaisa as of a date, plus that day's
 * money in and out. Transfers between a unit's own accounts net to zero and
 * opening balances don't count as the day's money.
 */
export default function DashboardPage() {
  const router = useRouter();
  const { user, hasPermission } = useUser();
  const canViewLedger = hasPermission('ledger.view');
  const canPost = hasPermission('transactions.create_own_unit');
  const canReverse = hasPermission('transactions.reverse');
  const isAccountant = hasPermission('ledger.reconcile');

  const [asOf, setAsOf] = useState(todayIso());
  const [position, setPosition] = useState<CashPosition | null>(null);
  const [recent, setRecent] = useState<JournalEntryRecord[]>([]);
  const [units, setUnits] = useState<BusinessUnitRecord[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const tasks: Promise<unknown>[] = [
      listBusinessUnits().then(setUnits),
      listJournalEntries({ limit: 8 }).then((r) => setRecent(r.items)),
    ];
    if (canViewLedger) tasks.push(getCashPosition(asOf).then(setPosition));
    await Promise.allSettled(tasks);
  }, [asOf, canViewLedger]);

  useEffect(() => {
    if (canViewLedger || canPost) void refresh();
  }, [refresh, canViewLedger, canPost]);

  const t = position?.totals;
  // Columns = the classes configured as money on hand (Cash, Bank, … + any added later).
  const cols = position?.classes ?? [];
  const CLASS_COLORS = ['#34D399', '#818CF8', '#40C3FF', '#F472B6', '#FBBF24', '#A3E635'];
  const heroStats = t
    ? [
        { key: 'total', label: 'Group cash position', count: money(t.total), color: '#A78BFA' },
        ...cols.slice(0, 3).map((c, i) => ({
          key: c.id,
          label: c.name,
          count: money(t.byClass[c.id] ?? '0'),
          color: CLASS_COLORS[i % CLASS_COLORS.length],
        })),
        { key: 'net', label: asOf === todayIso() ? 'Today in / out' : 'Day in / out', count: `${money(t.inflow)} / ${money(t.outflow)}`, color: '#F5A623' },
      ]
    : [];

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:overflow-hidden xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <div className="shrink-0">
          <div className="flex w-full flex-col justify-between gap-2 rounded-[10px] xl:rounded-xl bg-[url('/dashboard-bg.jpg')] bg-cover bg-center bg-no-repeat p-4 sm:p-5 xl:gap-8.5 xl:p-7.5">
            <div className="flex flex-col items-start gap-3 xl:flex-row xl:items-center xl:gap-6">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <p className="text-2xl text-white font-semibold sm:text-[32px]">Good Day, {user?.fullName ?? ''} 👋</p>
                <p className="text-sm text-gray-100 sm:text-lg">
                  {canViewLedger
                    ? `Cash position across ${position?.units.length ?? '…'} business unit${position?.units.length === 1 ? '' : 's'} as of ${formatDate(asOf)}`
                    : 'Record the day’s sales and expenses for your unit'}
                </p>
              </div>
              {canPost && (
                <Button className="shrink-0 rounded-full" icon={<PlusIcon width="20" height="20" />} onClick={() => setNewOpen(true)}>
                  New Entry
                </Button>
              )}
            </div>
            {heroStats.length > 0 && (
              <div className="grid grid-cols-2 gap-1.5 xl:grid-cols-3 2xl:grid-cols-5 xl:gap-5">
                {heroStats.map((s) => (
                  <StatCard key={s.key} title={s.label} count={s.count} color={s.color} />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={clsx('grid min-h-0 flex-1 gap-3', canViewLedger && 'xl:grid-cols-[minmax(0,1fr)_380px]')}>
          {canViewLedger && (
            <div className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-white p-4 shadow-[0_0_35px_0_rgb(0_0_0/0.04)] md:p-5">
              <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
                <p className="text-lg font-bold text-black">Cash position by unit</p>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 text-sm text-gray-600">
                    As of
                    <input
                      type="date"
                      value={asOf}
                      max={todayIso()}
                      onChange={(e) => e.target.value && setAsOf(e.target.value)}
                      className="h-9 rounded-lg border border-gray-200 px-2 text-sm text-gray-800"
                    />
                  </label>
                  <PdfButton report="cash-position" params={{ asOf }} />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-gray-200">
                <table className="w-full min-w-160 text-left">
                  <thead className="bg-gray-50">
                    <tr>
                      {['Unit', ...cols.map((c) => c.name), 'Total', 'In / Out'].map((h, i) => (
                        <th
                          key={h}
                          className={clsx('sticky top-0 bg-gray-50 px-4 py-2.5 text-xs font-semibold text-gray-900', i > 0 && 'text-right')}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {position?.units.length ? (
                      position.units.map((u) => (
                        <tr key={u.id} className="border-b border-gray-200 last:border-0">
                          <td className="px-4 py-3">
                            <p className="text-sm font-medium text-gray-900">{u.name}</p>
                            <p className="font-mono text-xs text-gray-500">{u.code}</p>
                          </td>
                          {cols.map((c) => {
                            const own = u.accounts.filter((a) => a.classId === c.id);
                            // One account → link straight to its ledger; several → the unit's chart.
                            const acct = own.length === 1 ? own[0] : null;
                            const value = u.byClass[c.id] ?? '0.00';
                            return (
                              <td key={c.id} className="px-4 py-3 text-right text-sm tabular-nums">
                                {acct ? (
                                  <Link
                                    href={`/accounts/${acct.id}`}
                                    className={clsx('hover:text-accent', toPaisa(value) < 0n ? 'text-red-600' : 'text-gray-800')}
                                  >
                                    {money(value)}
                                  </Link>
                                ) : own.length ? (
                                  <span className={toPaisa(value) < 0n ? 'text-red-600' : 'text-gray-800'}>{money(value)}</span>
                                ) : (
                                  <span className="text-gray-300">—</span>
                                )}
                              </td>
                            );
                          })}
                          <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-gray-900">{money(u.total)}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-xs tabular-nums">
                            <span className="text-green-700">+{money(u.inflow)}</span>
                            <span className="text-gray-400"> / </span>
                            <span className="text-red-600">−{money(u.outflow)}</span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={cols.length + 3} className="px-4 py-8 text-center text-sm text-gray-500">
                          {position ? 'No business units available to you.' : 'Loading…'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {t && position && position.units.length > 1 && (
                    <tfoot>
                      <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
                        <td className="px-4 py-3 text-sm text-gray-900">Group</td>
                        {[...cols.map((c) => t.byClass[c.id] ?? '0.00'), t.total].map((v, i) => (
                          <td key={i} className="px-4 py-3 text-right text-sm tabular-nums text-gray-900">
                            {money(v)}
                          </td>
                        ))}
                        <td className="whitespace-nowrap px-4 py-3 text-right text-xs tabular-nums">
                          <span className="text-green-700">+{money(t.inflow)}</span>
                          <span className="text-gray-400"> / </span>
                          <span className="text-red-600">−{money(t.outflow)}</span>
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          <div className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-white p-4 shadow-[0_0_35px_0_rgb(0_0_0/0.04)] md:p-5">
            <div className="mb-3 flex shrink-0 items-center justify-between">
              <p className="text-lg font-bold text-black">Recent entries</p>
              <Link href="/transactions" className="text-sm font-medium text-accent hover:underline">
                View all
              </Link>
            </div>
            <ul className="min-h-0 flex-1 overflow-auto rounded-xl border border-gray-200">
              {recent.length ? (
                recent.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => setOpenEntryId(e.id)}
                      className="flex w-full items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 text-left hover:bg-gray-50"
                    >
                      <div className="min-w-0">
                        <p className={clsx('truncate text-sm font-medium text-gray-800', e.reversedById && 'line-through text-gray-400')}>
                          {e.description}
                        </p>
                        <p className="truncate text-xs text-gray-500">
                          {e.displayNo} · {formatDate(e.entryDate)} · {e.businessUnit?.code} · {KIND_LABELS[e.kind]}
                        </p>
                      </div>
                      <span
                        className={clsx(
                          'shrink-0 text-sm font-semibold tabular-nums',
                          e.kind === 'MONEY_IN' ? 'text-green-700' : e.kind === 'MONEY_OUT' ? 'text-red-600' : 'text-gray-800',
                        )}
                      >
                        {money(e.amount)}
                      </span>
                    </button>
                  </li>
                ))
              ) : (
                <li className="px-4 py-8 text-center text-sm text-gray-500">
                  {canPost ? 'Nothing recorded yet — start with New Entry.' : 'No entries yet.'}
                </li>
              )}
            </ul>
            {!canViewLedger && !canPost && (
              <p className="mt-3 text-sm text-gray-600">
                Your role doesn&apos;t include ledger access yet. Manage people from{' '}
                <button type="button" className="text-accent hover:underline" onClick={() => router.push('/users')}>
                  Users
                </button>
                .
              </p>
            )}
          </div>
        </div>
      </div>

      <NewEntryPanel
        isOpen={newOpen}
        onClose={() => setNewOpen(false)}
        units={units}
        isAccountant={isAccountant}
        onPosted={() => {
          setNewOpen(false);
          void refresh();
        }}
      />
      <EntryDetailModal
        entryId={openEntryId}
        onClose={() => setOpenEntryId(null)}
        canReverse={canReverse}
        onChanged={() => void refresh()}
        onOpenEntry={setOpenEntryId}
      />
    </div>
  );
}
