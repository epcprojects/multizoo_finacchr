'use client';

import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { listAccounts, type AccountRecord } from '../../lib/api/ledger';
import {
  createSalesItem,
  updateSalesItem,
  type FootfallKind,
  type SalesItemRecord,
  type SalesPricing,
} from '../../lib/api/sales';
import { errorMessage, isAmount } from '../../lib/money';

type Props = {
  isOpen: boolean;
  /** Edit this one; a new item for `unitId` when null. */
  item: SalesItemRecord | null;
  unitId: string;
  unitName: string;
  categories: string[];
  onClose: () => void;
  onSaved: (item: SalesItemRecord) => void;
};

/** One line of a unit's price list: what's sold, its default rate, and whose income it is. */
export default function SalesItemModal({ isOpen, item, unitId, unitName, categories, onClose, onSaved }: Props) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [incomeAccountId, setIncomeAccountId] = useState('');
  const [pricing, setPricing] = useState<SalesPricing>('PER_UNIT');
  const [rate, setRate] = useState('');
  const [footfall, setFootfall] = useState<FootfallKind>('NONE');
  const [active, setActive] = useState(true);
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(item?.name ?? '');
    setCategory(item?.category ?? '');
    setIncomeAccountId(item?.incomeAccount?.id ?? '');
    setPricing(item?.pricing ?? 'PER_UNIT');
    setRate(item?.defaultRate ?? '');
    setFootfall(item?.footfall ?? 'NONE');
    setActive(item?.isActive ?? true);
    setError(null);
    void listAccounts({ type: 'INCOME' })
      .then((list) => setAccounts(list.filter((a) => a.isPostable && a.isActive)))
      .catch(() => setAccounts([]));
  }, [isOpen, item]);

  async function submit() {
    setError(null);
    if (name.trim().length < 2) return setError('Give it a name — e.g. Entry Ticket Adult.');
    if (category.trim().length < 2) return setError('Give it a category — e.g. Entry, Rides, Animal feed.');
    if (!incomeAccountId) return setError('Choose the income account its sales go to.');
    if (pricing === 'PER_UNIT' && rate && !isAmount(rate)) return setError('The rate is an amount with at most 2 decimals.');
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        category: category.trim(),
        incomeAccountId,
        pricing,
        defaultRate: pricing === 'PER_UNIT' && rate.trim() ? rate.trim() : null,
        footfall: pricing === 'PER_UNIT' ? footfall : ('NONE' as FootfallKind),
      };
      onSaved(item ? await updateSalesItem(item.id, { ...payload, isActive: active }) : await createSalesItem({ ...payload, businessUnitId: unitId }));
    } catch (err) {
      setError(errorMessage(err, 'Could not save the item.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={item ? item.name : 'New item'}
      subtitle={`${unitName}’s price list`}
      size="medium"
      showFooter
      onConfirm={submit}
      confirmLabel={saving ? 'Saving…' : 'Save'}
      confirmDisabled={saving}
    >
      <div className="flex flex-col gap-4">
        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <Input label="Name" required value={name} maxLength={120} placeholder="Entry Ticket Adult" onChange={(e) => setName(e.target.value)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Input label="Category" required value={category} maxLength={60} placeholder="Entry" list="sales-categories" onChange={(e) => setCategory(e.target.value)} />
            <datalist id="sales-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <Select
            label="Income account"
            required
            value={incomeAccountId}
            onChange={setIncomeAccountId}
            placeholder="Choose an account"
            options={accounts.map((a) => ({ label: `${a.code} ${a.name}`, value: a.id }))}
          />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm text-gray-800 md:text-base">How it’s sold</span>
          {(
            [
              { v: 'PER_UNIT', title: 'Quantity × rate', hint: 'Tickets, feed packets, rides — the Ticket sales sheet’s Qty × Rate.' },
              { v: 'AMOUNT', title: 'Just the day’s amount', hint: 'The day’s total only, like the cafe and gift-shop sheets.' },
            ] as const
          ).map((o) => (
            <label key={o.v} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${pricing === o.v ? 'border-accent bg-accent-soft/40' : 'border-gray-200'}`}>
              <input type="radio" name="pricing" className="mt-1" checked={pricing === o.v} onChange={() => setPricing(o.v)} />
              <span>
                <span className="block text-sm font-medium text-gray-900">{o.title}</span>
                <span className="block text-xs text-gray-600">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {pricing === 'PER_UNIT' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Default rate (Rs)"
              inputMode="decimal"
              value={rate}
              placeholder="Typed at entry"
              onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))}
              helperText="Each sale keeps the rate it was sold at."
            />
            <Select
              label="Each one sold is"
              value={footfall}
              onChange={(v) => setFootfall(v as FootfallKind)}
              options={[
                { label: 'Not a visitor count', value: 'NONE' },
                { label: 'An adult through the gate', value: 'ADULT' },
                { label: 'A child through the gate', value: 'KID' },
              ]}
            />
          </div>
        )}
        {item && (
          <label className="flex items-center gap-2 text-sm text-gray-800">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active — offered on new days
          </label>
        )}
      </div>
    </Modal>
  );
}
