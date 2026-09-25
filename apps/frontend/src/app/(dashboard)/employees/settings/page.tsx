'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { useUser } from '../../../../components/layout/UserProvider';
import Button from '../../../../components/ui/Button';
import Input from '../../../../components/ui/Input';
import PageBanner from '../../../../components/ui/PageBanner';
import Select from '../../../../components/ui/Select';
import { TrashIcon } from '../../../../components/ui/icons';
import { NoticeLine, Pill, Section, Tabs, UnitPicker, type Notice } from '../../../../components/hr/ui';
import PolicyEditorModal from '../../../../components/hr/PolicyEditorModal';
import {
  BONUS_TIER_LABELS,
  BONUS_TIERS,
  EMPLOYMENT_TYPE_LABELS,
  createDepartment,
  createDesignation,
  createHoliday,
  createLeaveType,
  deleteHoliday,
  listDepartments,
  listDesignations,
  listHolidays,
  listLeaveTypes,
  listPolicies,
  updateDepartment,
  updateDesignation,
  updateLeaveType,
  type BonusTier,
  type DepartmentRecord,
  type DesignationRecord,
  type HolidayRecord,
  type HrPolicyRecord,
  type LeaveTypeRecord,
} from '../../../../lib/api/hr';
import { listBusinessUnits, type BusinessUnitRecord } from '../../../../lib/api/ledger';
import { errorMessage, formatDate, todayIso } from '../../../../lib/money';

const TABS = ['Leave policy', 'Holidays', 'Leave types', 'Departments', 'Designations'] as const;
type Tab = (typeof TABS)[number];

/**
 * Employees → HR setup: every number the HR screens run on, editable
 * without a developer (architecture plan Part 04, "Self-service"). Leave
 * quotas are versioned (a change starts on a date); job titles, departments
 * and holidays are low-impact and save immediately.
 */
export default function HrSettingsPage() {
  const { hasPermission } = useUser();
  const canPolicy = hasPermission('rules.edit_hr_policy');
  const canOrg = hasPermission('employee.manage');
  const thisYear = Number(todayIso().slice(0, 4));

  const [tab, setTab] = useState<Tab>('Leave policy');
  const [policies, setPolicies] = useState<HrPolicyRecord[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeRecord[]>([]);
  const [holidays, setHolidays] = useState<HolidayRecord[]>([]);
  const [holidayYear, setHolidayYear] = useState(thisYear);
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);
  const [designations, setDesignations] = useState<DesignationRecord[]>([]);
  const [units, setUnits] = useState<BusinessUnitRecord[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  // Small add-forms.
  const [hDate, setHDate] = useState(todayIso());
  const [hName, setHName] = useState('');
  const [hUnit, setHUnit] = useState('');
  const [ltCode, setLtCode] = useState('');
  const [ltName, setLtName] = useState('');
  const [ltPaid, setLtPaid] = useState(true);
  const [dUnit, setDUnit] = useState('');
  const [dName, setDName] = useState('');
  const [gName, setGName] = useState('');
  const [gTier, setGTier] = useState<BonusTier>('WORKER');

  const refresh = useCallback(async () => {
    const [p, lt, h, d, g] = await Promise.all([
      listPolicies(),
      listLeaveTypes(),
      listHolidays(holidayYear),
      listDepartments(),
      listDesignations(),
    ]);
    setPolicies(p);
    setLeaveTypes(lt);
    setHolidays(h);
    setDepartments(d);
    setDesignations(g);
  }, [holidayYear]);

  useEffect(() => {
    void refresh().catch((err) => setNotice({ tone: 'error', text: errorMessage(err, 'Could not load HR setup.') }));
  }, [refresh]);

  useEffect(() => {
    void listBusinessUnits().then((u) => setUnits(u.filter((x) => x.isActive)));
  }, []);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setNotice(null);
    try {
      const result = await fn();
      // Some saves succeed with a caveat (e.g. retiring a leave type the policy still credits).
      const warnings = (result as { warnings?: string[] } | null)?.warnings ?? [];
      setNotice(warnings.length ? { tone: 'warn', text: `${ok} ${warnings.join(' ')}` } : { tone: 'ok', text: ok });
      await refresh();
      return true;
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, 'That did not work.') });
      return false;
    }
  }

  const current = policies.find((p) => p.isCurrent) ?? null;
  const upcoming = policies.filter((p) => p.isUpcoming);

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <div className="shrink-0">
          <PageBanner
            imageSrc="/employees-icon.svg"
            imageAlt="HR setup"
            title="HR setup"
            stats={[
              { title: 'Policy in force', count: current ? `v${current.version}` : '—', color: '#34D399' },
              { title: `Holidays ${holidayYear}`, count: holidays.length, color: '#A78BFA' },
              { title: 'Designations', count: designations.filter((d) => d.isActive).length, color: '#60A5FA' },
            ]}
          />
        </div>

        <p className="px-1 text-sm text-gray-600">
          <Link href="/employees" className="hover:text-accent">
            Employees
          </Link>{' '}
          / HR setup
        </p>

        <NoticeLine notice={notice} onClose={() => setNotice(null)} />

        <Section>
          <Tabs tabs={TABS} value={tab} onChange={setTab} />

          {tab === 'Leave policy' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <p className="max-w-3xl text-sm text-gray-600">
                  Seeded with the Shops &amp; Establishments Ordinance minimums. A change is a new version from a date — this
                  year’s leave keeps the entitlement it started with, so nobody’s past balance is re-counted.
                </p>
                {canPolicy && <Button onClick={() => setEditorOpen(true)}>New version</Button>}
              </div>
              {current && (
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full min-w-180 text-left text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-900">
                      <tr>
                        <th className="px-4 py-2.5 font-semibold">Leave</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Days a year</th>
                        <th className="px-4 py-2.5 font-semibold">Usable</th>
                        <th className="px-4 py-2.5 font-semibold">At a stretch</th>
                        <th className="px-4 py-2.5 font-semibold">Carry forward</th>
                        <th className="px-4 py-2.5 font-semibold">On exit</th>
                        <th className="px-4 py-2.5 font-semibold">Who gets it</th>
                      </tr>
                    </thead>
                    <tbody>
                      {current.leaveRules.map((r) => (
                        <tr key={r.leaveTypeId} className="border-t border-gray-100">
                          <td className="px-4 py-3 font-medium text-gray-900">{r.leaveTypeName}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{r.daysPerYear}</td>
                          <td className="px-4 py-3 text-gray-700">{r.availableAfterMonths ? `After ${r.availableAfterMonths} months` : 'From joining'}</td>
                          <td className="px-4 py-3 text-gray-700">{r.maxConsecutiveDays ? `Up to ${r.maxConsecutiveDays} days` : 'No limit'}</td>
                          <td className="px-4 py-3 text-gray-700">
                            {r.carryForward ? (r.maxBalance ? `Yes, hold up to ${r.maxBalance}` : 'Yes, no cap') : 'No'}
                          </td>
                          <td className="px-4 py-3 text-gray-700">{r.encashable ? 'Paid out' : '—'}</td>
                          <td className="px-4 py-3 text-gray-700">{r.employmentTypes.map((t) => EMPLOYMENT_TYPE_LABELS[t]).join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {current && (
                <p className="text-sm text-gray-700">
                  Branch Managers can mark or correct attendance up to <b>{current.attendanceBackdateDays} days</b> back; older
                  corrections go to HR.
                </p>
              )}
              <div>
                <p className="mb-2 text-sm font-semibold text-gray-900">Version history</p>
                <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 text-sm">
                  {policies.map((p) => (
                    <li key={p.id} className={clsx('flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between', p.status === 'SUPERSEDED' && 'opacity-60')}>
                      <div>
                        <p className="font-medium text-gray-900">
                          v{p.version} · from {formatDate(p.effectiveFrom)}
                          {p.effectiveTo && ` to ${formatDate(p.effectiveTo)}`}{' '}
                          {p.isCurrent && <Pill tone="green">In force</Pill>}
                          {p.isUpcoming && <Pill tone="blue">Upcoming</Pill>}
                          {p.status === 'SUPERSEDED' && <Pill>Replaced before use</Pill>}
                        </p>
                        {p.note && <p className="text-xs text-gray-600">{p.note}</p>}
                      </div>
                      <p className="shrink-0 text-xs text-gray-500">
                        {p.createdByName ?? 'Seed'} · {formatDate(p.createdAt.slice(0, 10))}
                      </p>
                    </li>
                  ))}
                </ul>
                {upcoming.length > 0 && <p className="mt-2 text-xs text-accent">v{upcoming[0].version} takes over on {formatDate(upcoming[0].effectiveFrom)}.</p>}
              </div>
            </div>
          )}

          {tab === 'Holidays' && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-gray-600">
                A holiday is a paid rest day; anyone who works it gets an extra day, like working their weekly day off. Add
                Eid and other moon-sighted holidays once their dates are announced.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-36">
                  <Select
                    value={String(holidayYear)}
                    onChange={(v) => setHolidayYear(Number(v))}
                    options={[-1, 0, 1].map((d) => ({ label: String(thisYear + d), value: String(thisYear + d) }))}
                  />
                </div>
              </div>
              {canPolicy && (
                <div className="grid gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 md:grid-cols-[160px_minmax(0,1fr)_240px_auto] md:items-end">
                  <Input label="Date" type="date" value={hDate} onChange={(e) => setHDate(e.target.value)} />
                  <Input label="Name" value={hName} maxLength={80} placeholder="Eid ul Adha" onChange={(e) => setHName(e.target.value)} />
                  <UnitPicker units={units} value={hUnit} onChange={setHUnit} allowAll label="Applies to" />
                  <Button
                    disabled={hName.trim().length < 2}
                    onClick={async () => {
                      if (await act(() => createHoliday({ date: hDate, name: hName.trim(), businessUnitId: hUnit || undefined }), `${hName.trim()} added.`)) {
                        setHName('');
                        setHolidayYear(Number(hDate.slice(0, 4)));
                      }
                    }}
                  >
                    Add holiday
                  </Button>
                </div>
              )}
              <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 text-sm">
                {holidays.length === 0 && <li className="px-4 py-6 text-center text-gray-500">No holidays in {holidayYear}.</li>}
                {holidays.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span>
                      <span className="inline-block w-28 tabular-nums text-gray-600">{formatDate(h.date)}</span>
                      <span className="font-medium text-gray-900">{h.name}</span>
                      <span className="ml-2 text-xs text-gray-500">{h.businessUnit ? h.businessUnit.name : 'All units'}</span>
                    </span>
                    {canPolicy && (
                      <button
                        type="button"
                        aria-label={`Remove ${h.name}`}
                        onClick={() => void act(() => deleteHoliday(h.id), `${h.name} removed. Days already marked keep their status.`)}
                        className="rounded-md p-1.5 hover:bg-gray-100"
                      >
                        <TrashIcon />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tab === 'Leave types' && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-gray-600">
                A paid type only has an entitlement once the leave policy gives it one. Unpaid leave is recorded as authorised
                absence and always deducted.
              </p>
              {canPolicy && (
                <div className="grid gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 md:grid-cols-[160px_minmax(0,1fr)_auto_auto] md:items-end">
                  <Input label="Code" value={ltCode} maxLength={20} placeholder="MATERNITY" onChange={(e) => setLtCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))} />
                  <Input label="Name" value={ltName} maxLength={60} placeholder="Maternity leave" onChange={(e) => setLtName(e.target.value)} />
                  <label className="flex h-10.5 items-center gap-2 text-sm text-gray-800">
                    <input type="checkbox" checked={ltPaid} onChange={(e) => setLtPaid(e.target.checked)} />
                    Paid
                  </label>
                  <Button
                    disabled={ltCode.length < 2 || ltName.trim().length < 2}
                    onClick={async () => {
                      if (await act(() => createLeaveType({ code: ltCode, name: ltName.trim(), isPaid: ltPaid }), `${ltName.trim()} added.`)) {
                        setLtCode('');
                        setLtName('');
                      }
                    }}
                  >
                    Add type
                  </Button>
                </div>
              )}
              <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 text-sm">
                {leaveTypes.map((t) => (
                  <li key={t.id} className={clsx('flex items-center justify-between gap-3 px-4 py-2.5', !t.isActive && 'opacity-50')}>
                    <span>
                      <span className="font-medium text-gray-900">{t.name}</span>
                      <span className="ml-2 font-mono text-xs text-gray-500">{t.code}</span>
                      <span className="ml-2">{t.isPaid ? <Pill tone="green">Paid</Pill> : <Pill>Unpaid</Pill>}</span>
                      {t.description && <span className="ml-2 text-xs text-gray-500">{t.description}</span>}
                    </span>
                    {canPolicy && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void act(() => updateLeaveType(t.id, { isActive: !t.isActive }), `${t.name} ${t.isActive ? 'retired' : 'restored'}.`)}
                      >
                        {t.isActive ? 'Retire' : 'Restore'}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tab === 'Departments' && (
            <div className="flex flex-col gap-4">
              <p className="max-w-3xl text-sm text-gray-600">
                <b className="font-semibold text-gray-800">Departments are teams within a business unit</b> — Animal Care
                inside Multi Zoo, Kitchen inside Panda Cafe. They only group people: on the attendance sheet and in the
                employee list. They hold no money; cash, bank and reserves belong to the{' '}
                <Link href="/business-units" className="text-accent hover:underline">
                  business unit
                </Link>
                .
              </p>
              {canOrg && (
                <div className="grid gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 md:grid-cols-[260px_minmax(0,1fr)_auto] md:items-end">
                  <UnitPicker units={units} value={dUnit} onChange={setDUnit} label="Unit" />
                  <Input label="Department" value={dName} maxLength={80} onChange={(e) => setDName(e.target.value)} />
                  <Button
                    disabled={!dUnit || dName.trim().length < 2}
                    onClick={async () => {
                      if (await act(() => createDepartment({ businessUnitId: dUnit, name: dName.trim() }), `${dName.trim()} added.`)) setDName('');
                    }}
                  >
                    Add department
                  </Button>
                </div>
              )}
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {units
                  .filter((u) => departments.some((d) => d.businessUnit.id === u.id))
                  .map((u) => (
                    <div key={u.id} className="rounded-xl border border-gray-200 p-3">
                      <p className="mb-2 text-sm font-semibold text-gray-900">{u.name}</p>
                      <ul className="flex flex-col gap-1.5 text-sm">
                        {departments
                          .filter((d) => d.businessUnit.id === u.id)
                          .map((d) => (
                            <li key={d.id} className={clsx('flex items-center justify-between gap-2', !d.isActive && 'opacity-50')}>
                              <RenameField
                                value={d.name}
                                disabled={!canOrg}
                                onSave={(name) => act(() => updateDepartment(d.id, { name }), 'Department renamed.')}
                              />
                              <span className="flex shrink-0 items-center gap-2 text-xs text-gray-500">
                                <StaffLink count={d.headcount} href={`/employees?departmentId=${d.id}`} />
                                {canOrg && (
                                  <button
                                    type="button"
                                    className="text-accent hover:underline"
                                    onClick={() => void act(() => updateDepartment(d.id, { isActive: !d.isActive }), d.isActive ? 'Department retired.' : 'Department restored.')}
                                  >
                                    {d.isActive ? 'Retire' : 'Restore'}
                                  </button>
                                )}
                              </span>
                            </li>
                          ))}
                      </ul>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {tab === 'Designations' && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-gray-600">
                Each job title’s bonus tier is how the commission pool will be split (the Bonus Calculator’s Manager /
                Supervisor / Ticketer / Worker). An employee can be given a different tier on their own record.
              </p>
              {canOrg && (
                <div className="grid gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-end">
                  <Input label="Designation" value={gName} maxLength={80} onChange={(e) => setGName(e.target.value)} />
                  <Select label="Bonus tier" value={gTier} onChange={(v) => setGTier(v as BonusTier)} options={BONUS_TIERS.map((t) => ({ label: BONUS_TIER_LABELS[t], value: t }))} />
                  <Button
                    disabled={gName.trim().length < 2}
                    onClick={async () => {
                      if (await act(() => createDesignation({ name: gName.trim(), bonusTier: gTier }), `${gName.trim()} added.`)) setGName('');
                    }}
                  >
                    Add designation
                  </Button>
                </div>
              )}
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full min-w-140 text-left text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-900">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Designation</th>
                      <th className="px-4 py-2.5 font-semibold">Bonus tier</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Staff</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {designations.map((d) => (
                      <tr key={d.id} className={clsx('border-t border-gray-100', !d.isActive && 'opacity-50')}>
                        <td className="px-4 py-2">
                          <RenameField value={d.name} disabled={!canOrg} onSave={(name) => act(() => updateDesignation(d.id, { name }), 'Designation renamed.')} />
                        </td>
                        <td className="w-56 px-4 py-2">
                          {canOrg ? (
                            <select
                              value={d.bonusTier}
                              onChange={(e) =>
                                void act(() => updateDesignation(d.id, { bonusTier: e.target.value as BonusTier }), `${d.name} is now in the ${BONUS_TIER_LABELS[e.target.value as BonusTier]} tier.`)
                              }
                              className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm"
                            >
                              {BONUS_TIERS.map((t) => (
                                <option key={t} value={t}>
                                  {BONUS_TIER_LABELS[t]}
                                </option>
                              ))}
                            </select>
                          ) : (
                            BONUS_TIER_LABELS[d.bonusTier]
                          )}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          <StaffLink count={d.headcount} href={`/employees?designationId=${d.id}`} />
                        </td>
                        <td className="px-4 py-2 text-right">
                          {canOrg && (
                            <button
                              type="button"
                              className="text-xs text-accent hover:underline"
                              onClick={() => void act(() => updateDesignation(d.id, { isActive: !d.isActive }), d.isActive ? 'Designation retired.' : 'Designation restored.')}
                            >
                              {d.isActive ? 'Retire' : 'Restore'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Section>
      </div>

      <PolicyEditorModal
        isOpen={editorOpen}
        current={current}
        leaveTypes={leaveTypes}
        onClose={() => setEditorOpen(false)}
        onSaved={(text) => {
          setEditorOpen(false);
          setNotice({ tone: 'ok', text });
          void refresh();
        }}
      />
    </div>
  );
}

/** "7 staff", linking to the employee list filtered to them. */
function StaffLink({ count, href }: { count: number; href: string }) {
  if (!count) return <span className="text-gray-400">0 staff</span>;
  return (
    <Link href={href} className="text-gray-700 underline decoration-gray-300 underline-offset-2 hover:text-accent hover:decoration-accent">
      {count} staff
    </Link>
  );
}

/** Click-to-rename text that saves on Enter or blur. */
function RenameField({ value, disabled, onSave }: { value: string; disabled?: boolean; onSave: (v: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  if (disabled || !editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setEditing(true)}
        className={clsx('truncate text-left text-gray-900', !disabled && 'hover:text-accent')}
        title={disabled ? undefined : 'Click to rename'}
      >
        {value}
      </button>
    );
  }
  const commit = async () => {
    setEditing(false);
    if (text.trim().length >= 2 && text.trim() !== value) {
      if (!(await onSave(text.trim()))) setText(value);
    } else setText(value);
  };
  return (
    <input
      autoFocus
      value={text}
      maxLength={80}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void commit();
        if (e.key === 'Escape') {
          setText(value);
          setEditing(false);
        }
      }}
      className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm outline-none focus:border-gray-500"
    />
  );
}
