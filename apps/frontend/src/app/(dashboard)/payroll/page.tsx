'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser } from '../../../components/layout/UserProvider';
import Button from '../../../components/ui/Button';
import PageBanner from '../../../components/ui/PageBanner';
import Select from '../../../components/ui/Select';
import ConfirmModal from '../../../components/ui/ConfirmModal';
import { PlusIcon } from '../../../components/ui/icons';
import { MonthPicker, NoticeLine, Pill, Section, Tabs, type Notice } from '../../../components/hr/ui';
import AdvanceModal from '../../../components/payroll/AdvanceModal';
import BonusPoolModal from '../../../components/payroll/BonusPoolModal';
import { currentMonth, formatMonth, listEmployees, type EmployeeRecord } from '../../../lib/api/hr';
import { listBusinessUnits, type BusinessUnitRecord } from '../../../lib/api/ledger';
import {
  RUN_STATUS,
  cancelAdvance,
  createPayrollRun,
  createSettlement,
  getPayrollOverview,
  getPayrollStats,
  listAdvances,
  listAwaitingSettlement,
  listBonusPools,
  listPayrollPolicies,
  listSettlements,
  type AdvanceRecord,
  type AdvanceStatus,
  type AwaitingSettlement,
  type BonusPoolRow,
  type PayrollOverview,
  type PayrollStats,
  type SettlementRow,
} from '../../../lib/api/payroll';
import { errorMessage, formatDate, formatMoney, todayIso } from '../../../lib/money';

const TABS = ['Salary runs', 'Advances', 'Commission pools', 'Settlements'] as const;
type Tab = (typeof TABS)[number];

const th = 'px-4 py-2.5 font-semibold';
const td = 'px-4 py-2.5';

/**
 * Payroll (architecture plan Part 07 §05–06, modules M6, M7, M16): each
 * unit's month of pay, the advances it recovers, the commission pools it
 * pays, and the settlements owed to people who leave.
 */
export default function PayrollPage() {
  const router = useRouter();
  const { hasPermission } = useUser();
  const canRun = hasPermission('payroll.run');
  const thisMonth = currentMonth(todayIso());

  const [tab, setTab] = useState<Tab>('Salary runs');
  const [month, setMonth] = useState(() => {
    // Early in a month, last month's payroll is the one being worked on.
    const [y, m, d] = todayIso().split('-').map(Number);
    return d <= 10 ? new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7) : thisMonth;
  });
  const [stats, setStats] = useState<PayrollStats | null>(null);
  const [overview, setOverview] = useState<PayrollOverview | null>(null);
  const [advances, setAdvances] = useState<AdvanceRecord[] | null>(null);
  const [advanceStatus, setAdvanceStatus] = useState<AdvanceStatus | ''>('OUTSTANDING');
  const [pools, setPools] = useState<BonusPoolRow[] | null>(null);
  const [settlements, setSettlements] = useState<SettlementRow[] | null>(null);
  const [awaiting, setAwaiting] = useState<AwaitingSettlement[]>([]);
  const [units, setUnits] = useState<BusinessUnitRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [commissionPct, setCommissionPct] = useState<string | null>(null);
  const [modal, setModal] = useState<'advance' | 'pool' | null>(null);
  const [cancelling, setCancelling] = useState<AdvanceRecord | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const refresh = useCallback(async () => {
    try {
      void getPayrollStats().then(setStats);
      if (tab === 'Salary runs') setOverview(await getPayrollOverview(month));
      if (tab === 'Advances') setAdvances(await listAdvances({ status: advanceStatus || undefined }));
      if (tab === 'Commission pools') setPools(await listBonusPools());
      if (tab === 'Settlements') {
        const [s, a] = await Promise.all([listSettlements(), listAwaitingSettlement()]);
        setSettlements(s);
        setAwaiting(a);
      }
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, 'Could not load payroll.') });
    }
  }, [tab, month, advanceStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void listBusinessUnits().then((u) => setUnits(u.filter((x) => x.isActive)));
    void listEmployees({ status: 'ACTIVE' }).then(setEmployees);
    void listAwaitingSettlement().then(setAwaiting).catch(() => undefined);
    void listPayrollPolicies().then((ps) => setCommissionPct(ps.find((p) => p.isCurrent)?.commissionPct ?? null)).catch(() => undefined);
  }, []);

  async function startRun(unitId: string) {
    setBusy(unitId);
    try {
      const run = await createPayrollRun(unitId, month);
      router.push(`/payroll/runs/${run.id}`);
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, 'Could not start the run.') });
      setBusy(null);
    }
  }

  async function prepareSettlement(employeeId: string) {
    setBusy(employeeId);
    try {
      const s = await createSettlement(employeeId);
      router.push(`/payroll/settlements/${s.id}`);
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, 'Could not start the settlement.') });
      setBusy(null);
    }
  }

  const payUnits = units.filter((u) => overview?.units.some((o) => o.unit.id === u.id));

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <div className="shrink-0">
          <PageBanner
            imageSrc="/payroll-icon.svg"
            imageAlt="Payroll"
            title="Payroll"
            stats={[
              { title: 'Net pay not yet paid', count: stats ? formatMoney(stats.unpaidNet, { decimals: false }) : '…', color: stats && stats.unpaidCount ? '#F5A623' : '#34D399' },
              {
                title: stats?.lastMonth ? `Cost of ${formatMonth(stats.lastMonth.month)}` : 'Last payroll cost',
                count: stats?.lastMonth ? formatMoney(stats.lastMonth.cost, { decimals: false }) : '—',
                color: '#60A5FA',
              },
              { title: 'Advances outstanding', count: stats ? formatMoney(stats.advancesOutstanding, { decimals: false }) : '…', color: '#A78BFA' },
            ]}
          />
        </div>

        <NoticeLine notice={notice} onClose={() => setNotice(null)} />

        <Section
          title={<Tabs tabs={TABS} value={tab} onChange={setTab} counts={{ Settlements: awaiting.length }} />}
          actions={
            canRun && tab === 'Advances' ? (
              <Button className="rounded-full" icon={<PlusIcon width="20" height="20" />} onClick={() => setModal('advance')}>
                New advance
              </Button>
            ) : canRun && tab === 'Commission pools' ? (
              <Button className="rounded-full" icon={<PlusIcon width="20" height="20" />} onClick={() => setModal('pool')}>
                New pool
              </Button>
            ) : null
          }
        >
          {tab === 'Salary runs' && (
            <>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <MonthPicker value={month} onChange={setMonth} max={thisMonth} />
                <p className="text-sm text-gray-600">
                  One run per unit per month — the salary sheet’s blocks. A draft always reflects the latest attendance, fines and advances.
                </p>
              </div>
              {!overview ? (
                <p className="py-8 text-center text-sm text-gray-500">Loading…</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full min-w-180 text-left text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-900">
                      <tr>
                        <th className={th}>Unit</th>
                        <th className={`${th} text-right`}>People</th>
                        <th className={th}>{formatMonth(month)}</th>
                        <th className={`${th} text-right`}>Net pay</th>
                        <th className={`${th} text-right`}>Still to pay</th>
                        <th className={`${th} text-right`} />
                      </tr>
                    </thead>
                    <tbody>
                      {overview.units.map(({ unit, run, headcount }) => (
                        <tr key={unit.id} className="border-t border-gray-100">
                          <td className={td}>
                            <p className="font-medium text-gray-900">{unit.name}</p>
                            <p className="text-xs text-gray-500">{unit.code}</p>
                          </td>
                          <td className={`${td} text-right tabular-nums`}>{headcount}</td>
                          <td className={td}>
                            {run ? (
                              <span className="flex flex-wrap items-center gap-2">
                                <Pill tone={RUN_STATUS[run.status].tone}>{RUN_STATUS[run.status].label}</Pill>
                                {run.status === 'DRAFT' && run.issues > 0 && <Pill tone="amber">{run.issues} to check</Pill>}
                              </span>
                            ) : (
                              <span className="text-gray-400">Not started</span>
                            )}
                          </td>
                          <td className={`${td} text-right tabular-nums`}>{run ? formatMoney(run.net) : '—'}</td>
                          <td className={`${td} text-right tabular-nums`}>
                            {run && run.status !== 'DRAFT' ? (
                              run.unpaid === '0.00' ? <span className="text-gray-400">—</span> : <span className="font-medium text-warning-800">{formatMoney(run.unpaid)}</span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className={`${td} text-right`}>
                            {run ? (
                              <Link href={`/payroll/runs/${run.id}`}>
                                <Button size="sm" variant="secondary">
                                  Open
                                </Button>
                              </Link>
                            ) : canRun && headcount > 0 ? (
                              <Button size="sm" disabled={busy === unit.id} onClick={() => void startRun(unit.id)}>
                                {busy === unit.id ? 'Starting…' : 'Start draft'}
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {tab === 'Advances' && (
            <>
              <div className="w-full md:w-56">
                <Select
                  value={advanceStatus}
                  onChange={(v) => setAdvanceStatus(v as AdvanceStatus | '')}
                  options={[
                    { label: 'Outstanding', value: 'OUTSTANDING' },
                    { label: 'Recovered', value: 'RECOVERED' },
                    { label: 'Cancelled', value: 'CANCELLED' },
                    { label: 'Written off', value: 'WRITTEN_OFF' },
                    { label: 'Every advance', value: '' },
                  ]}
                />
              </div>
              {!advances ? (
                <p className="py-8 text-center text-sm text-gray-500">Loading…</p>
              ) : !advances.length ? (
                <p className="py-8 text-center text-sm text-gray-500">No advances here.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full min-w-200 text-left text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-900">
                      <tr>
                        <th className={th}>Employee</th>
                        <th className={th}>Paid</th>
                        <th className={`${th} text-right`}>Amount</th>
                        <th className={`${th} text-right`}>Per month</th>
                        <th className={`${th} text-right`}>Recovered</th>
                        <th className={`${th} text-right`}>Outstanding</th>
                        <th className={th} />
                      </tr>
                    </thead>
                    <tbody>
                      {advances.map((a) => (
                        <tr key={a.id} className="border-t border-gray-100 align-top">
                          <td className={td}>
                            <Link href={`/employees/${a.employee.id}`} className="font-medium text-gray-900 hover:text-accent">
                              {a.employee.fullName}
                            </Link>
                            <p className="text-xs text-gray-500">
                              {a.businessUnit.code} · {a.reason}
                            </p>
                          </td>
                          <td className={td}>
                            {formatDate(a.issueDate)}
                            {a.entry && <p className="text-xs text-gray-500">{a.entry.displayNo}</p>}
                          </td>
                          <td className={`${td} text-right tabular-nums`}>{formatMoney(a.amount)}</td>
                          <td className={`${td} text-right tabular-nums`}>{a.installment ? formatMoney(a.installment) : <span className="text-gray-400">All at once</span>}</td>
                          <td className={`${td} text-right tabular-nums`} title={a.recoveries.map((r) => `${formatMonth(r.month)}: ${formatMoney(r.amount)}`).join('\n')}>
                            {formatMoney(a.recovered)}
                            {a.recoveries.length > 0 && <p className="text-xs text-gray-500">{a.recoveries.length} {a.recoveries.length === 1 ? 'recovery' : 'recoveries'}</p>}
                          </td>
                          <td className={`${td} text-right font-semibold tabular-nums`}>
                            {a.status === 'CANCELLED' ? (
                              <Pill>Cancelled</Pill>
                            ) : a.status === 'RECOVERED' ? (
                              <Pill tone="green">Recovered</Pill>
                            ) : a.status === 'WRITTEN_OFF' ? (
                              <Pill tone="red" title={a.writeOffReason ?? undefined}>
                                {formatMoney(a.writtenOff)} written off
                              </Pill>
                            ) : (
                              formatMoney(a.outstanding)
                            )}
                          </td>
                          <td className={`${td} text-right`}>
                            {canRun && a.status === 'OUTSTANDING' && a.recoveries.length === 0 && (
                              <Button size="sm" variant="secondary" onClick={() => setCancelling(a)}>
                                Cancel
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {tab === 'Commission pools' && (
            <>
              <p className="text-sm text-gray-600">
                The Bonus Calculator: qualifying sales × {commissionPct ?? '…'}% (rounded down), shared by bonus tier. Approved shares are added to
                each person’s Bonus / Incentive for the pool’s month.
              </p>
              {!pools ? (
                <p className="py-8 text-center text-sm text-gray-500">Loading…</p>
              ) : !pools.length ? (
                <p className="py-8 text-center text-sm text-gray-500">No commission pools yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full min-w-180 text-left text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-900">
                      <tr>
                        <th className={th}>Pool</th>
                        <th className={th}>Paid with</th>
                        <th className={`${th} text-right`}>Sales</th>
                        <th className={`${th} text-right`}>Pool</th>
                        <th className={`${th} text-right`}>Not shared</th>
                        <th className={th}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pools.map((p) => (
                        <tr key={p.id} className="border-t border-gray-100">
                          <td className={td}>
                            <Link href={`/payroll/bonus/${p.id}`} className="font-medium text-gray-900 hover:text-accent">
                              {p.title}
                            </Link>
                            <p className="text-xs text-gray-500">
                              {p.businessUnit.code} · {p.members} {p.members === 1 ? 'person' : 'people'}
                            </p>
                          </td>
                          <td className={td}>{formatMonth(p.month)}</td>
                          <td className={`${td} text-right tabular-nums`}>{formatMoney(p.qualifyingSales, { decimals: false })}</td>
                          <td className={`${td} text-right font-medium tabular-nums`}>{formatMoney(p.pool, { decimals: false })}</td>
                          <td className={`${td} text-right tabular-nums`}>
                            {p.undistributed === '0.00' ? <span className="text-gray-300">—</span> : formatMoney(p.undistributed)}
                          </td>
                          <td className={td}>
                            <Pill tone={p.status === 'APPROVED' ? 'green' : 'amber'}>{p.status === 'APPROVED' ? 'Approved' : 'Draft'}</Pill>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {tab === 'Settlements' && (
            <>
              {awaiting.length > 0 && (
                <div className="rounded-xl border border-warning-200 bg-warning-25 p-3">
                  <p className="mb-2 text-sm font-semibold text-warning-900">Left, with no settlement yet</p>
                  <div className="flex flex-col divide-y divide-warning-100">
                    {awaiting.map((a) => (
                      <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <div>
                          <Link href={`/employees/${a.id}`} className="text-sm font-medium text-gray-900 hover:text-accent">
                            {a.fullName}
                          </Link>
                          <p className="text-xs text-gray-600">
                            {a.designation} · {a.businessUnit.code} · last day {a.exitDate ? formatDate(a.exitDate) : '—'}
                            {a.exitReason ? ` · ${a.exitReason}` : ''}
                          </p>
                        </div>
                        {canRun && (
                          <Button size="sm" disabled={busy === a.id} onClick={() => void prepareSettlement(a.id)}>
                            {busy === a.id ? 'Preparing…' : 'Prepare settlement'}
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!settlements ? (
                <p className="py-8 text-center text-sm text-gray-500">Loading…</p>
              ) : !settlements.length ? (
                <p className="py-8 text-center text-sm text-gray-500">No settlements yet. Record an exit on the employee’s page, then prepare it here.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full min-w-160 text-left text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-900">
                      <tr>
                        <th className={th}>Employee</th>
                        <th className={th}>Last day</th>
                        <th className={`${th} text-right`}>Net settlement</th>
                        <th className={th}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {settlements.map((s) => (
                        <tr key={s.id} className="border-t border-gray-100">
                          <td className={td}>
                            <Link href={`/payroll/settlements/${s.id}`} className="font-medium text-gray-900 hover:text-accent">
                              {s.employee.fullName}
                            </Link>
                            <p className="text-xs text-gray-500">
                              {s.employee.designation} · {s.businessUnit.code}
                            </p>
                          </td>
                          <td className={td}>{s.exitDate ? formatDate(s.exitDate) : '—'}</td>
                          <td className={`${td} text-right tabular-nums`}>{s.net ? formatMoney(s.net) : <span className="text-gray-400">Draft</span>}</td>
                          <td className={td}>
                            <Pill tone={RUN_STATUS[s.status].tone}>{s.status === 'PAID' ? `Paid ${s.paidOn ? formatDate(s.paidOn) : ''}` : RUN_STATUS[s.status].label}</Pill>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </Section>
      </div>

      <AdvanceModal
        isOpen={modal === 'advance'}
        employees={employees}
        onClose={() => setModal(null)}
        onSaved={() => {
          setModal(null);
          setNotice({ tone: 'ok', text: 'Advance paid — payroll will recover it.' });
          void refresh();
        }}
      />
      <BonusPoolModal
        isOpen={modal === 'pool'}
        units={payUnits.length ? payUnits : units}
        month={month}
        commissionPct={commissionPct}
        onClose={() => setModal(null)}
        onCreated={(p) => router.push(`/payroll/bonus/${p.id}`)}
      />
      <ConfirmModal
        isOpen={Boolean(cancelling)}
        title="Cancel this advance?"
        message={
          cancelling
            ? `${formatMoney(cancelling.amount)} to ${cancelling.employee.fullName} on ${formatDate(cancelling.issueDate)}. The payment is reversed in the ledger — use this only for an advance entered by mistake.`
            : ''
        }
        confirmLabel="Cancel advance"
        variant="danger"
        onClose={() => setCancelling(null)}
        onConfirm={async () => {
          if (!cancelling) return;
          try {
            await cancelAdvance(cancelling.id, 'Entered by mistake');
            setNotice({ tone: 'ok', text: 'Advance cancelled and its payment reversed.' });
          } catch (err) {
            setNotice({ tone: 'error', text: errorMessage(err, 'Could not cancel it.') });
          }
          setCancelling(null);
          void refresh();
        }}
      />
    </div>
  );
}
