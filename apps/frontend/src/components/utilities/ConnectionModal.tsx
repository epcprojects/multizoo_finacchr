'use client';

import { useEffect, useMemo, useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';
import { PlusIcon, TrashIcon } from '../ui/icons';
import { TextArea } from '../hr/ui';
import { listAccounts, type AccountRecord, type BusinessUnitRecord } from '../../lib/api/ledger';
import {
  METHOD_LABELS,
  createConnection,
  updateConnection,
  type AllocationMethod,
  type ConnectionRecord,
  type ShareLine,
} from '../../lib/api/utilities';
import { errorMessage } from '../../lib/money';

type MeterDraft = { key: number; id?: string; name: string; businessUnitId: string; installedOn: string; isActive: boolean };
type SplitDraft = { key: number; businessUnitId: string; pct: string };
type ShareDraft = { key: number; label: string; weights: Record<string, string> };

const PCT = /^\d{1,3}(\.\d{1,4})?$/;

function pctTotal(list: SplitDraft[]) {
  // Hundredths of a percent → exact sum without floats.
  return list.reduce((s, x) => {
    if (!PCT.test(x.pct.trim())) return s;
    const [w, f = ''] = x.pct.trim().split('.');
    return s + Number(w) * 10000 + Number(f.padEnd(4, '0'));
  }, 0);
}

/**
 * A shared utility connection: who receives and pays the bill, and how it's
 * shared — sub-meters charged to the units they serve and a split for the
 * rest, or fixed weights.
 */
export default function ConnectionModal({
  isOpen,
  connection,
  units,
  onClose,
  onSaved,
}: {
  isOpen: boolean;
  connection: ConnectionRecord | null;
  units: BusinessUnitRecord[];
  onClose: () => void;
  onSaved: (c: ConnectionRecord) => void;
}) {
  const [name, setName] = useState('');
  const [utility, setUtility] = useState('Electricity');
  const [provider, setProvider] = useState('');
  const [reference, setReference] = useState('');
  const [unitId, setUnitId] = useState('');
  const [method, setMethod] = useState<AllocationMethod>('SUB_METERED');
  const [standardDays, setStandardDays] = useState('30');
  const [expenseId, setExpenseId] = useState('');
  const [meters, setMeters] = useState<MeterDraft[]>([]);
  const [split, setSplit] = useState<SplitDraft[]>([]);
  const [shareUnits, setShareUnits] = useState<string[]>([]);
  const [shares, setShares] = useState<ShareDraft[]>([]);
  const [notes, setNotes] = useState('');
  const [active, setActive] = useState(true);
  const [expenses, setExpenses] = useState<AccountRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const c = connection;
    setName(c?.name ?? '');
    setUtility(c?.utility ?? 'Electricity');
    setProvider(c?.provider ?? '');
    setReference(c?.reference ?? '');
    setUnitId(c?.businessUnit.id ?? '');
    setMethod(c?.method ?? 'SUB_METERED');
    setStandardDays(String(c?.standardDays ?? 30));
    setMeters(
      (c?.subMeters ?? []).map((s, i) => ({
        key: i + 1,
        id: s.id,
        name: s.name,
        businessUnitId: s.businessUnit.id,
        installedOn: s.installedOn ?? '',
        isActive: s.isActive,
      })),
    );
    setSplit((c?.remainderSplit ?? []).map((s, i) => ({ key: i + 1, businessUnitId: s.businessUnitId, pct: s.pct })));
    const su = [...new Set((c?.shares ?? []).flatMap((s) => Object.keys(s.weights)))];
    setShareUnits(su);
    setShares((c?.shares ?? []).map((s, i) => ({ key: i + 1, label: s.label, weights: { ...s.weights } })));
    setNotes(c?.notes ?? '');
    setActive(c?.isActive ?? true);
    setError(null);
    void listAccounts({ type: 'EXPENSE' }).then((list) => {
      const usable = list.filter((a) => a.isActive && a.isPostable && !a.businessUnit);
      setExpenses(usable);
      setExpenseId(c?.expenseAccount?.id ?? usable.find((a) => a.name === 'Utilities')?.id ?? '');
    });
  }, [isOpen, connection]);

  // A new connection's unmetered rest defaults to the paying unit.
  useEffect(() => {
    if (!connection && unitId && !split.length) setSplit([{ key: 1, businessUnitId: unitId, pct: '100' }]);
  }, [unitId]);

  const unitOpts = units.map((u) => ({ label: `${u.name} (${u.code})`, value: u.id }));
  const nextKey = (list: { key: number }[]) => Math.max(0, ...list.map((x) => x.key)) + 1;
  const total = pctTotal(split);
  const weightTotals = useMemo(
    () =>
      Object.fromEntries(
        shareUnits.map((u) => [u, shares.reduce((s, x) => s + (Number.isFinite(+x.weights[u]) ? Math.round(+(x.weights[u] || 0) * 10000) : 0), 0) / 10000]),
      ),
    [shares, shareUnits],
  );

  async function submit() {
    setError(null);
    if (name.trim().length < 2) return setError('Give the connection a name.');
    if (!unitId) return setError('Choose the unit that receives and pays the bill.');
    if (!expenseId) return setError('Choose the expense account.');
    if (method === 'SUB_METERED') {
      if (meters.some((m) => m.name.trim().length < 2 || !m.businessUnitId)) return setError('Each sub-meter needs a name and the unit it’s charged to.');
      if (split.length && total !== 1_000_000) return setError('The unmetered split must add up to 100%.');
    } else if (!shares.length || !shareUnits.length) {
      return setError('Add the units that share the bill and at least one line.');
    }
    const shareLines: ShareLine[] = shares.map((s) => ({
      label: s.label.trim() || 'Share',
      weights: Object.fromEntries(shareUnits.map((u) => [u, (s.weights[u] ?? '').trim()]).filter(([, w]) => w)),
    }));
    const payload = {
      name: name.trim(),
      utility: utility.trim() || 'Electricity',
      provider: provider.trim() || null,
      reference: reference.trim() || null,
      standardDays: Number(standardDays) || 30,
      expenseAccountId: expenseId,
      subMeters: method === 'SUB_METERED'
        ? meters.map((m) => ({ ...(m.id ? { id: m.id } : {}), name: m.name.trim(), businessUnitId: m.businessUnitId, installedOn: m.installedOn || null, isActive: m.isActive }))
        : [],
      remainderSplit: method === 'SUB_METERED' ? split.map((s) => ({ businessUnitId: s.businessUnitId, pct: s.pct.trim() })) : [],
      shares: method === 'SHARED' ? shareLines : [],
      notes: notes.trim() || null,
    };
    setSaving(true);
    try {
      onSaved(
        connection
          ? await updateConnection(connection.id, { ...payload, isActive: active })
          : await createConnection({ ...payload, businessUnitId: unitId, method }),
      );
    } catch (err) {
      setError(errorMessage(err, 'Could not save the connection.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={connection ? connection.name : 'New utility connection'}
      subtitle="A bill that comes to one unit and is shared with others"
      size="extraLarge"
      showFooter
      onConfirm={submit}
      confirmLabel={saving ? 'Saving…' : 'Save'}
      confirmDisabled={saving}
      outsideClickClose={false}
    >
      <div className="flex flex-col gap-4">
        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Name" required value={name} maxLength={120} placeholder="Zoo Green Meter" onChange={(e) => setName(e.target.value)} />
          <Select label="Bill comes to and is paid by" required value={unitId} onChange={setUnitId} placeholder="Choose a unit" options={unitOpts} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Utility" value={utility} maxLength={40} onChange={(e) => setUtility(e.target.value)} />
          <Input label="Provider" value={provider} maxLength={80} placeholder="IESCO" onChange={(e) => setProvider(e.target.value)} />
          <Input label="Reference / meter no." value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Charged to (expense)"
            required
            showSearch
            value={expenseId}
            onChange={setExpenseId}
            options={expenses.map((a) => ({ label: `${a.code} · ${a.parentName ? `${a.parentName} › ` : ''}${a.name}`, value: a.id }))}
          />
          {!connection ? (
            <Select
              label="How it’s shared"
              value={method}
              onChange={(v) => setMethod(v as AllocationMethod)}
              options={(Object.keys(METHOD_LABELS) as AllocationMethod[]).map((k) => ({ label: METHOD_LABELS[k].label, value: k }))}
            />
          ) : (
            <Input label="How it’s shared" value={METHOD_LABELS[method].label} disabled onChange={() => undefined} />
          )}
        </div>
        <p className="-mt-2 text-sm text-gray-600">{METHOD_LABELS[method].hint}</p>

        {method === 'SUB_METERED' ? (
          <>
            <div className="flex flex-col gap-2 rounded-xl border border-gray-200 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900">Sub-meters</p>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<PlusIcon fill="#101828" width="16" height="16" />}
                  onClick={() => setMeters((ms) => [...ms, { key: nextKey(ms), name: '', businessUnitId: '', installedOn: '', isActive: true }])}
                >
                  Add sub-meter
                </Button>
              </div>
              {!meters.length && <p className="text-sm text-gray-500">None yet — every unit on the bill is then charged by the split below.</p>}
              {meters.map((m) => (
                <div key={m.key} className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_150px_auto_40px] sm:items-end">
                  <Input label="Department" value={m.name} onChange={(e) => setMeters((ms) => ms.map((x) => (x.key === m.key ? { ...x, name: e.target.value } : x)))} />
                  <Select label="Charged to" value={m.businessUnitId} onChange={(v) => setMeters((ms) => ms.map((x) => (x.key === m.key ? { ...x, businessUnitId: v } : x)))} options={unitOpts} />
                  <Input
                    label="Installed"
                    type="date"
                    value={m.installedOn}
                    onChange={(e) => setMeters((ms) => ms.map((x) => (x.key === m.key ? { ...x, installedOn: e.target.value } : x)))}
                  />
                  <label className="flex h-10.5 items-center gap-1.5 text-sm text-gray-700">
                    <input type="checkbox" checked={m.isActive} onChange={(e) => setMeters((ms) => ms.map((x) => (x.key === m.key ? { ...x, isActive: e.target.checked } : x)))} />
                    In use
                  </label>
                  <button
                    type="button"
                    aria-label="Remove sub-meter"
                    title={m.id ? 'Retired — past bills keep its readings' : 'Remove'}
                    onClick={() => setMeters((ms) => ms.filter((x) => x.key !== m.key))}
                    className="flex h-10.5 items-center justify-center rounded-lg border border-error-200 bg-error-100"
                  >
                    <TrashIcon />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2 rounded-xl border border-gray-200 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900">What the sub-meters don’t cover</p>
                <span className={`text-xs font-medium ${total === 1_000_000 ? 'text-green-700' : 'text-danger'}`}>{total / 10000}% of 100%</span>
              </div>
              {split.map((s) => (
                <div key={s.key} className="grid grid-cols-[minmax(0,1fr)_110px_40px] items-end gap-2">
                  <Select value={s.businessUnitId} onChange={(v) => setSplit((xs) => xs.map((x) => (x.key === s.key ? { ...x, businessUnitId: v } : x)))} options={unitOpts} />
                  <Input
                    aria-label="Percent"
                    inputMode="decimal"
                    value={s.pct}
                    onChange={(e) => setSplit((xs) => xs.map((x) => (x.key === s.key ? { ...x, pct: e.target.value.replace(/[^\d.]/g, '') } : x)))}
                  />
                  <button type="button" aria-label="Remove" onClick={() => setSplit((xs) => xs.filter((x) => x.key !== s.key))} className="flex h-10.5 items-center justify-center rounded-lg border border-error-200 bg-error-100">
                    <TrashIcon />
                  </button>
                </div>
              ))}
              <div>
                <Button size="sm" variant="secondary" icon={<PlusIcon fill="#101828" width="16" height="16" />} onClick={() => setSplit((xs) => [...xs, { key: nextKey(xs), businessUnitId: '', pct: '' }])}>
                  Add a unit
                </Button>
              </div>
            </div>
            <Input
              label="Standard cycle (days)"
              inputMode="numeric"
              value={standardDays}
              helperText="A sub-meter read over part of a cycle is pro-rated to this — the sheet’s ÷ days × 30."
              onChange={(e) => setStandardDays(e.target.value.replace(/\D/g, ''))}
            />
          </>
        ) : (
          <div className="flex flex-col gap-3 rounded-xl border border-gray-200 p-3">
            <Select label="Units that share it" isMulti value={shareUnits} onChange={setShareUnits} options={unitOpts} />
            {shareUnits.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-120 text-left text-sm">
                  <thead className="text-xs text-gray-500">
                    <tr>
                      <th className="py-1.5 pr-2 font-medium">Line (e.g. office)</th>
                      {shareUnits.map((u) => (
                        <th key={u} className="px-2 py-1.5 text-right font-medium">
                          {units.find((x) => x.id === u)?.code}
                        </th>
                      ))}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {shares.map((s) => (
                      <tr key={s.key}>
                        <td className="py-1 pr-2">
                          <input
                            value={s.label}
                            onChange={(e) => setShares((xs) => xs.map((x) => (x.key === s.key ? { ...x, label: e.target.value } : x)))}
                            className="h-9 w-full rounded-lg border border-gray-200 px-2.5 text-sm outline-none focus:border-gray-400"
                          />
                        </td>
                        {shareUnits.map((u) => (
                          <td key={u} className="px-2 py-1">
                            <input
                              inputMode="decimal"
                              value={s.weights[u] ?? ''}
                              placeholder="0"
                              onChange={(e) =>
                                setShares((xs) => xs.map((x) => (x.key === s.key ? { ...x, weights: { ...x.weights, [u]: e.target.value.replace(/[^\d.]/g, '') } } : x)))
                              }
                              className="h-9 w-20 rounded-lg border border-gray-200 px-2 text-right text-sm tabular-nums outline-none focus:border-gray-400"
                            />
                          </td>
                        ))}
                        <td className="py-1">
                          <button type="button" aria-label="Remove line" onClick={() => setShares((xs) => xs.filter((x) => x.key !== s.key))} className="flex h-9 w-9 items-center justify-center rounded-lg border border-error-200 bg-error-100">
                            <TrashIcon />
                          </button>
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t border-gray-200 text-xs font-semibold text-gray-700">
                      <td className="py-2">Total</td>
                      {shareUnits.map((u) => (
                        <td key={u} className="px-2 py-2 text-right tabular-nums">
                          {weightTotals[u]}
                        </td>
                      ))}
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <div>
              <Button size="sm" variant="secondary" icon={<PlusIcon fill="#101828" width="16" height="16" />} onClick={() => setShares((xs) => [...xs, { key: nextKey(xs), label: '', weights: {} }])}>
                Add a line
              </Button>
            </div>
          </div>
        )}
        <TextArea label="Notes" rows={2} value={notes} onChange={setNotes} />
        {connection && (
          <label className="flex items-center gap-2 text-sm text-gray-800">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active — new bills can be entered for it
          </label>
        )}
      </div>
    </Modal>
  );
}
