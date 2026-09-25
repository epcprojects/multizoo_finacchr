'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import clsx from 'clsx';
import { useUser } from '../../../../components/layout/UserProvider';
import Button from '../../../../components/ui/Button';
import PageBanner from '../../../../components/ui/PageBanner';
import Select from '../../../../components/ui/Select';
import { Figure, MonthPicker, NoticeLine, Pill, Section, Tabs, type Notice } from '../../../../components/hr/ui';
import MonthCalendar, { DayKindLegend, MonthFigures } from '../../../../components/hr/MonthCalendar';
import EmployeeFormPanel from '../../../../components/hr/EmployeeFormPanel';
import SalaryRevisionModal from '../../../../components/hr/SalaryRevisionModal';
import ExitModal from '../../../../components/hr/ExitModal';
import LeaveRequestModal from '../../../../components/hr/LeaveRequestModal';
import LeaveRequestsTable from '../../../../components/hr/LeaveRequestsTable';
import LeaveAdjustmentModal from '../../../../components/hr/LeaveAdjustmentModal';
import DisciplinaryModal from '../../../../components/hr/DisciplinaryModal';
import DisciplinaryTable from '../../../../components/hr/DisciplinaryTable';
import {
  BONUS_TIER_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  WEEKDAYS,
  currentMonth,
  formatDays,
  getEmployee,
  getEmployeeLeave,
  getEmployeeMonth,
  getSalaryHistory,
  listDesignations,
  listDisciplinary,
  listLeaveTypes,
  reinstateEmployee,
  type DesignationRecord,
  type DisciplinaryRecordRow,
  type EmployeeLeave,
  type EmployeeMonth,
  type EmployeeRecord,
  type LeaveTypeRecord,
  type SalaryRevisionRecord,
} from '../../../../lib/api/hr';
import { listBusinessUnits, type BusinessUnitRecord } from '../../../../lib/api/ledger';
import { errorMessage, formatDate, formatMoney, todayIso } from '../../../../lib/money';

type Tab = 'Attendance' | 'Leave' | 'Salary' | 'Fines & warnings' | 'Details';

/** One employee: their month, their leave, their pay history, their record. */
export default function EmployeePage() {
  const { id } = useParams<{ id: string }>();
  const { user, hasPermission } = useUser();
  const canManage = hasPermission('employee.manage');
  const canApproveLeave = hasPermission('leave.approve_own_unit');
  const canEnterLeave = canApproveLeave || canManage;
  const canRaise = hasPermission('disciplinary.raise_own_unit') || hasPermission('disciplinary.approve');

  const [employee, setEmployee] = useState<EmployeeRecord | null>(null);
  const [tab, setTab] = useState<Tab>('Attendance');
  const [month, setMonth] = useState(currentMonth(todayIso()));
  const [year, setYear] = useState(Number(todayIso().slice(0, 4)));
  const [attendance, setAttendance] = useState<EmployeeMonth | null>(null);
  const [leave, setLeave] = useState<EmployeeLeave | null>(null);
  const [salary, setSalary] = useState<SalaryRevisionRecord[]>([]);
  const [fines, setFines] = useState<DisciplinaryRecordRow[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeRecord[]>([]);
  const [units, setUnits] = useState<BusinessUnitRecord[]>([]);
  const [designations, setDesignations] = useState<DesignationRecord[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [modal, setModal] = useState<'edit' | 'salary' | 'exit' | 'leave' | 'fine' | 'adjust' | null>(null);

  const refreshEmployee = useCallback(async () => {
    try {
      setEmployee(await getEmployee(id));
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, 'Could not load this employee.') });
    }
  }, [id]);

  const refreshTab = useCallback(async () => {
    if (tab === 'Attendance') setAttendance(await getEmployeeMonth(id, month));
    if (tab === 'Leave') setLeave(await getEmployeeLeave(id, year));
    if (tab === 'Salary') setSalary(await getSalaryHistory(id));
    if (tab === 'Fines & warnings') setFines(await listDisciplinary({ employeeId: id }));
  }, [id, tab, month, year]);

  useEffect(() => {
    void refreshEmployee();
    void listLeaveTypes().then(setLeaveTypes);
  }, [refreshEmployee]);

  useEffect(() => {
    void refreshTab().catch((err) => setNotice({ tone: 'error', text: errorMessage(err, 'Could not load that.') }));
  }, [refreshTab]);

  useEffect(() => {
    if (!canManage) return;
    void listBusinessUnits().then((u) => setUnits(u.filter((x) => x.isActive)));
    void listDesignations().then(setDesignations);
  }, [canManage]);

  function done(text: string, warnings: string[] = []) {
    setModal(null);
    setNotice(warnings.length ? { tone: 'warn', text: <>{text} {warnings.join(' ')}</> } : { tone: 'ok', text });
    void refreshEmployee();
    void refreshTab();
  }

  const e = employee;
  const tabs: Tab[] = ['Attendance', 'Leave', ...(e?.salary ? (['Salary'] as Tab[]) : []), 'Fines & warnings', 'Details'];
  const active = e && (e.status === 'ACTIVE' || e.isLeaving);

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <div className="shrink-0">
          <PageBanner
            imageSrc="/employees-icon.svg"
            imageAlt="Employee"
            title={e?.fullName ?? 'Employee'}
            stats={
              e
                ? [
                    { title: e.designation.name, count: e.businessUnit.code, color: '#A78BFA' },
                    { title: 'Joined', count: formatDate(e.joinDate), color: '#60A5FA' },
                    ...(e.salary ? [{ title: 'Salary', count: formatMoney(e.salary.baseSalary, { decimals: false }), color: '#34D399' }] : []),
                  ]
                : []
            }
          />
        </div>

        <p className="px-1 text-sm text-gray-600">
          <Link href="/employees" className="hover:text-accent">
            Employees
          </Link>{' '}
          / {e?.fullName ?? '…'}
        </p>

        <NoticeLine notice={notice} onClose={() => setNotice(null)} />

        {e && (
          <Section>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xl font-bold text-gray-950">{e.fullName}</p>
                  <span className="font-mono text-sm text-gray-500">{e.employeeCode}</span>
                  {e.status === 'ACTIVE' && <Pill tone="green">Employed</Pill>}
                  {e.isLeaving && e.exitDate && <Pill tone="amber">Leaving {formatDate(e.exitDate)}</Pill>}
                  {e.status === 'EXITED' && !e.isLeaving && e.exitDate && <Pill>Left {formatDate(e.exitDate)}</Pill>}
                  {e.partner && <Pill tone="violet">Partner {e.partner.shortName}</Pill>}
                </div>
                <div className="grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-3 xl:grid-cols-6">
                  <Figure label="Designation" value={e.designation.name} />
                  <Figure label="Unit" value={e.businessUnit.name} />
                  <Figure label="Department" value={e.department?.name ?? '—'} />
                  <Figure label="Type" value={EMPLOYMENT_TYPE_LABELS[e.employmentType]} />
                  <Figure label="Bonus tier" value={BONUS_TIER_LABELS[e.effectiveBonusTier]} />
                  <Figure label="Day off" value={e.weeklyOffDay != null ? WEEKDAYS[e.weeklyOffDay] : 'None fixed'} />
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {active && canEnterLeave && <Button onClick={() => setModal('leave')}>New leave</Button>}
                {active && canRaise && (
                  <Button variant="secondary" onClick={() => setModal('fine')}>
                    Fine or warning
                  </Button>
                )}
                {canManage && (
                  <Button variant="secondary" onClick={() => setModal('edit')}>
                    Edit
                  </Button>
                )}
                {canManage && e.salary && active && (
                  <Button variant="secondary" onClick={() => setModal('salary')}>
                    Change salary
                  </Button>
                )}
                {canManage && e.status === 'ACTIVE' && (
                  <Button variant="secondary" onClick={() => setModal('exit')}>
                    Record exit
                  </Button>
                )}
                {canManage && e.status === 'EXITED' && (
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      try {
                        await reinstateEmployee(e.id);
                        done(`${e.fullName} is back on the roll.`);
                      } catch (err) {
                        setNotice({ tone: 'error', text: errorMessage(err, 'Could not reinstate.') });
                      }
                    }}
                  >
                    Reinstate
                  </Button>
                )}
              </div>
            </div>
          </Section>
        )}

        <Section>
          <Tabs tabs={tabs} value={tab} onChange={setTab} />

          {tab === 'Attendance' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <MonthPicker value={month} onChange={setMonth} max={currentMonth(todayIso())} />
                <DayKindLegend />
              </div>
              {attendance ? (
                <>
                  <MonthFigures summary={attendance.summary} />
                  <MonthCalendar month={attendance} />
                </>
              ) : (
                <p className="py-8 text-center text-sm text-gray-500">Loading…</p>
              )}
            </div>
          )}

          {tab === 'Leave' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="w-40">
                  <Select
                    value={String(year)}
                    onChange={(v) => setYear(Number(v))}
                    options={[-2, -1, 0, 1].map((d) => {
                      const y = Number(todayIso().slice(0, 4)) + d;
                      return { label: `Leave year ${y}`, value: String(y) };
                    })}
                  />
                </div>
                {canManage && e && (
                  <Button variant="secondary" size="sm" onClick={() => setModal('adjust')}>
                    Adjust a balance
                  </Button>
                )}
              </div>
              {!leave ? (
                <p className="py-8 text-center text-sm text-gray-500">Loading…</p>
              ) : (
                <>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {leave.balances.map((b) => (
                      <div key={b.leaveTypeId} className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="font-semibold text-gray-900">{b.name}</p>
                          {b.isPaid ? (
                            <p className={clsx('text-lg font-bold tabular-nums', b.available.startsWith('-') ? 'text-danger' : 'text-gray-950')}>
                              {formatDays(b.available)}
                              <span className="ml-1 text-xs font-normal text-gray-500">available</span>
                            </p>
                          ) : (
                            <Pill>Unpaid</Pill>
                          )}
                        </div>
                        {b.isPaid ? (
                          <p className="text-xs leading-5 text-gray-600">
                            {b.carriedIn !== '0' && <>Carried in {formatDays(b.carriedIn)} · </>}
                            Entitled {formatDays(b.entitlement)}
                            {b.adjustments !== '0' && <> · Adjusted {b.adjustments.startsWith('-') ? '' : '+'}{formatDays(b.adjustments)}</>} · Taken{' '}
                            {formatDays(b.taken)}
                            {b.pending !== '0' && <> · Pending {formatDays(b.pending)}</>}
                            {b.uncovered > 0 && <span className="text-red-700"> · {b.uncovered} not covered</span>}
                            {b.eligibleFrom > `${leave.year}-01-01` && b.eligibleFrom <= `${leave.year}-12-31` && (
                              <span className="block">Usable from {formatDate(b.eligibleFrom)}</span>
                            )}
                            {!b.inPolicy && <span className="block">Not in the leave policy — no yearly entitlement.</span>}
                          </p>
                        ) : (
                          <p className="text-xs text-gray-600">{b.uncovered} {b.uncovered === 1 ? 'day' : 'days'} this year, deducted from salary.</p>
                        )}
                      </div>
                    ))}
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-semibold text-gray-900">Requests</p>
                    <LeaveRequestsTable
                      rows={leave.requests.filter((r) => r.startDate.startsWith(String(leave.year)))}
                      currentUserId={user?.id ?? ''}
                      canApprove={canApproveLeave}
                      canManage={canManage}
                      showEmployee={false}
                      emptyText={`No leave requests in ${leave.year}.`}
                      onChanged={(w, text) => done(text, w)}
                    />
                  </div>
                  {leave.days.length > 0 && (
                    <div>
                      <p className="mb-2 text-sm font-semibold text-gray-900">Days on leave in {leave.year}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {leave.days.map((d) => (
                          <span
                            key={d.date}
                            title={d.covered ? 'Covered by the balance' : 'Not covered — deducted like an absence'}
                            className={clsx(
                              'rounded-md border px-2 py-0.5 text-xs',
                              d.covered ? 'border-sky-200 bg-sky-50 text-sky-800' : 'border-red-200 bg-red-50 text-red-700',
                            )}
                          >
                            {formatDate(d.date).slice(0, 6)} · {d.leaveTypeName}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {leave.adjustments.length > 0 && (
                    <div>
                      <p className="mb-2 text-sm font-semibold text-gray-900">Balance adjustments</p>
                      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 text-sm">
                        {leave.adjustments.map((a) => (
                          <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2">
                            <span>
                              <span className="font-medium tabular-nums">
                                {a.days.startsWith('-') ? '' : '+'}
                                {formatDays(a.days)}
                              </span>{' '}
                              {a.leaveTypeName} ({a.leaveYear}) — {a.reason}
                            </span>
                            <span className="text-xs text-gray-500">
                              {a.createdByName ?? '—'} · {formatDate(a.createdAt.slice(0, 10))}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {tab === 'Salary' && (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-160 text-left text-sm">
                <thead className="bg-gray-50 text-xs text-gray-900">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">From</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Salary</th>
                    <th className="px-4 py-2.5 font-semibold">Why</th>
                    <th className="px-4 py-2.5 font-semibold">Recorded by</th>
                  </tr>
                </thead>
                <tbody>
                  {salary.map((s) => (
                    <tr key={s.id} className="border-t border-gray-100">
                      <td className="whitespace-nowrap px-4 py-3">
                        {formatDate(s.effectiveFrom)}{' '}
                        {s.isCurrent && <Pill tone="green">In force</Pill>}
                        {s.isUpcoming && <Pill tone="blue">Upcoming</Pill>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {formatMoney(s.baseSalary)}
                        <span className="text-xs text-gray-500"> {s.payBasis === 'DAILY' ? '/day' : '/month'}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{s.reason ?? '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {s.createdByName ?? 'Seed'} · {formatDate(s.createdAt.slice(0, 10))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'Fines & warnings' && (
            <DisciplinaryTable
              rows={fines}
              currentUserId={user?.id ?? ''}
              canApprove={hasPermission('disciplinary.approve')}
              showEmployee={false}
              onChanged={(text) => done(text)}
            />
          )}

          {tab === 'Details' && e && (
            <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
              <Detail label="Father’s name" value={e.fatherName} />
              <Detail label="CNIC" value={e.cnic ?? (e.salary ? null : 'Visible to HR and the partners')} />
              <Detail label="Phone" value={e.phone} />
              <Detail label="Address" value={e.address} />
              <Detail label="Join date" value={formatDate(e.joinDate)} />
              <Detail label="Login" value={e.userName ?? 'No login'} />
              <Detail label="Partner record" value={e.partner ? `${e.partner.name} (${e.partner.shortName})` : null} />
              {e.exitDate && <Detail label="Exit" value={`${formatDate(e.exitDate)} — ${e.exitReason ?? ''}`} />}
              <Detail label="Notes" value={e.notes} />
              <Detail label="Added" value={`${formatDate(e.createdAt.slice(0, 10))}${e.createdByName ? ` by ${e.createdByName}` : ''}`} />
            </dl>
          )}
        </Section>
      </div>

      <EmployeeFormPanel
        isOpen={modal === 'edit'}
        employee={e}
        units={units}
        designations={designations}
        canLinkUser={hasPermission('users.invite')}
        onClose={() => setModal(null)}
        onSaved={() => done('Saved.')}
      />
      <SalaryRevisionModal employee={modal === 'salary' ? e : null} onClose={() => setModal(null)} onSaved={() => done('Salary change recorded.')} />
      <ExitModal employee={modal === 'exit' ? e : null} onClose={() => setModal(null)} onSaved={() => done('Exit recorded.')} />
      <LeaveRequestModal
        isOpen={modal === 'leave'}
        employee={e}
        employees={e ? [e] : []}
        leaveTypes={leaveTypes}
        canApprove={canApproveLeave && e?.userId !== user?.id}
        onClose={() => setModal(null)}
        onSaved={(w) => done('Leave saved.', w)}
      />
      <DisciplinaryModal
        isOpen={modal === 'fine'}
        employee={e}
        employees={e ? [e] : []}
        canApprove={hasPermission('disciplinary.approve') && e?.userId !== user?.id}
        onClose={() => setModal(null)}
        onSaved={() => done('Recorded.')}
      />
      <LeaveAdjustmentModal
        target={modal === 'adjust' && e ? { employeeId: e.id, fullName: e.fullName, year } : null}
        leaveTypes={leaveTypes}
        onClose={() => setModal(null)}
        onSaved={() => done('Balance adjusted.')}
      />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="text-gray-900">{value || '—'}</dd>
    </div>
  );
}
