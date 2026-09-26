'use client';

import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { TextArea, UnitPicker } from '../hr/ui';
import { listAccounts, listJournalEntries, type AccountRecord, type BusinessUnitRecord, type JournalEntryRecord } from '../../lib/api/ledger';
import { listSalesItems, type SalesItemRecord } from '../../lib/api/sales';
import { createCapex, updateCapex, type CapexFunding, type CapexRecord } from '../../lib/api/capex';
import { errorMessage, formatDate, formatMoney, isAmount, todayIso } from '../../lib/money';

type Props = {
  isOpen: boolean;
  item: CapexRecord | null;
  units: BusinessUnitRecord[];
  natures: string[];
  defaultAccountId: string | null;
  onClose: () => void;
  onSaved: (item: CapexRecord) => void;
};

const FUNDING: { v: CapexFunding; title: string; hint: string }[] = [
  { v: 'PAID_HERE', title: 'Pay for it now', hint: 'Posts the payment from the unit’s cash, bank or wallet — optionally out of a reserve.' },
  { v: 'LINKED_ENTRY', title: 'It’s already on the ledger', hint: 'Link the entry that paid for it (e.g. a partner paid on their loan account).' },
  { v: 'NOT_RECORDED', title: 'Register only', hint: 'Bought before the system, or recorded elsewhere — nothing is posted.' },
];

/**
 * A capital purchase — a row of the investment log: what, when, how much,
 * its nature, and how many months it's expected to take to pay for itself.
 */
export default function CapexModal({ isOpen, item, units, natures, defaultAccountId, onClose, onSaved }: Props) {
  const [unitId, setUnitId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [name, setName] = useState('');
  const [nature, setNature] = useState('');
  const [amount, setAmount] = useState('');
  const [months, setMonths] = useState('');
  const [funding, setFunding] = useState<CapexFunding>('PAID_HERE');
  const [accountId, setAccountId] = useState('');
  const [paidFrom, setPaidFrom] = useState('');
  const [reserveId, setReserveId] = useState('');
  const [entryId, setEntryId] = useState('');
  const [earning, setEarning] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [entries, setEntries] = useState<JournalEntryRecord[]>([]);
  const [items, setItems] = useState<SalesItemRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setUnitId(item?.businessUnit.id ?? (units.length === 1 ? units[0].id : ''));
    setDate(item?.purchaseDate ?? todayIso());
    setName(item?.name ?? '');
    setNature(item?.nature ?? '');
    setAmount(item?.amount ?? '');
    setMonths(item?.paybackMonths ? String(item.paybackMonths) : '');
    setFunding(item?.funding ?? 'PAID_HERE');
    setAccountId(item?.accountId ?? defaultAccountId ?? '');
    setPaidFrom('');
    setReserveId('');
    setEntryId('');
    setEarning(item?.earningItemIds ?? []);
    setNote(item?.note ?? '');
    setError(null);
  }, [isOpen, item, units, defaultAccountId]);

  useEffect(() => {
    if (!isOpen || !unitId) return;
    void listAccounts({ businessUnitId: unitId }).then(setAccounts, () => setAccounts([]));
    void listSalesItems({ businessUnitId: unitId }).then(setItems, () => setItems([]));
    if (!item) {
      void listJournalEntries({ businessUnitId: unitId, kind: 'MONEY_OUT', limit: 100 }).then(
        (r) => setEntries(r.items.filter((e) => !e.reversedById)),
        () => setEntries([]),
      );
    }
  }, [isOpen, unitId, item]);

  const liquid = accounts.filter((a) => a.accountClass?.isLiquid && a.businessUnit?.id === unitId && a.isPostable);
  const chargeable = accounts.filter(
    (a) => (a.type === 'ASSET' || a.type === 'EXPENSE') && a.isPostable && !a.accountClass?.isLiquid && !a.accountClass?.isReserve && !a.loanId && !a.partnerId && !a.campaignId,
  );
  const reserves = accounts.filter((a) => a.reserveKind === 'BUCKET' && a.businessUnit?.id === unitId);
  const paidHere = !item && funding === 'PAID_HERE';
  const moneyLocked = item?.funding === 'PAID_HERE';

  useEffect(() => {
    if (paidHere && !paidFrom && liquid[0]) setPaidFrom(liquid[0].id);
  }, [paidHere, paidFrom, liquid]);

  async function submit() {
    setError(null);
    if (!unitId) return setError('Choose the unit.');
    if (name.trim().length < 2) return setError('What was bought?');
    if (nature.trim().length < 2) return setError('Give its nature — e.g. Entertainment, Food, Service.');
    if (!isAmount(amount) || Number(amount) <= 0) return setError('Enter what it cost.');
    if (months && !/^\d{1,3}$/.test(months)) return setError('Months to pay back is a whole number.');
    if (paidHere && (!accountId || !paidFrom)) return setError('Choose what to charge and what it was paid from.');
    if (!item && funding === 'LINKED_ENTRY' && !entryId) return setError('Choose the entry that paid for it.');
    setSaving(true);
    try {
      const common = {
        name: name.trim(),
        nature: nature.trim(),
        paybackMonths: months ? Number(months) : null,
        earningItemIds: earning,
        note: note.trim() || null,
      };
      const saved = item
        ? await updateCapex(item.id, { ...common, ...(moneyLocked ? {} : { purchaseDate: date, amount: amount.trim() }) })
        : await createCapex({
            ...common,
            businessUnitId: unitId,
            purchaseDate: date,
            amount: amount.trim(),
            funding,
            ...(funding === 'PAID_HERE' ? { accountId, paidFromAccountId: paidFrom, reserveAccountId: reserveId || null } : {}),
            ...(funding === 'LINKED_ENTRY' ? { journalEntryId: entryId } : {}),
          });
      onSaved(saved);
    } catch (err) {
      setError(errorMessage(err, 'Could not save.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={item ? item.name : 'Record a capital purchase'}
      subtitle="The investment log: what, when, how much, and when it should pay for itself"
      size="large"
      showFooter
      onConfirm={submit}
      confirmLabel={saving ? 'Saving…' : 'Save'}
      confirmDisabled={saving}
    >
      <div className="flex flex-col gap-4">
        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          {item ? (
            <Input label="Unit" value={item.businessUnit.name} disabled />
          ) : (
            <UnitPicker label="Unit" units={units} value={unitId} onChange={setUnitId} />
          )}
          <Input label="Purchased on" type="date" required value={date} max={todayIso()} disabled={moneyLocked} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="What was bought" required value={name} maxLength={160} placeholder="Boxing machine" onChange={(e) => setName(e.target.value)} />
          <div>
            <Input label="Nature" required value={nature} maxLength={60} placeholder="Entertainment" list="capex-natures" onChange={(e) => setNature(e.target.value)} />
            <datalist id="capex-natures">
              {natures.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Cost (Rs)"
            required
            inputMode="decimal"
            value={amount}
            disabled={moneyLocked}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            helperText={moneyLocked ? 'Paid from here — remove it and record it again to change the cost or date.' : undefined}
          />
          <Input label="Expected to pay back in (months)" inputMode="numeric" value={months} placeholder="e.g. 8" onChange={(e) => setMonths(e.target.value.replace(/\D/g, ''))} />
        </div>

        {!item && (
          <div className="flex flex-col gap-2">
            <span className="text-sm text-gray-800 md:text-base">On the ledger</span>
            {FUNDING.map((o) => (
              <label key={o.v} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${funding === o.v ? 'border-accent bg-accent-soft/40' : 'border-gray-200'}`}>
                <input type="radio" name="funding" className="mt-1" checked={funding === o.v} onChange={() => setFunding(o.v)} />
                <span>
                  <span className="block text-sm font-medium text-gray-900">{o.title}</span>
                  <span className="block text-xs text-gray-600">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>
        )}
        {paidHere && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Select label="Charge to" required value={accountId} onChange={setAccountId} options={chargeable.map((a) => ({ label: `${a.code} ${a.name}`, value: a.id }))} />
            <Select label="Paid from" required value={paidFrom} onChange={setPaidFrom} options={liquid.map((a) => ({ label: `${a.code} ${a.name}`, value: a.id }))} />
            <Select
              label="Out of reserve"
              value={reserveId}
              onChange={setReserveId}
              options={[{ label: 'No reserve', value: '' }, ...reserves.map((a) => ({ label: a.name, value: a.id }))]}
            />
          </div>
        )}
        {!item && funding === 'LINKED_ENTRY' && (
          <Select
            label="The entry that paid for it"
            required
            showSearch
            value={entryId}
            onChange={setEntryId}
            placeholder={entries.length ? 'Choose a money-out entry' : 'No money-out entries for this unit'}
            options={entries.map((e) => ({ label: `${e.displayNo} · ${formatDate(e.entryDate)} · ${formatMoney(e.amount, { decimals: false })} · ${e.description}`, value: e.id }))}
          />
        )}

        <Select
          label="Its takings (to track payback)"
          isMulti
          showSearch
          value={earning}
          onChange={setEarning}
          placeholder="Nothing linked"
          options={items.map((i) => ({ label: `${i.name} (${i.category})`, value: i.id }))}
        />
        <p className="-mt-2 text-xs text-gray-500">
          Pick the price-list items it earns — e.g. its rides — and the register shows how much of its cost it has earned back.
        </p>
        <TextArea label="Note" value={note} rows={2} onChange={setNote} placeholder="Optional" />
      </div>
    </Modal>
  );
}
