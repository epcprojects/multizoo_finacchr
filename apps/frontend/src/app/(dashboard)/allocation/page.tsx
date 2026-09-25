'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { useUser } from '../../../components/layout/UserProvider';
import Button from '../../../components/ui/Button';
import PageBanner from '../../../components/ui/PageBanner';
import { EditIcon, PlusIcon } from '../../../components/ui/icons';
import { TrancheBar } from '../../../components/allocation/RuleWaterfall';
import RuleReviewModal, { effectiveRange } from '../../../components/allocation/RuleReviewModal';
import PartnerFormModal from '../../../components/allocation/PartnerFormModal';
import {
  getAllocationOverview,
  listAllocationRules,
  listPartners,
  type AllocationOverview,
  type AllocationRuleRecord,
  type PartnerRecord,
} from '../../../lib/api/allocation';
import { formatDate, formatMoney, toPaisa } from '../../../lib/money';

/**
 * Allocation — the daily waterfall across the group: which rule each unit
 * runs, what's waiting to be allocated or approved, how much of the money
 * on hand is already earmarked, and the partners who share in it.
 */
export default function AllocationPage() {
  const { user, hasPermission } = useUser();
  const canApprove = hasPermission('rules.edit_allocation');
  const canPropose = hasPermission('rules.propose_allocation') || canApprove;

  const [overview, setOverview] = useState<AllocationOverview | null>(null);
  const [proposals, setProposals] = useState<AllocationRuleRecord[]>([]);
  const [partners, setPartners] = useState<PartnerRecord[]>([]);
  const [reviewing, setReviewing] = useState<AllocationRuleRecord | null>(null);
  const [partnerForm, setPartnerForm] = useState<{ open: boolean; partner: PartnerRecord | null }>({ open: false, partner: null });

  const refresh = useCallback(async () => {
    const [o, pending, drafts, p] = await Promise.all([
      getAllocationOverview(),
      listAllocationRules({ status: 'PENDING_APPROVAL' }),
      canPropose ? listAllocationRules({ status: 'DRAFT' }) : Promise.resolve([]),
      listPartners(),
    ]);
    setOverview(o);
    setProposals([...pending, ...drafts.filter((d) => d.createdBy === user?.id)]);
    setPartners(p);
  }, [canPropose, user?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const units = overview?.units ?? [];
  const outstanding = units.reduce((s, u) => s + u.pendingDays + u.changedDays, 0);
  const unearmarked = units.reduce((s, u) => s + toPaisa(u.unearmarked), 0n);

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <div className="shrink-0">
          <PageBanner
            imageSrc="/allocation-icon.svg"
            imageAlt="Income allocation"
            title="Income Allocation"
            stats={[
              { title: 'Units with a rule', count: units.filter((u) => u.rule).length, color: '#A78BFA' },
              { title: 'Days to allocate', count: outstanding, color: outstanding ? '#F5A623' : '#34D399' },
              { title: 'Awaiting approval', count: overview?.pendingApprovals ?? 0, color: '#60A5FA' },
              { title: 'Not yet earmarked', count: formatMoney(unearmarked, { decimals: false }), color: '#34D399' },
            ]}
          />
        </div>

        <p className="px-1 text-sm text-gray-600">
          Each day&apos;s income is split by the unit&apos;s rule into reserves and partner shares — the Formula sheet, as data.
          Earmarking never moves cash: a reserve is money on hand set aside for a purpose.
        </p>

        {proposals.length > 0 && (
          <section className="rounded-xl bg-white p-4 shadow-[0_0_35px_0_rgb(0_0_0/0.04)] md:p-5">
            <p className="text-lg font-bold text-black">Rule changes in progress</p>
            <p className="mb-3 text-sm text-gray-600">
              {canApprove
                ? 'Proposals waiting for a Partner’s approval. Each shows what it would have done to the last month of income.'
                : 'Your drafts, and proposals waiting for a Partner.'}
            </p>
            <div className="flex flex-col divide-y divide-gray-100 rounded-xl border border-gray-200">
              {proposals.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setReviewing(r)}
                  className="flex flex-col gap-1 px-4 py-3 text-left hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">
                      {r.businessUnit?.name} · v{r.version}{' '}
                      <span className="ml-1 font-normal text-gray-600">{effectiveRange(r)}</span>
                    </p>
                    <p className="truncate text-xs text-gray-600">
                      {r.status === 'DRAFT' ? 'Draft' : `Proposed by ${r.submittedByName ?? r.createdByName ?? '—'}`}
                      {r.note ? ` — ${r.note}` : ''}
                    </p>
                  </div>
                  <span
                    className={clsx(
                      'shrink-0 rounded-full px-3 py-1 text-xs font-medium',
                      r.status === 'PENDING_APPROVAL' && canApprove ? 'bg-accent text-white' : 'bg-gray-100 text-gray-700',
                    )}
                  >
                    {r.status === 'PENDING_APPROVAL' ? (canApprove ? 'Review' : 'Awaiting approval') : 'Draft'}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-xl bg-white p-4 shadow-[0_0_35px_0_rgb(0_0_0/0.04)] md:p-5">
          <p className="mb-3 text-lg font-bold text-black">Business units</p>
          {!overview ? (
            <p className="py-8 text-center text-sm text-gray-500">Loading…</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {units.map((u) => {
                const due = u.pendingDays + u.changedDays;
                const unearmarkedP = toPaisa(u.unearmarked);
                return (
                  <Link
                    key={u.id}
                    href={`/allocation/${u.id}`}
                    className={clsx(
                      'flex flex-col gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 transition hover:border-accent/40 hover:bg-white',
                      !u.isActive && 'opacity-60',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold text-gray-950">{u.name}</p>
                        <p className="text-xs text-gray-600">
                          <span className="font-mono">{u.code}</span>
                          {u.rule ? ` · rule v${u.rule.version} since ${formatDate(u.rule.effectiveFrom)}` : ''}
                        </p>
                      </div>
                      {due > 0 ? (
                        <span className="shrink-0 rounded-full bg-warning-100 px-2.5 py-0.5 text-xs font-medium text-warning-800">
                          {due} {due === 1 ? 'day' : 'days'} to allocate
                        </span>
                      ) : u.rule ? (
                        <span className="shrink-0 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
                          Up to date
                        </span>
                      ) : null}
                    </div>

                    {u.rule ? (
                      <div>
                        <TrancheBar tranches={u.rule.tranches} />
                        <p className="mt-1.5 text-xs text-gray-600">
                          {u.rule.tranches.map((t) => `${t.name} ${t.share}%`).join(' · ')}
                        </p>
                      </div>
                    ) : (
                      <p className="rounded-lg border border-dashed border-gray-300 bg-white px-3 py-2 text-xs text-gray-600">
                        {u.isHolding
                          ? 'Holding company — no daily waterfall.'
                          : 'No allocation rule yet — its income isn’t being earmarked.'}
                      </p>
                    )}
                    {u.upcomingRule && (
                      <p className="text-xs text-accent">
                        v{u.upcomingRule.version} takes over on {formatDate(u.upcomingRule.effectiveFrom)}
                      </p>
                    )}

                    <div className="grid grid-cols-3 gap-2 rounded-xl bg-white p-3">
                      <Figure label="Today so far" value={formatMoney(u.today.income, { decimals: false })} />
                      <Figure label="Earmarked" value={formatMoney(u.earmarked, { decimals: false })} />
                      <Figure
                        label="Not earmarked"
                        value={formatMoney(u.unearmarked, { decimals: false })}
                        tone={unearmarkedP < 0n ? 'danger' : undefined}
                      />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-xl bg-white p-4 shadow-[0_0_35px_0_rgb(0_0_0/0.04)] md:p-5">
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-lg font-bold text-black">Partners</p>
              <p className="text-sm text-gray-600">
                Each partner&apos;s share of a unit&apos;s income is earmarked in their profit reserve there; cash they take is a
                drawing against their capital &amp; current account.
              </p>
            </div>
            {canPropose && (
              <Button
                className="shrink-0 rounded-full"
                icon={<PlusIcon width="20" height="20" />}
                onClick={() => setPartnerForm({ open: true, partner: null })}
              >
                Add Partner
              </Button>
            )}
          </div>
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full min-w-180 text-left text-sm">
              <thead className="bg-gray-50 text-xs text-gray-900">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Partner</th>
                  <th className="px-4 py-2.5 font-semibold">Shares in</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Profit reserves</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Capital &amp; current</th>
                  <th className="px-2 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {partners.map((p) => (
                  <tr key={p.id} className={clsx('border-t border-gray-100', !p.isActive && 'opacity-50')}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">
                        {p.name} <span className="font-mono text-xs text-gray-500">{p.shortName}</span>
                      </p>
                      <p className="text-xs text-gray-500">{p.userName ? `Login: ${p.userName}` : 'No login'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {p.shareIn.length ? (
                          p.shareIn.map((s) => (
                            <span
                              key={`${s.unitCode}-${s.pending}`}
                              className={clsx(
                                'rounded-full border px-2 py-0.5 text-xs',
                                s.pending ? 'border-warning-200 bg-warning-25 text-warning-800' : 'border-gray-200 bg-white text-gray-700',
                              )}
                              title={s.pending ? 'In a version awaiting approval' : 'In the rule in force'}
                            >
                              {s.unitCode}
                              {s.pending ? ' (pending)' : ''}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span title={p.profitReserves.map((r) => `${r.businessUnit?.code}: ${formatMoney(r.balance)}`).join('\n')}>
                        {formatMoney(p.profitReservesTotal)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {p.equityAccount ? (
                        <Link href={`/accounts/${p.equityAccount.id}`} className="hover:text-accent">
                          {formatMoney(p.equityAccount.balance)}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-2 py-3 text-right">
                      {canPropose && (
                        <button
                          type="button"
                          aria-label={`Edit ${p.name}`}
                          onClick={() => setPartnerForm({ open: true, partner: p })}
                          className="rounded-md p-1.5 hover:bg-gray-100"
                        >
                          <EditIcon />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

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
      />

      <PartnerFormModal
        isOpen={partnerForm.open}
        partner={partnerForm.partner}
        canLinkUser={hasPermission('users.invite')}
        canLinkEmployee={hasPermission('employee.manage') || hasPermission('employee.view')}
        onClose={() => setPartnerForm({ open: false, partner: null })}
        onSaved={() => {
          setPartnerForm({ open: false, partner: null });
          void refresh();
        }}
      />
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className={clsx('truncate text-sm font-semibold tabular-nums', tone === 'danger' ? 'text-danger' : 'text-gray-900')}>
        {value}
      </p>
    </div>
  );
}
