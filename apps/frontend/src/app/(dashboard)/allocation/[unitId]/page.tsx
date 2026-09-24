'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import clsx from 'clsx';
import { useUser } from '../../../../components/layout/UserProvider';
import Button from '../../../../components/ui/Button';
import Input from '../../../../components/ui/Input';
import PageBanner from '../../../../components/ui/PageBanner';
import RuleWaterfall from '../../../../components/allocation/RuleWaterfall';
import RuleEditorPanel from '../../../../components/allocation/RuleEditorPanel';
import RuleReviewModal, { StatusChip, effectiveRange } from '../../../../components/allocation/RuleReviewModal';
import OpeningReservesModal from '../../../../components/allocation/OpeningReservesModal';
import NewEntryPanel from '../../../../components/ledger/NewEntryPanel';
import EntryDetailModal from '../../../../components/ledger/EntryDetailModal';
import {
  allocateDay,
  allocateOutstanding,
  getAllocationDays,
  getUnitReserves,
  listAllocationRules,
  undoAllocationRun,
  type AllocationDays,
  type AllocationRuleRecord,
  type DayState,
  type UnitReserves,
} from '../../../../lib/api/allocation';
import { listBusinessUnits, type BusinessUnitRecord } from '../../../../lib/api/ledger';
import { errorMessage, formatDate, formatMoney, todayIso, toPaisa } from '../../../../lib/money';

const TABS = ['Days', 'Reserves', 'Rule & history'] as const;
type Tab = (typeof TABS)[number];

const STATE_LABEL: Record<DayState, string> = {
  ALLOCATED: 'Allocated',
  PENDING: 'To allocate',
  CHANGED: 'Income changed — re-run',
  NO_RULE: 'Before any rule',
  NO_INCOME: 'No income',
};
const STATE_TONE: Record<DayState, string> = {
  ALLOCATED: 'bg-green-50 text-green-700 border-green-200',
  PENDING: 'bg-warning-25 text-warning-800 border-warning-200',
  CHANGED: 'bg-red-50 text-red-700 border-red-200',
  NO_RULE: 'bg-gray-50 text-gray-500 border-gray-200',
  NO_INCOME: 'bg-gray-50 text-gray-400 border-gray-200',
};

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * One unit's waterfall: its days (what came in, how it was split, what
 * still needs allocating), its reserves (what's earmarked for what), and
 * its rule with the full version history.
 */
export default function UnitAllocationPage() {
  const { unitId } = useParams<{ unitId: string }>();
  const { user, hasPermission } = useUser();
  const canRun = hasPermission('allocation.run');
  const canApprove = hasPermission('rules.edit_allocation');
  const canPropose = hasPermission('rules.propose_allocation') || canApprove;
  const isAccountant = hasPermission('ledger.reconcile');

  const [tab, setTab] = useState<Tab>('Days');
  const [from, setFrom] = useState(addDays(todayIso(), -29));
  const [to, setTo] = useState(todayIso());
  const [days, setDays] = useState<AllocationDays | null>(null);
  const [reserves, setReserves] = useState<UnitReserves | null>(null);
  const [rules, setRules] = useState<AllocationRuleRecord[]>([]);
  const [units, setUnits] = useState<BusinessUnitRecord[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [editor, setEditor] = useState<{ open: boolean; base: AllocationRuleRecord | null; mode: 'new' | 'edit' }>({
    open: false,
    base: null,
    mode: 'new',
  });
  const [reviewing, setReviewing] = useState<AllocationRuleRecord | null>(null);
  const [openingOpen, setOpeningOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [entryId, setEntryId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [d, r, rl] = await Promise.all([
      getAllocationDays(unitId, { from, to }),
      getUnitReserves(unitId),
      listAllocationRules({ businessUnitId: unitId }),
    ]);
    setDays(d);
    setReserves(r);
    setRules(rl);
  }, [unitId, from, to]);

  useEffect(() => {
    void refresh().catch((err) => setMessage({ tone: 'error', text: errorMessage(err, 'Could not load this unit.') }));
  }, [refresh]);

  useEffect(() => {
    void listBusinessUnits().then(setUnits);
  }, []);

  const unit = days?.unit ?? reserves?.unit;
  const current = rules.find((r) => r.isCurrent) ?? null;
  const upcoming = rules.filter((r) => r.isUpcoming).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const earliestStart = days?.lastAllocatedDate ? addDays(days.lastAllocatedDate, 1) : '2000-01-01';
  const outstanding = (days?.outstanding.pending ?? 0) + (days?.outstanding.changed ?? 0);

  async function run(label: string, fn: () => Promise<string>) {
    setBusy(label);
    setMessage(null);
    try {
      setMessage({ tone: 'ok', text: await fn() });
      await refresh();
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err, 'That did not work.') });
    } finally {
      setBusy(null);
    }
  }

  const allocate = (date: string) =>
    run(date, async () => {
      const r = await allocateDay(unitId, date);
      return r.run
        ? `${formatDate(date)} allocated — ${formatMoney(r.run.grossIncome)} split by rule v${r.run.ruleVersion} (${r.run.entryNo}).`
        : `${formatDate(date)} now has no income, so its allocation was undone.`;
    });

  const allocateAll = () =>
    run('all', async () => {
      const r = await allocateOutstanding(unitId);
      const done = `${r.allocated} ${r.allocated === 1 ? 'day' : 'days'} allocated.`;
      if (r.stoppedAt) throw new Error(`${done} Stopped at ${formatDate(r.stoppedAt.date)}: ${r.stoppedAt.reason}`);
      return done;
    });

  const undo = (runId: string, date: string) =>
    run(runId, async () => {
      await undoAllocationRun(runId, 'undone from the Allocation screen');
      return `${formatDate(date)}'s allocation was reversed. The day is back in the “to allocate” list.`;
    });

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <div className="shrink-0">
          <PageBanner
            imageSrc="/allocation-icon.svg"
            imageAlt="Income allocation"
            title={unit ? `${unit.name} — Allocation` : 'Allocation'}
            stats={[
              { title: 'Days to allocate', count: outstanding, color: outstanding ? '#F5A623' : '#34D399' },
              { title: 'Earmarked', count: formatMoney(reserves?.totals.earmarked ?? '0', { decimals: false }), color: '#A78BFA' },
              {
                title: 'Not yet earmarked',
                count: formatMoney(reserves?.totals.unearmarked ?? '0', { decimals: false }),
                color: '#34D399',
              },
            ]}
          />
        </div>

        <p className="px-1 text-sm text-gray-600">
          <Link href="/allocation" className="hover:text-accent">
            Allocation
          </Link>{' '}
          / {unit?.name ?? '…'}
          {current && (
            <>
              {' '}
              · rule v{current.version} in force since {formatDate(current.effectiveFrom)}
            </>
          )}
        </p>

        <section className="flex flex-col gap-4 rounded-xl bg-white p-4 shadow-[0_0_35px_0_rgb(0_0_0/0.04)] md:p-5">
          <div role="tablist" className="flex gap-1 border-b border-gray-200">
            {TABS.map((t) => (
              <button
                key={t}
                role="tab"
                type="button"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={clsx(
                  '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition',
                  tab === t ? 'border-accent text-accent' : 'border-transparent text-gray-600 hover:text-gray-900',
                )}
              >
                {t}
              </button>
            ))}
          </div>

          {message && (
            <p
              className={clsx(
                'rounded-md border px-3 py-2 text-sm',
                message.tone === 'ok' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-300 bg-red-50 text-red-600',
              )}
            >
              {message.text}
            </p>
          )}

          {tab === 'Days' && days && (
            <>
              {outstanding > 0 ? (
                <div className="flex flex-col gap-3 rounded-xl border border-warning-200 bg-warning-25 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-warning-900">
                    <span className="font-semibold">
                      {outstanding} {outstanding === 1 ? 'day needs' : 'days need'} allocating
                    </span>{' '}
                    — {formatMoney(days.outstanding.total, { decimals: false })} of income, oldest{' '}
                    {days.outstanding.oldest ? formatDate(days.outstanding.oldest) : '—'}
                    {days.outstanding.changed > 0 && `, including ${days.outstanding.changed} whose income changed after allocation`}.
                  </p>
                  {canRun && (
                    <Button onClick={allocateAll} disabled={Boolean(busy)} className="shrink-0">
                      {busy === 'all' ? 'Allocating…' : 'Allocate all up to yesterday'}
                    </Button>
                  )}
                </div>
              ) : days.firstRuleDate ? (
                <p className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                  Every day up to yesterday is allocated.
                </p>
              ) : (
                <p className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                  {unit?.name} has no approved allocation rule, so its income isn&apos;t being earmarked. Set one up under “Rule
                  &amp; history”.
                </p>
              )}

              <div className="flex flex-wrap items-end gap-3">
                <Input label="From" type="date" value={from} max={to} wrapperClassName="w-44" onChange={(e) => setFrom(e.target.value)} />
                <Input label="To" type="date" value={to} min={from} max={todayIso()} wrapperClassName="w-44" onChange={(e) => setTo(e.target.value)} />
              </div>

              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full min-w-180 text-left text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-900">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Date</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Income</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Allocated</th>
                      <th className="px-4 py-2.5 font-semibold">Status</th>
                      <th className="px-4 py-2.5 font-semibold">Entry</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {days.rows.map((row) => {
                      const open = expanded === row.date && row.run;
                      const inProgress = row.isToday && row.state !== 'ALLOCATED';
                      return (
                        <Fragment key={row.date}>
                          <tr
                            className={clsx(
                              'border-t border-gray-100',
                              row.run && 'cursor-pointer hover:bg-gray-50',
                              row.state === 'NO_INCOME' && 'text-gray-400',
                            )}
                            onClick={() => row.run && setExpanded(open ? null : row.date)}
                          >
                            <td className="whitespace-nowrap px-4 py-2.5">
                              {formatDate(row.date)}
                              {row.isToday && <span className="ml-1.5 text-xs text-accent">today</span>}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums">
                              {toPaisa(row.income) === 0n ? '—' : formatMoney(row.income)}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums">
                              {row.run ? formatMoney(row.run.grossIncome) : ''}
                              {row.run && <span className="ml-1 text-xs text-gray-500">v{row.run.ruleVersion}</span>}
                            </td>
                            <td className="px-4 py-2.5">
                              {inProgress && row.state === 'PENDING' ? (
                                <span className="whitespace-nowrap rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                                  Day in progress
                                </span>
                              ) : (
                                <span className={clsx('whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', STATE_TONE[row.state])}>
                                  {STATE_LABEL[row.state]}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5">
                              {row.run?.entryNo && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEntryId(row.run?.journalEntryId ?? null);
                                  }}
                                  className="font-mono text-xs text-accent hover:underline"
                                >
                                  {row.run.entryNo}
                                </button>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                              {canRun && (row.state === 'PENDING' || row.state === 'CHANGED') && (
                                <Button
                                  size="sm"
                                  variant={inProgress ? 'secondary' : 'primary'}
                                  disabled={Boolean(busy)}
                                  onClick={() => allocate(row.date)}
                                  title={inProgress ? 'The day isn’t over — if more income comes in, re-run it.' : undefined}
                                >
                                  {busy === row.date ? 'Working…' : row.state === 'CHANGED' ? 'Re-run' : inProgress ? 'Allocate now' : 'Allocate'}
                                </Button>
                              )}
                              {canRun && row.state === 'ALLOCATED' && row.run && (
                                <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => row.run && undo(row.run.id, row.date)}>
                                  {busy === row.run.id ? 'Undoing…' : 'Undo'}
                                </Button>
                              )}
                            </td>
                          </tr>
                          {open && row.run && (
                            <tr className="border-t border-gray-100 bg-gray-50/70">
                              <td colSpan={6} className="px-4 py-3">
                                <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
                                  {row.run.breakdown.map((b, i) => (
                                    <div key={`${b.accountId}-${i}`} className="flex items-center justify-between gap-3 text-sm">
                                      <Link href={`/accounts/${b.accountId}`} className="min-w-0 truncate text-gray-900 hover:text-accent">
                                        {b.label}
                                        <span className="ml-1 text-xs text-gray-500">
                                          · {b.tranche} · {b.percentOfIncome}%
                                        </span>
                                      </Link>
                                      <span className="shrink-0 tabular-nums">{formatMoney(b.amount)}</span>
                                    </div>
                                  ))}
                                </div>
                                {row.state === 'CHANGED' && (
                                  <p className="mt-2 text-xs text-red-600">
                                    Allocated on {formatMoney(row.run.grossIncome)}; the day now shows {formatMoney(row.income)}. Re-running
                                    reverses this split and posts a new one.
                                  </p>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {tab === 'Reserves' && reserves && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Tile label="Money on hand" value={reserves.totals.moneyOnHand} hint="Cash, bank and wallet" />
                <Tile label="Earmarked" value={reserves.totals.earmarked} hint="Held in reserves below" />
                <Tile
                  label="Not yet earmarked"
                  value={reserves.totals.unearmarked}
                  hint={
                    toPaisa(reserves.totals.unearmarked) < 0n
                      ? 'More is earmarked than is actually held — spending has run ahead of the reserves.'
                      : 'Money on hand no allocation has claimed yet'
                  }
                  danger={toPaisa(reserves.totals.unearmarked) < 0n}
                />
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                {isAccountant && (
                  <Button variant="secondary" onClick={() => setTransferOpen(true)}>
                    Move between reserves
                  </Button>
                )}
                {isAccountant && (
                  <Button variant="secondary" onClick={() => setOpeningOpen(true)}>
                    {reserves.openingReserves ? 'Correct opening reserves' : 'Set opening reserves'}
                  </Button>
                )}
              </div>

              {(['BUCKET', 'PARTNER'] as const).map((kind) => {
                const list = reserves.accounts.filter((a) => a.kind === kind);
                if (!list.length) return null;
                return (
                  <div key={kind} className="overflow-hidden rounded-xl border border-gray-200">
                    <p className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {kind === 'BUCKET' ? 'Reserves' : 'Partner profit reserves'}
                    </p>
                    <table className="w-full text-left text-sm">
                      <tbody>
                        {list.map((a) => (
                          <tr key={a.id} className={clsx('border-t border-gray-100 first:border-t-0', !a.isActive && 'opacity-50')}>
                            <td className="px-4 py-2.5">
                              <Link href={`/accounts/${a.id}`} className="font-medium text-gray-900 hover:text-accent">
                                {a.name}
                              </Link>
                              <span className="ml-2 font-mono text-xs text-gray-500">{a.code}</span>
                            </td>
                            <td
                              className={clsx(
                                'px-4 py-2.5 text-right font-medium tabular-nums',
                                toPaisa(a.balance) < 0n ? 'text-danger' : 'text-gray-900',
                              )}
                            >
                              {formatMoney(a.balance)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
              <p className="text-xs text-gray-500">
                Reserves fill from the daily allocation and empty when money is paid “out of” them (a money-out entry), drawn by a
                partner, or moved to another reserve. Every movement is in each reserve&apos;s ledger.
                {reserves.openingReserves && (
                  <>
                    {' '}
                    Opening balances: {reserves.openingReserves.displayNo}, {formatDate(reserves.openingReserves.entryDate)}.
                  </>
                )}
              </p>
            </>
          )}

          {tab === 'Rule & history' && (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-lg font-bold text-black">{current ? `Rule in force — v${current.version}` : 'No rule in force'}</p>
                  <p className="text-sm text-gray-600">
                    {current
                      ? `${effectiveRange(current)}. A change is a new version from a later date; days already allocated keep their rule.`
                      : 'Until a rule is approved, this unit’s income is recorded but not earmarked.'}
                  </p>
                </div>
                {canPropose && unit && (
                  <Button
                    className="shrink-0 rounded-full"
                    onClick={() => setEditor({ open: true, base: upcoming[upcoming.length - 1] ?? current, mode: 'new' })}
                  >
                    {current ? (canApprove ? 'Change the rule' : 'Propose a change') : 'Set up a rule'}
                  </Button>
                )}
              </div>

              {current && <RuleWaterfall tranches={current.tranches} />}

              {upcoming.map((r) => (
                <p key={r.id} className="rounded-xl border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent">
                  v{r.version} is approved and takes over on {formatDate(r.effectiveFrom)}.{' '}
                  <button type="button" className="font-medium underline" onClick={() => setReviewing(r)}>
                    View it
                  </button>
                </p>
              ))}

              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full min-w-160 text-left text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-900">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Version</th>
                      <th className="px-4 py-2.5 font-semibold">Applies</th>
                      <th className="px-4 py-2.5 font-semibold">Status</th>
                      <th className="px-4 py-2.5 font-semibold">Why</th>
                      <th className="px-4 py-2.5 font-semibold">By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((r) => (
                      <tr key={r.id} className="cursor-pointer border-t border-gray-100 hover:bg-gray-50" onClick={() => setReviewing(r)}>
                        <td className="px-4 py-2.5 font-medium text-gray-900">v{r.version}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-gray-700">{effectiveRange(r)}</td>
                        <td className="px-4 py-2.5">
                          <StatusChip rule={r} />
                        </td>
                        <td className="max-w-80 truncate px-4 py-2.5 text-gray-600" title={r.note ?? ''}>
                          {r.note ?? '—'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-xs text-gray-600">
                          {r.createdByName ?? 'Seed'}
                          {r.reviewedByName ? ` → ${r.reviewedByName}` : ''}
                        </td>
                      </tr>
                    ))}
                    {!rules.length && (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-500">
                          No versions yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>

      {unit && (
        <RuleEditorPanel
          isOpen={editor.open}
          onClose={() => setEditor((e) => ({ ...e, open: false }))}
          unit={unit}
          base={editor.base}
          mode={editor.mode}
          earliestStart={earliestStart}
          canApprove={canApprove}
          onSaved={(rule) => {
            setEditor((e) => ({ ...e, open: false }));
            setMessage({
              tone: 'ok',
              text:
                rule.status === 'APPROVED'
                  ? `Version ${rule.version} approved — it applies from ${formatDate(rule.effectiveFrom)}.`
                  : rule.status === 'PENDING_APPROVAL'
                    ? `Version ${rule.version} sent to a Partner for approval.`
                    : `Draft v${rule.version} saved.`,
            });
            setTab('Rule & history');
            void refresh();
          }}
        />
      )}

      <RuleReviewModal
        rule={reviewing}
        onClose={() => setReviewing(null)}
        currentUserId={user?.id ?? ''}
        canApprove={canApprove}
        canPropose={canPropose}
        onChanged={() => {
          setReviewing(null);
          void refresh();
        }}
        onEditDraft={(r) => {
          setReviewing(null);
          setEditor({ open: true, base: r, mode: 'edit' });
        }}
      />

      {reserves && (
        <OpeningReservesModal
          reserves={reserves}
          isOpen={openingOpen}
          onClose={() => setOpeningOpen(false)}
          onSaved={(r) => {
            setOpeningOpen(false);
            setReserves(r);
            setMessage({ tone: 'ok', text: 'Opening reserves posted.' });
            void refresh();
          }}
        />
      )}

      <NewEntryPanel
        isOpen={transferOpen}
        onClose={() => setTransferOpen(false)}
        onPosted={(entry) => {
          setTransferOpen(false);
          setMessage({ tone: 'ok', text: `${entry.displayNo} posted.` });
          void refresh();
        }}
        units={units}
        defaultUnitId={unitId}
        initialKind="RESERVE_TRANSFER"
        isAccountant={isAccountant}
      />

      <EntryDetailModal
        entryId={entryId}
        onClose={() => setEntryId(null)}
        onOpenEntry={setEntryId}
        onChanged={() => void refresh()}
        canReverse={hasPermission('transactions.reverse')}
      />
    </div>
  );
}

function Tile({ label, value, hint, danger }: { label: string; value: string; hint: string; danger?: boolean }) {
  return (
    <div className={clsx('rounded-xl border p-3', danger ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50')}>
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className={clsx('text-xl font-semibold tabular-nums', danger ? 'text-danger' : 'text-gray-900')}>{formatMoney(value)}</p>
      <p className="text-xs text-gray-600">{hint}</p>
    </div>
  );
}
