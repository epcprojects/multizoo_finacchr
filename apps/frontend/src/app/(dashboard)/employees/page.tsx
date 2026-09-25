'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { useUser } from '../../../components/layout/UserProvider';
import Button from '../../../components/ui/Button';
import PageBanner from '../../../components/ui/PageBanner';
import Select from '../../../components/ui/Select';
import { PlusIcon, SearchIcon } from '../../../components/ui/icons';
import { NoticeLine, Pill, Section, Tabs, UnitPicker, type Notice } from '../../../components/hr/ui';
import EmployeeFormPanel from '../../../components/hr/EmployeeFormPanel';
import DisciplinaryModal from '../../../components/hr/DisciplinaryModal';
import DisciplinaryTable from '../../../components/hr/DisciplinaryTable';
import {
  BONUS_TIER_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  WEEKDAYS,
  getEmployeeStats,
  listDesignations,
  listDisciplinary,
  listEmployees,
  type DesignationRecord,
  type DisciplinaryRecordRow,
  type DisciplinaryStatus,
  type EmployeeRecord,
  type EmployeeStats,
  type EmployeeStatus,
} from '../../../lib/api/hr';
import { listBusinessUnits, type BusinessUnitRecord } from '../../../lib/api/ledger';
import { errorMessage, formatDate, formatMoney } from '../../../lib/money';

const TABS = ['Employees', 'Fines & warnings'] as const;
type Tab = (typeof TABS)[number];

/**
 * Employees — the HR master (architecture plan Part 07 §01): who works
 * where, as what, since when, and — for HR and the partners — on what pay.
 * Also the fine & warning register.
 */
export default function EmployeesPage() {
  const router = useRouter();
  const { user, hasPermission } = useUser();
  const canManage = hasPermission('employee.manage');
  const canRaise = hasPermission('disciplinary.raise_own_unit') || hasPermission('disciplinary.approve');
  const canApproveFines = hasPermission('disciplinary.approve');
  const canSeeSettings = canManage || hasPermission('rules.edit_hr_policy') || hasPermission('employee.view');

  const [tab, setTab] = useState<Tab>('Employees');
  const [units, setUnits] = useState<BusinessUnitRecord[]>([]);
  const [designations, setDesignations] = useState<DesignationRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[] | null>(null);
  const [stats, setStats] = useState<EmployeeStats | null>(null);
  const [fines, setFines] = useState<DisciplinaryRecordRow[]>([]);
  const [search, setSearch] = useState('');
  const [unitId, setUnitId] = useState('');
  const [status, setStatus] = useState<EmployeeStatus | ''>('ACTIVE');
  const [fineStatus, setFineStatus] = useState<DisciplinaryStatus | ''>('');
  const [formOpen, setFormOpen] = useState(false);
  const [fineOpen, setFineOpen] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const refresh = useCallback(async () => {
    try {
      const [e, s, f] = await Promise.all([
        listEmployees({ businessUnitId: unitId || undefined, status: status || undefined }),
        getEmployeeStats(),
        listDisciplinary({ businessUnitId: unitId || undefined, status: fineStatus || undefined }),
      ]);
      setEmployees(e);
      setStats(s);
      setFines(f);
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, 'Could not load employees.') });
    }
  }, [unitId, status, fineStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void listBusinessUnits().then((u) => setUnits(u.filter((x) => x.isActive)));
    void listDesignations().then(setDesignations);
  }, []);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees ?? [];
    return (employees ?? []).filter((e) =>
      [e.fullName, e.employeeCode, e.designation.name, e.department?.name, e.cnic, e.phone]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [employees, search]);

  const showPay = shown.some((e) => e.salary);
  const pendingFines = fines.filter((f) => f.status === 'PENDING_APPROVAL').length;

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <div className="shrink-0">
          <PageBanner
            imageSrc="/employees-icon.svg"
            imageAlt="Employees"
            title="Employees"
            stats={[
              { title: 'Employed today', count: stats?.active ?? '…', color: '#34D399' },
              { title: 'Joined this month', count: stats?.joinedThisMonth ?? '…', color: '#60A5FA' },
              { title: 'Leaving', count: stats?.leaving ?? '…', color: '#F5A623' },
              { title: 'Fines to approve', count: stats?.pendingDisciplinary ?? '…', color: '#A78BFA' },
            ]}
          />
        </div>

        <NoticeLine notice={notice} onClose={() => setNotice(null)} />

        <Section
          actions={
            <>
              {canSeeSettings && (
                <Link href="/employees/settings" className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50">
                  HR settings
                </Link>
              )}
              {tab === 'Fines & warnings' && canRaise && (
                <Button className="rounded-full" icon={<PlusIcon width="20" height="20" />} onClick={() => setFineOpen(true)}>
                  Fine or warning
                </Button>
              )}
              {tab === 'Employees' && canManage && (
                <Button className="rounded-full" icon={<PlusIcon width="20" height="20" />} onClick={() => setFormOpen(true)}>
                  Add employee
                </Button>
              )}
            </>
          }
          title={
            <Tabs tabs={TABS} value={tab} onChange={setTab} counts={{ 'Fines & warnings': pendingFines }} />
          }
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            {tab === 'Employees' && (
              <div className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 lg:max-w-100">
                <div className="flex items-center gap-2">
                  <span className="shrink-0">
                    <SearchIcon fill="#374151" />
                  </span>
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Name, code, designation, CNIC…"
                    className="min-w-0 flex-1 bg-transparent text-base text-gray-900 outline-none placeholder:text-gray-400"
                  />
                </div>
              </div>
            )}
            {units.length > 1 && (
              <div className="w-full lg:w-64">
                <UnitPicker units={units} value={unitId} onChange={setUnitId} allowAll />
              </div>
            )}
            {tab === 'Employees' ? (
              <div className="w-full lg:w-48">
                <Select
                  value={status}
                  onChange={(v) => setStatus(v as EmployeeStatus | '')}
                  options={[
                    { label: 'Current staff', value: 'ACTIVE' },
                    { label: 'Exits recorded', value: 'EXITED' },
                    { label: 'Everyone', value: '' },
                  ]}
                />
              </div>
            ) : (
              <div className="w-full lg:w-52">
                <Select
                  value={fineStatus}
                  onChange={(v) => setFineStatus(v as DisciplinaryStatus | '')}
                  options={[
                    { label: 'All', value: '' },
                    { label: 'Awaiting approval', value: 'PENDING_APPROVAL' },
                    { label: 'Approved', value: 'APPROVED' },
                    { label: 'Rejected', value: 'REJECTED' },
                    { label: 'Withdrawn', value: 'WITHDRAWN' },
                  ]}
                />
              </div>
            )}
          </div>

          {tab === 'Employees' ? (
            !employees ? (
              <p className="py-8 text-center text-sm text-gray-500">Loading…</p>
            ) : !shown.length ? (
              <p className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">
                {employees.length ? 'Nobody matches that search.' : 'No employees yet.'}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full min-w-200 text-left text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-900">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Employee</th>
                      <th className="px-4 py-2.5 font-semibold">Designation</th>
                      <th className="px-4 py-2.5 font-semibold">Unit · department</th>
                      <th className="px-4 py-2.5 font-semibold">Type</th>
                      <th className="px-4 py-2.5 font-semibold">Joined</th>
                      <th className="px-4 py-2.5 font-semibold">Day off</th>
                      {showPay && <th className="px-4 py-2.5 text-right font-semibold">Salary</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((e) => (
                      <tr
                        key={e.id}
                        onClick={() => router.push(`/employees/${e.id}`)}
                        className={clsx('cursor-pointer border-t border-gray-100 hover:bg-gray-50', e.status === 'EXITED' && !e.isLeaving && 'opacity-60')}
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">
                            {e.fullName}
                            {e.partner && <span className="ml-2 align-middle"><Pill tone="violet">Partner {e.partner.shortName}</Pill></span>}
                          </p>
                          <p className="text-xs text-gray-500">
                            <span className="font-mono">{e.employeeCode}</span>
                            {e.isLeaving && e.exitDate && <span className="ml-2 text-warning-800">leaving {formatDate(e.exitDate)}</span>}
                            {e.status === 'EXITED' && !e.isLeaving && e.exitDate && <span className="ml-2">left {formatDate(e.exitDate)}</span>}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-gray-900">{e.designation.name}</p>
                          <p className="text-xs text-gray-500">{BONUS_TIER_LABELS[e.effectiveBonusTier]} tier</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-gray-900">{e.businessUnit.name}</p>
                          <p className="text-xs text-gray-500">{e.department?.name ?? '—'}</p>
                        </td>
                        <td className="px-4 py-3 text-gray-700">{EMPLOYMENT_TYPE_LABELS[e.employmentType]}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-gray-700">{formatDate(e.joinDate)}</td>
                        <td className="px-4 py-3 text-gray-700">{e.weeklyOffDay != null ? WEEKDAYS[e.weeklyOffDay].slice(0, 3) : '—'}</td>
                        {showPay && (
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                            {e.salary ? (
                              <>
                                {formatMoney(e.salary.baseSalary, { decimals: false })}
                                {e.salary.payBasis === 'DAILY' && <span className="text-xs text-gray-500"> /day</span>}
                                {e.salary.upcoming && (
                                  <p className="text-xs text-accent">
                                    → {formatMoney(e.salary.upcoming.baseSalary, { decimals: false })} from {formatDate(e.salary.upcoming.effectiveFrom)}
                                  </p>
                                )}
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <DisciplinaryTable
              rows={fines}
              currentUserId={user?.id ?? ''}
              canApprove={canApproveFines}
              onChanged={(text) => {
                setNotice({ tone: 'ok', text });
                void refresh();
              }}
            />
          )}
        </Section>
      </div>

      <EmployeeFormPanel
        isOpen={formOpen}
        employee={null}
        units={units}
        designations={designations}
        canLinkUser={hasPermission('users.invite')}
        onClose={() => setFormOpen(false)}
        onSaved={(e) => {
          setFormOpen(false);
          router.push(`/employees/${e.id}`);
        }}
      />
      <DisciplinaryModal
        isOpen={fineOpen}
        employees={employees ?? []}
        canApprove={canApproveFines}
        onClose={() => setFineOpen(false)}
        onSaved={() => {
          setFineOpen(false);
          setNotice({ tone: 'ok', text: canApproveFines ? 'Recorded.' : 'Sent to the Accountant for approval.' });
          void refresh();
        }}
      />
    </div>
  );
}
