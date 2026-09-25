'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { useUser } from '../../../components/layout/UserProvider';
import Button from '../../../components/ui/Button';
import PageBanner from '../../../components/ui/PageBanner';
import AddUnitWizard from '../../../components/business-units/AddUnitWizard';
import EditUnitPanel from '../../../components/business-units/EditUnitPanel';
import { EditIcon, PlusIcon } from '../../../components/ui/icons';
import {
  getCashPosition,
  listBusinessUnits,
  type BusinessUnitRecord,
  type CashPosition,
} from '../../../lib/api/ledger';
import { formatMoney } from '../../../lib/money';
import { listDepartments, listEmployees, type DepartmentRecord } from '../../../lib/api/hr';

/** Holders of any of these can read departments and staff. */
const HR_VIEWERS = [
  'employee.manage',
  'employee.view',
  'attendance.mark_own_unit',
  'leave.approve_own_unit',
  'disciplinary.raise_own_unit',
  'disciplinary.approve',
  'rules.edit_hr_policy',
  'payroll.run',
];

export default function BusinessUnitsPage() {
  const { hasPermission, hasAnyPermission } = useUser();
  const canViewHr = hasAnyPermission(HR_VIEWERS);
  const canManage = hasPermission('business_units.manage');
  const canViewLedger = hasPermission('ledger.view');
  const canManageAccounts = hasPermission('accounts.manage');

  const [units, setUnits] = useState<BusinessUnitRecord[]>([]);
  const [position, setPosition] = useState<CashPosition | null>(null);
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);
  const [staffByUnit, setStaffByUnit] = useState<Map<string, number>>(new Map());
  const [wizardOpen, setWizardOpen] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = units.find((u) => u.id === editingId) ?? null;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [u, p] = await Promise.all([
        listBusinessUnits(),
        canViewLedger ? getCashPosition() : Promise.resolve(null),
      ]);
      setUnits(u);
      setPosition(p);
      if (canViewHr) {
        const [d, staff] = await Promise.all([listDepartments(), listEmployees({ status: 'ACTIVE' })]);
        setDepartments(d.filter((x) => x.isActive));
        const counts = new Map<string, number>();
        for (const e of staff) counts.set(e.businessUnit.id, (counts.get(e.businessUnit.id) ?? 0) + 1);
        setStaffByUnit(counts);
      }
    } finally {
      setLoading(false);
    }
  }, [canViewLedger, canViewHr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeCount = units.filter((u) => u.isActive).length;

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:overflow-hidden xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <div className="shrink-0">
          <PageBanner
            imageSrc="/units-icon.svg"
            imageAlt="Business units"
            title="Business Units"
            stats={[
              { title: 'Active units', count: activeCount, color: '#34D399' },
              ...(position
                ? [{ title: 'Group cash position', count: formatMoney(position.totals.total, { decimals: false }), color: '#F5A623' }]
                : []),
            ]}
          />
        </div>

        <div className="flex h-auto min-h-0 flex-none flex-col gap-4 overflow-visible rounded-xl bg-white p-4 shadow-[0_0_35px_0_rgb(0_0_0/0.04)] md:p-5 xl:h-full xl:flex-1 xl:overflow-hidden">
          <div className="flex shrink-0 items-center justify-between gap-3">
            <p className="text-sm text-gray-600">
              <b className="font-semibold text-gray-800">A business unit is one business the group owns</b> — with its own
              cash, bank, wallet and reserves, and its own income allocation. Every employee belongs to one unit; inside
              it they can be grouped into departments (teams). Income and expense categories are shared across the group.
            </p>
            {canManage && (
              <Button className="shrink-0 rounded-full" icon={<PlusIcon width="20" height="20" />} onClick={() => setWizardOpen(true)}>
                Add Business Unit
              </Button>
            )}
          </div>

          <div className="xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
            {loading ? (
              <p className="py-8 text-center text-sm text-gray-500">Loading…</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {units.map((u) => {
                  const pos = position?.units.find((p) => p.id === u.id);
                  return (
                    <article
                      key={u.id}
                      className={clsx('flex flex-col rounded-2xl border border-gray-200 bg-gray-50', !u.isActive && 'opacity-60')}
                    >
                      <div className="flex flex-1 flex-col gap-3 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-base font-semibold text-gray-950">{u.name}</p>
                            <p className="text-xs text-gray-600">
                              <span className="font-mono">{u.code}</span> · {u.typeName}
                              {!u.isActive && ' · Inactive'}
                            </p>
                          </div>
                          {canManage && (
                            <button
                              type="button"
                              aria-label={`Edit ${u.name}`}
                              onClick={() => setEditingId(u.id)}
                              className="rounded-lg border border-gray-200 bg-white p-2 hover:bg-gray-100"
                            >
                              <EditIcon />
                            </button>
                          )}
                        </div>
                        {pos && position && (
                          <div className="grid grid-cols-3 gap-2 rounded-xl bg-white p-3">
                            {position.classes
                              .filter((c) => pos.accounts.some((a) => a.classId === c.id))
                              .map((c) => (
                                <div key={c.id} className="min-w-0">
                                  <p className="truncate text-[11px] uppercase tracking-wide text-gray-500">{c.name}</p>
                                  <p className="text-sm font-semibold tabular-nums text-gray-900">
                                    {formatMoney(pos.byClass[c.id] ?? '0', { decimals: false })}
                                  </p>
                                </div>
                              ))}
                          </div>
                        )}
                        {canViewHr && !u.isHolding && (
                          <div>
                            <p className="mb-1.5 text-xs text-gray-500">
                              <Link href={`/employees?businessUnitId=${u.id}`} className="hover:text-accent hover:underline">
                                {staffByUnit.get(u.id) ?? 0} staff
                              </Link>{' '}
                              · departments
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {departments.filter((d) => d.businessUnit.id === u.id).length ? (
                                departments
                                  .filter((d) => d.businessUnit.id === u.id)
                                  .map((d) => (
                                    <Link
                                      key={d.id}
                                      href={`/employees?departmentId=${d.id}`}
                                      className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs text-sky-800 hover:border-sky-400"
                                    >
                                      {d.name} · {d.headcount}
                                    </Link>
                                  ))
                              ) : (
                                <span className="text-xs text-gray-400">None yet — add them under Settings → HR setup.</span>
                              )}
                            </div>
                          </div>
                        )}
                        <div>
                          <p className="mb-1.5 text-xs text-gray-500">
                            {u.reserveBuckets.length} reserves · {u.accountCount} accounts
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {u.reserveBuckets.map((b) => (
                              <span key={b} className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-700">
                                {b}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <AddUnitWizard
        isOpen={wizardOpen}
        onClose={() => setWizardOpen(false)}
        units={units}
        onCreated={() => {
          setWizardOpen(false);
          void refresh();
        }}
      />

      <EditUnitPanel
        unit={editing}
        units={units}
        canManageAccounts={canManageAccounts}
        onClose={() => setEditingId(null)}
        onChanged={() => void refresh()}
      />
    </div>
  );
}
