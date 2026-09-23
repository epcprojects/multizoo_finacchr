'use client';

import { useCallback, useEffect, useState } from 'react';
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
  UNIT_TYPE_LABELS,
  type BusinessUnitRecord,
  type CashPosition,
} from '../../../lib/api/ledger';
import { formatMoney } from '../../../lib/money';

export default function BusinessUnitsPage() {
  const { hasPermission } = useUser();
  const canManage = hasPermission('business_units.manage');
  const canViewLedger = hasPermission('ledger.view');
  const canManageAccounts = hasPermission('accounts.manage');

  const [units, setUnits] = useState<BusinessUnitRecord[]>([]);
  const [position, setPosition] = useState<CashPosition | null>(null);
  const [loading, setLoading] = useState(true);
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
    } finally {
      setLoading(false);
    }
  }, [canViewLedger]);

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
              Each unit owns its cash, bank, wallet and reserve accounts. Income and expense categories are shared across
              the group.
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
                              <span className="font-mono">{u.code}</span> · {UNIT_TYPE_LABELS[u.type]}
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
