'use client';

import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { useUser } from '../../../components/layout/UserProvider';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Modal from '../../../components/ui/Modal';
import Select from '../../../components/ui/Select';
import PageBanner from '../../../components/ui/PageBanner';
import AddUnitWizard from '../../../components/business-units/AddUnitWizard';
import { CheckedBoxIcon, EditIcon, PlusIcon, UncheckedBoxIcon } from '../../../components/ui/icons';
import {
  getCashPosition,
  listBusinessUnits,
  UNIT_TYPE_LABELS,
  updateBusinessUnit,
  type BusinessUnitRecord,
  type BusinessUnitType,
  type CashPosition,
} from '../../../lib/api/ledger';
import { errorMessage, formatMoney } from '../../../lib/money';

export default function BusinessUnitsPage() {
  const { hasPermission } = useUser();
  const canManage = hasPermission('business_units.manage');
  const canViewLedger = hasPermission('ledger.view');

  const [units, setUnits] = useState<BusinessUnitRecord[]>([]);
  const [position, setPosition] = useState<CashPosition | null>(null);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);

  const [editing, setEditing] = useState<BusinessUnitRecord | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState<BusinessUnitType>('RETAIL');
  const [editDescription, setEditDescription] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

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

  function openEdit(u: BusinessUnitRecord) {
    setEditing(u);
    setEditName(u.name);
    setEditType(u.type);
    setEditDescription(u.description ?? '');
    setEditActive(u.isActive);
    setEditError(null);
  }

  async function saveEdit() {
    if (!editing) return;
    setEditSubmitting(true);
    setEditError(null);
    try {
      await updateBusinessUnit(editing.id, {
        name: editName.trim(),
        type: editType,
        description: editDescription.trim(),
        ...(editActive !== editing.isActive ? { isActive: editActive } : {}),
      });
      setEditing(null);
      await refresh();
    } catch (err) {
      setEditError(errorMessage(err, 'Could not save the unit.'));
    } finally {
      setEditSubmitting(false);
    }
  }

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
                              onClick={() => openEdit(u)}
                              className="rounded-lg border border-gray-200 bg-white p-2 hover:bg-gray-100"
                            >
                              <EditIcon />
                            </button>
                          )}
                        </div>
                        {pos && (
                          <div className="grid grid-cols-3 gap-2 rounded-xl bg-white p-3">
                            {(['cash', 'bank', 'wallet'] as const).map((k) => (
                              <div key={k}>
                                <p className="text-[11px] uppercase tracking-wide text-gray-500">{k === 'wallet' ? 'Easypaisa' : k}</p>
                                <p className="text-sm font-semibold tabular-nums text-gray-900">
                                  {formatMoney(pos[k], { decimals: false })}
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

      <Modal
        isOpen={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Edit Business Unit"
        subtitle={editing ? `${editing.code} — the code can't change` : undefined}
        showFooter
        onConfirm={saveEdit}
        confirmLabel={editSubmitting ? 'Saving…' : 'Save Changes'}
        confirmDisabled={editSubmitting || editName.trim().length < 2}
      >
        <div className="flex flex-col gap-4">
          {editError && (
            <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{editError}</p>
          )}
          <Input label="Unit name" required value={editName} maxLength={100} onChange={(e) => setEditName(e.target.value)} />
          <Select
            label="Type of business"
            required
            value={editType}
            onChange={(v) => setEditType(v as BusinessUnitType)}
            options={(Object.keys(UNIT_TYPE_LABELS) as BusinessUnitType[]).map((t) => ({ label: UNIT_TYPE_LABELS[t], value: t }))}
          />
          <Input label="Description" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
          <button type="button" onClick={() => setEditActive((v) => !v)} className="flex items-start gap-2 text-left">
            <span className="mt-0.5">{editActive ? <CheckedBoxIcon /> : <UncheckedBoxIcon />}</span>
            <span className="text-sm text-gray-800">
              Active
              <span className="block text-xs text-gray-600">
                A unit can only be deactivated once its cash, bank and wallet are all at zero.
              </span>
            </span>
          </button>
        </div>
      </Modal>
    </div>
  );
}
