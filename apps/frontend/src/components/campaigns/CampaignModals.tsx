'use client';

import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';
import { TextArea, UnitPicker } from '../hr/ui';
import { listAccounts, type AccountRecord, type BusinessUnitRecord } from '../../lib/api/ledger';
import {
  addCampaignEntry,
  closeCampaign,
  createCampaign,
  updateCampaign,
  type CampaignDetail,
  type CampaignEntryType,
} from '../../lib/api/capex';
import { errorMessage, formatMoney, isAmount, toPaisa, todayIso } from '../../lib/money';

const ErrorLine = ({ error }: { error: string | null }) =>
  error ? <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p> : null;

/** Start or edit a campaign: its name, host unit, dates and budget. */
export function CampaignModal({
  isOpen,
  campaign,
  units,
  onClose,
  onSaved,
}: {
  isOpen: boolean;
  campaign: CampaignDetail | null;
  units: BusinessUnitRecord[];
  onClose: () => void;
  onSaved: (c: CampaignDetail) => void;
}) {
  const [name, setName] = useState('');
  const [unitId, setUnitId] = useState('');
  const [start, setStart] = useState(todayIso());
  const [end, setEnd] = useState('');
  const [budget, setBudget] = useState<{ label: string; amount: string }[]>([]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(campaign?.name ?? '');
    setUnitId(campaign?.businessUnit.id ?? (units.length === 1 ? units[0].id : ''));
    setStart(campaign?.startDate ?? todayIso());
    setEnd(campaign?.endDate ?? '');
    setBudget(campaign?.budget.length ? campaign.budget : [{ label: '', amount: '' }]);
    setNotes(campaign?.notes ?? '');
    setError(null);
  }, [isOpen, campaign, units]);

  const budgetTotal = budget.reduce((s, b) => s + (isAmount(b.amount) ? toPaisa(b.amount) : 0n), 0n);

  async function submit() {
    setError(null);
    if (name.trim().length < 2) return setError('Give it a name — e.g. Ramazan 2026.');
    if (!unitId) return setError('Choose the unit whose cash it runs through.');
    if (end && end < start) return setError('It can’t end before it starts.');
    const lines = budget.filter((b) => b.label.trim() || b.amount);
    if (lines.some((b) => !b.label.trim() || !isAmount(b.amount))) return setError('Each budget line needs a label and an amount.');
    setSaving(true);
    try {
      const payload = { name: name.trim(), startDate: start, endDate: end || null, budget: lines.map((b) => ({ label: b.label.trim(), amount: b.amount })), notes: notes.trim() || null };
      onSaved(campaign ? await updateCampaign(campaign.id, payload) : await createCampaign({ ...payload, businessUnitId: unitId }));
    } catch (err) {
      setError(errorMessage(err, 'Could not save the campaign.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={campaign ? campaign.name : 'New campaign'}
      subtitle="A seasonal drive with a P&L of its own — money raised for it against money spent on it"
      size="large"
      showFooter
      onConfirm={submit}
      confirmLabel={saving ? 'Saving…' : 'Save'}
      confirmDisabled={saving}
    >
      <div className="flex flex-col gap-4">
        <ErrorLine error={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Name" required value={name} maxLength={120} placeholder="Ramazan 2026" onChange={(e) => setName(e.target.value)} />
          {campaign ? <Input label="Runs through" value={campaign.businessUnit.name} disabled /> : <UnitPicker label="Runs through (unit)" units={units} value={unitId} onChange={setUnitId} />}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Starts" type="date" required value={start} onChange={(e) => setStart(e.target.value)} />
          <Input label="Ends" type="date" value={end} onChange={(e) => setEnd(e.target.value)} helperText="Optional — set when it closes if left blank." />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm text-gray-800 md:text-base">Budget</span>
          {budget.map((b, i) => (
            <div key={i} className="flex items-end gap-2">
              <Input wrapperClassName="flex-1" value={b.label} placeholder="e.g. Iftari & sehri, 30 days @ 25,000" onChange={(e) => setBudget((bs) => bs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <Input wrapperClassName="w-40" inputMode="decimal" value={b.amount} placeholder="Amount" onChange={(e) => setBudget((bs) => bs.map((x, j) => (j === i ? { ...x, amount: e.target.value.replace(/[^\d.]/g, '') } : x)))} />
              <Button size="sm" variant="secondary" onClick={() => setBudget((bs) => bs.filter((_, j) => j !== i))}>
                Remove
              </Button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button size="sm" variant="secondary" onClick={() => setBudget((bs) => [...bs, { label: '', amount: '' }])}>
              + Add a line
            </Button>
            <span className="text-sm font-semibold tabular-nums">Total {formatMoney(budgetTotal)}</span>
          </div>
        </div>
        <TextArea label="Notes" value={notes} rows={2} onChange={setNotes} placeholder="Optional" />
      </div>
    </Modal>
  );
}

/** Money raised for, or spent on, the campaign. */
export function CampaignEntryModal({
  campaign,
  type,
  onClose,
  onSaved,
}: {
  campaign: CampaignDetail;
  type: CampaignEntryType | null;
  onClose: () => void;
  onSaved: (c: CampaignDetail) => void;
}) {
  const [date, setDate] = useState(todayIso());
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!type) return;
    setDate(todayIso() > campaign.startDate ? todayIso() : campaign.startDate);
    setCategory(type === 'INCOME' ? 'Donations' : '');
    setDescription('');
    setAmount('');
    setError(null);
    void listAccounts({ businessUnitId: campaign.businessUnit.id }).then((list) => {
      const liquid = list.filter((a) => a.accountClass?.isLiquid && a.businessUnit?.id === campaign.businessUnit.id && a.isPostable);
      setAccounts(liquid);
      setAccountId((cur) => cur || liquid[0]?.id || '');
    });
  }, [type, campaign]);

  async function submit() {
    if (!type) return;
    setError(null);
    if (category.trim().length < 2) return setError('Give it a category — e.g. Donations, Food, Gas.');
    if (description.trim().length < 2) return setError('Say what it was.');
    if (!isAmount(amount) || toPaisa(amount) <= 0n) return setError('Enter the amount.');
    if (!accountId) return setError(type === 'INCOME' ? 'Choose where it was received.' : 'Choose what it was paid from.');
    setSaving(true);
    try {
      onSaved(await addCampaignEntry(campaign.id, { type, entryDate: date, category: category.trim(), description: description.trim(), amount: amount.trim(), accountId }));
    } catch (err) {
      setError(errorMessage(err, 'Could not record it.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={type !== null}
      onClose={onClose}
      title={type === 'INCOME' ? 'Money raised' : 'Money spent'}
      subtitle={`${campaign.name} — posted at once through its fund, not the unit’s income or expenses`}
      size="medium"
      showFooter
      onConfirm={submit}
      confirmLabel={saving ? 'Recording…' : 'Record'}
      confirmDisabled={saving}
    >
      <div className="flex flex-col gap-4">
        <ErrorLine error={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Date" type="date" required value={date} min={campaign.startDate} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
          <Input label="Amount (Rs)" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
        </div>
        <div>
          <Input label="Category" required value={category} maxLength={60} list="campaign-categories" onChange={(e) => setCategory(e.target.value)} />
          <datalist id="campaign-categories">
            {campaign.categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <Input
          label={type === 'INCOME' ? 'Received from' : 'What it was'}
          required
          value={description}
          maxLength={300}
          placeholder={type === 'INCOME' ? 'e.g. Received from Taouqeer Ali' : 'e.g. Issued to Azhar for raw material'}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Select
          label={type === 'INCOME' ? 'Received into' : 'Paid from'}
          required
          value={accountId}
          onChange={setAccountId}
          options={accounts.map((a) => ({ label: `${a.code} ${a.name}`, value: a.id }))}
        />
      </div>
    </Modal>
  );
}

/** Balance the campaign off into the unit's P&L. */
export function CloseCampaignModal({
  campaign,
  isOpen,
  onClose,
  onSaved,
}: {
  campaign: CampaignDetail;
  isOpen: boolean;
  onClose: () => void;
  onSaved: (c: CampaignDetail) => void;
}) {
  const balance = toPaisa(campaign.statement.balance);
  const short = balance < 0n;
  const [date, setDate] = useState(todayIso());
  const [accountId, setAccountId] = useState('');
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setDate(todayIso());
    setError(null);
    if (balance === 0n) return;
    void listAccounts({ type: short ? 'EXPENSE' : 'INCOME' }).then((list) => {
      const usable = list.filter((a) => a.isPostable && a.isActive && !a.partnerId && !a.loanId);
      setAccounts(usable);
      const preferred = usable.find((a) => a.name === (short ? 'Miscellaneous' : 'Other Income'));
      setAccountId(preferred?.id ?? usable[0]?.id ?? '');
    });
  }, [isOpen, balance, short]);

  async function submit() {
    setError(null);
    setSaving(true);
    try {
      onSaved(await closeCampaign(campaign.id, { closedOn: date, accountId: balance === 0n ? undefined : accountId }));
    } catch (err) {
      setError(errorMessage(err, 'Could not close it.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Close ${campaign.name}`}
      subtitle="Nothing more can be recorded until it’s reopened"
      size="medium"
      showFooter
      onConfirm={submit}
      confirmLabel={saving ? 'Closing…' : 'Close the campaign'}
      confirmDisabled={saving}
    >
      <div className="flex flex-col gap-4">
        <ErrorLine error={error} />
        <p className="text-sm text-gray-700">
          {balance === 0n
            ? 'It balances exactly — nothing needs to be posted.'
            : short
              ? `It spent ${formatMoney(-balance)} more than it raised — ${campaign.businessUnit.name} carried the shortfall. Closing charges that to an expense in ${campaign.businessUnit.name}’s P&L.`
              : `It raised ${formatMoney(balance)} more than it spent. Closing takes the surplus into ${campaign.businessUnit.name}’s income.`}
        </p>
        <Input label="Closed on" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
        {balance !== 0n && (
          <Select
            label={short ? 'Charge the shortfall to' : 'Take the surplus into'}
            required
            value={accountId}
            onChange={setAccountId}
            options={accounts.map((a) => ({ label: `${a.code} ${a.name}`, value: a.id }))}
          />
        )}
      </div>
    </Modal>
  );
}
