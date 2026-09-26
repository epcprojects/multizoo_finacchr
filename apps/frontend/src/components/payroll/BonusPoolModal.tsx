'use client';

import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import { MonthPicker, TextArea, UnitPicker } from '../hr/ui';
import Select from '../ui/Select';
import { createBonusPool, type BonusPoolDetail } from '../../lib/api/payroll';
import { getSalesTotal } from '../../lib/api/sales';
import type { BusinessUnitRecord } from '../../lib/api/ledger';
import { errorMessage, formatMoney, isAmount, todayIso, toPaisa } from '../../lib/money';

type Props = {
  isOpen: boolean;
  units: BusinessUnitRecord[];
  unitId?: string;
  month: string;
  commissionPct: string | null;
  onClose: () => void;
  onCreated: (pool: BonusPoolDetail) => void;
};

/** A new commission pool — the Bonus Calculator's "Total School Sale" and who shares it. */
export default function BonusPoolModal({ isOpen, units, unitId: preset, month: presetMonth, commissionPct, onClose, onCreated }: Props) {
  const [unitId, setUnitId] = useState('');
  const [month, setMonth] = useState(presetMonth);
  const [title, setTitle] = useState('');
  const [basis, setBasis] = useState('');
  const [sales, setSales] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState('');
  const [fromSales, setFromSales] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setUnitId(preset ?? (units.length === 1 ? units[0].id : ''));
    setMonth(presetMonth);
    setTitle('');
    setBasis('');
    setSales('');
    setError(null);
    setFromSales(null);
  }, [isOpen, preset, presetMonth, units]);

  // The unit's sales categories, so the pool can take its qualifying sales from the posted records (Module 7).
  const [y, mo] = month.split('-').map(Number);
  const monthEnd = `${month}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`;
  useEffect(() => {
    if (!isOpen || !unitId) return setCategories([]);
    getSalesTotal({ businessUnitId: unitId, from: `${month}-01`, to: monthEnd }).then(
      (t) => {
        setCategories(t.categories);
        setCategory((cur) => (cur && t.categories.includes(cur) ? cur : t.categories.find((c) => /school/i.test(c)) ?? ''));
      },
      () => setCategories([]),
    );
  }, [isOpen, unitId, month, monthEnd]);

  async function takeFromSales() {
    setError(null);
    try {
      const t = await getSalesTotal({ businessUnitId: unitId, from: `${month}-01`, to: monthEnd, category: category || undefined });
      setSales(t.amount);
      const what = category ? `${category} sales` : 'All sales';
      setBasis(`${what}, ${month}-01 to ${monthEnd}, from ${t.days} posted sales days`);
      setFromSales(`${what} for the month: ${formatMoney(t.amount)} over ${t.days} days.`);
    } catch (err) {
      setError(errorMessage(err, 'Could not read the sales records.'));
    }
  }

  // FLOOR(sales × pct, 1), as the sheet does — shown before saving.
  const pool =
    isAmount(sales) && commissionPct
      ? ((toPaisa(sales) * toPaisa(commissionPct)) / 10_000n / 100n) * 100n
      : null;

  async function submit() {
    setError(null);
    if (!unitId) return setError('Choose the unit.');
    if (title.trim().length < 2) return setError('Give it a name, e.g. “School trips — November”.');
    if (!isAmount(sales) || sales.startsWith('-')) return setError('Enter the qualifying sales.');
    setSaving(true);
    try {
      onCreated(await createBonusPool({ businessUnitId: unitId, month, title: title.trim(), basis: basis.trim() || undefined, qualifyingSales: sales.trim(), addEveryone: true }));
    } catch (err) {
      setError(errorMessage(err, 'Could not create the pool.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="New commission pool"
      subtitle="Shared by bonus tier and paid with the month’s salaries"
      size="medium"
      showFooter
      onConfirm={submit}
      confirmLabel={saving ? 'Creating…' : 'Create pool'}
      confirmDisabled={saving}
    >
      <div className="flex flex-col gap-4">
        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <UnitPicker label="Unit" units={units} value={unitId} onChange={setUnitId} />
          <div>
            <span className="mb-1.5 block text-sm font-normal text-gray-800 md:text-base">Paid with the salaries of</span>
            <MonthPicker value={month} onChange={setMonth} max={todayIso().slice(0, 7)} />
          </div>
        </div>
        <Input label="Name" required value={title} maxLength={120} placeholder="e.g. School trips — November" onChange={(e) => setTitle(e.target.value)} />
        <Input
          label="Qualifying sales (Rs)"
          required
          inputMode="decimal"
          value={sales}
          onChange={(e) => setSales(e.target.value.replace(/[^\d.]/g, ''))}
          helperText={pool !== null ? `${commissionPct}% → a pool of ${formatMoney(pool, { decimals: false })} (rounded down to the rupee)` : undefined}
        />
        {categories.length > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3 sm:flex-row sm:items-end">
            <div className="sm:flex-1">
              <Select
                label="Or take it from the sales records"
                value={category}
                onChange={setCategory}
                options={[{ label: 'All sales', value: '' }, ...categories.map((c) => ({ label: c, value: c }))]}
              />
            </div>
            <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50" onClick={() => void takeFromSales()}>
              Use this month’s total
            </button>
          </div>
        )}
        {fromSales && <p className="-mt-2 text-xs text-gray-600">{fromSales}</p>}
        <TextArea label="What the sales are" value={basis} rows={2} placeholder="e.g. School-trip ticket sales, 1–30 Nov" onChange={setBasis} />
        <p className="text-xs text-gray-600">
          Everyone at the unit with a bonus tier is added to start with; take people out or set trip counts on the next screen.
        </p>
      </div>
    </Modal>
  );
}
