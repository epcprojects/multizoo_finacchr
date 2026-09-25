'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { useUser } from '../../../components/layout/UserProvider';
import Button from '../../../components/ui/Button';
import PageBanner from '../../../components/ui/PageBanner';
import Select from '../../../components/ui/Select';
import { PlusIcon } from '../../../components/ui/icons';
import { NoticeLine, Section, Tabs, UnitPicker, type Notice } from '../../../components/hr/ui';
import LeaveRequestModal from '../../../components/hr/LeaveRequestModal';
import LeaveRequestsTable from '../../../components/hr/LeaveRequestsTable';
import {
  EMPLOYMENT_TYPE_LABELS,
  formatDays,
  getAttendanceToday,
  getLeaveBalances,
  listEmployees,
  listLeaveRequests,
  listLeaveTypes,
  type EmployeeRecord,
  type LeaveBalances,
  type LeaveRequestRecord,
  type LeaveRequestStatus,
  type LeaveTypeRecord,
} from '../../../lib/api/hr';
import { listBusinessUnits, type BusinessUnitRecord } from '../../../lib/api/ledger';
import { errorMessage, todayIso } from '../../../lib/money';

const TABS = ['Requests', 'Balances'] as const;
type Tab = (typeof TABS)[number];

/**
 * Leave: the approval queue, every request, and each person's balances.
 * Leave is entered by the Branch Manager (most staff have no login) and
 * approved by them; approval puts it on the attendance register.
 */
export default function LeavePage() {
  const { user, hasPermission } = useUser();
  const canApprove = hasPermission('leave.approve_own_unit');
  const canManage = hasPermission('employee.manage');
  const canEnter = canApprove || canManage;
  const thisYear = Number(todayIso().slice(0, 4));

  const [tab, setTab] = useState<Tab>('Requests');
  const [units, setUnits] = useState<BusinessUnitRecord[]>([]);
  const [unitId, setUnitId] = useState('');
  const [status, setStatus] = useState<LeaveRequestStatus | ''>('');
  const [year, setYear] = useState(thisYear);
  const [pending, setPending] = useState<LeaveRequestRecord[]>([]);
  const [requests, setRequests] = useState<LeaveRequestRecord[] | null>(null);
  const [balances, setBalances] = useState<LeaveBalances | null>(null);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeRecord[]>([]);
  const [onLeaveToday, setOnLeaveToday] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const refresh = useCallback(async () => {
    try {
      const unit = unitId || undefined;
      const [p, r] = await Promise.all([
        listLeaveRequests({ businessUnitId: unit, status: 'PENDING' }),
        listLeaveRequests({ businessUnitId: unit, status: status || undefined, from: `${year}-01-01`, to: `${year}-12-31` }),
      ]);
      setPending(p);
      setRequests(r);
      if (tab === 'Balances') setBalances(await getLeaveBalances({ businessUnitId: unit, year }));
      void getAttendanceToday().then((o) => setOnLeaveToday(o.units.reduce((s, u) => s + u.onLeave, 0)));
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, 'Could not load leave.') });
    }
  }, [unitId, status, year, tab]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void listBusinessUnits().then((u) => setUnits(u.filter((x) => x.isActive)));
    void listLeaveTypes().then(setLeaveTypes);
    void listEmployees({ status: 'ACTIVE' }).then(setEmployees);
  }, []);

  function changed(warnings: string[], text: string) {
    setNotice(warnings.length ? { tone: 'warn', text: <>{text} {warnings.join(' ')}</> } : { tone: 'ok', text });
    void refresh();
  }

  const approvedThisYear = (requests ?? []).filter((r) => r.status === 'APPROVED');
  const actionable = pending.filter((r) => r.employee.userId !== user?.id);

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <div className="shrink-0">
          <PageBanner
            imageSrc="/leave-icon.svg"
            imageAlt="Leave"
            title="Leave"
            stats={[
              { title: 'Awaiting approval', count: pending.length, color: pending.length ? '#F5A623' : '#34D399' },
              { title: 'On leave today', count: onLeaveToday ?? '…', color: '#60A5FA' },
              { title: `Approved in ${year}`, count: approvedThisYear.length, color: '#A78BFA' },
            ]}
          />
        </div>

        <NoticeLine notice={notice} onClose={() => setNotice(null)} />

        {pending.length > 0 && (
          <Section
            title="Waiting for approval"
            subtitle={
              canApprove
                ? 'Each shows its working days; the approval re-checks the balance and the register.'
                : 'A Branch Manager approves leave for their unit.'
            }
          >
            <LeaveRequestsTable
              rows={pending}
              currentUserId={user?.id ?? ''}
              canApprove={canApprove}
              canManage={canManage}
              onChanged={changed}
            />
            {canApprove && actionable.length < pending.length && (
              <p className="text-xs text-gray-500">Your own leave waits for another approver.</p>
            )}
          </Section>
        )}

        <Section
          title={<Tabs tabs={TABS} value={tab} onChange={setTab} />}
          actions={
            canEnter && (
              <Button className="rounded-full" icon={<PlusIcon width="20" height="20" />} onClick={() => setFormOpen(true)}>
                New leave
              </Button>
            )
          }
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            {units.length > 1 && (
              <div className="w-full md:w-64">
                <UnitPicker units={units} value={unitId} onChange={setUnitId} allowAll />
              </div>
            )}
            <div className="w-full md:w-40">
              <Select
                value={String(year)}
                onChange={(v) => setYear(Number(v))}
                options={[-2, -1, 0, 1].map((d) => ({ label: String(thisYear + d), value: String(thisYear + d) }))}
              />
            </div>
            {tab === 'Requests' && (
              <div className="w-full md:w-52">
                <Select
                  value={status}
                  onChange={(v) => setStatus(v as LeaveRequestStatus | '')}
                  options={[
                    { label: 'Every status', value: '' },
                    { label: 'Awaiting approval', value: 'PENDING' },
                    { label: 'Approved', value: 'APPROVED' },
                    { label: 'Rejected', value: 'REJECTED' },
                    { label: 'Cancelled', value: 'CANCELLED' },
                  ]}
                />
              </div>
            )}
          </div>

          {tab === 'Requests' ? (
            requests ? (
              <LeaveRequestsTable
                rows={requests}
                currentUserId={user?.id ?? ''}
                canApprove={canApprove}
                canManage={canManage}
                emptyText={`No leave requests in ${year}.`}
                onChanged={changed}
              />
            ) : (
              <p className="py-8 text-center text-sm text-gray-500">Loading…</p>
            )
          ) : !balances ? (
            <p className="py-8 text-center text-sm text-gray-500">Loading…</p>
          ) : (
            <>
              <p className="text-sm text-gray-600">
                Days still available in {balances.year} (after anything awaiting approval). A red figure means leave already
                taken beyond the balance — those days are deducted like absences.
              </p>
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full min-w-180 text-left text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-900">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Employee</th>
                      {balances.leaveTypes
                        .filter((t) => t.isPaid)
                        .map((t) => (
                          <th key={t.id} className="px-4 py-2.5 text-right font-semibold">
                            {t.name}
                          </th>
                        ))}
                      <th className="px-4 py-2.5 text-right font-semibold">Unpaid days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balances.employees.map((e) => (
                      <tr key={e.id} className="border-t border-gray-100">
                        <td className="px-4 py-2.5">
                          <Link href={`/employees/${e.id}`} className="font-medium text-gray-900 hover:text-accent">
                            {e.fullName}
                          </Link>
                          <p className="text-xs text-gray-500">
                            {e.designation} · {e.businessUnit.code} · {EMPLOYMENT_TYPE_LABELS[e.employmentType]}
                          </p>
                        </td>
                        {balances.leaveTypes
                          .filter((t) => t.isPaid)
                          .map((t) => {
                            const b = e.balances.find((x) => x.leaveTypeId === t.id);
                            if (!b) return <td key={t.id} className="px-4 py-2.5 text-right text-gray-300">—</td>;
                            const notEntitled = b.entitlement === '0' && b.carriedIn === '0' && b.adjustments === '0';
                            return (
                              <td
                                key={t.id}
                                className="px-4 py-2.5 text-right tabular-nums"
                                title={`Carried ${b.carriedIn} + entitled ${b.entitlement} + adjusted ${b.adjustments} − taken ${b.taken}${b.pending !== '0' ? ` − pending ${b.pending}` : ''}`}
                              >
                                <span className={clsx(b.uncovered > 0 || b.available.startsWith('-') ? 'font-semibold text-red-700' : notEntitled ? 'text-gray-400' : 'text-gray-900')}>
                                  {formatDays(b.available)}
                                </span>
                                <span className="text-xs text-gray-400"> / {formatDays(b.entitlement)}</span>
                                {b.uncovered > 0 && <p className="text-[11px] text-red-700">{b.uncovered} not covered</p>}
                              </td>
                            );
                          })}
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">
                          {e.balances.filter((b) => !b.isPaid).reduce((s, b) => s + b.uncovered, 0) || <span className="text-gray-300">0</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Section>
      </div>

      <LeaveRequestModal
        isOpen={formOpen}
        employees={employees.filter((e) => !unitId || e.businessUnit.id === unitId)}
        leaveTypes={leaveTypes}
        canApprove={canApprove}
        onClose={() => setFormOpen(false)}
        onSaved={(w) => {
          setFormOpen(false);
          changed(w, 'Leave saved.');
        }}
      />
    </div>
  );
}
