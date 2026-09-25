'use client';

import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { listAccounts, type AccountRecord, type BusinessUnitRecord } from '../../lib/api/ledger';
import { interUnitTransfer, type MovementStatus } from '../../lib/api/loans';
import { errorMessage, formatMoney, isAmount, todayIso, toPaisa } from '../../lib/money';

function useUnitAccounts(unitId: string) {
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  useEffect(() => {
    if (!unitId) {
      setAccounts([]);
      return;
    }
    void listAccounts({ businessUnitId: unitId })
      .then((list) => setAccounts(list.filter((a) => a.isActive && a.isPostable && a.businessUnit?.id === unitId)))
      .catch(() => setAccounts([]));
  }, [unitId]);
  return accounts;
}

/**
 * Money from one unit's cash to another's (roles table: inter-unit
 * transfers need a Partner). Both units' books are posted together.
 */
export default function TransferModal({
  isOpen,
  units,
  isApprover,
  onClose,
  onSaved,
}: {
  isOpen: boolean;
  units: BusinessUnitRecord[];
  isApprover: boolean;
  onClose: () => void;
  onSaved: (status: MovementStatus) => void;
}) {
  const [fromUnitId, setFromUnitId] = useState('');
  const [toUnitId, setToUnitId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [fromAccountId, setFromAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [reserveId, setReserveId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fromAccounts = useUnitAccounts(fromUnitId);
  const toAccounts = useUnitAccounts(toUnitId);

  useEffect(() => {
    if (!isOpen) return;
    setFromUnitId('');
    setToUnitId('');
    setDate(todayIso());
    setAmount('');
    setDescription('');
    setError(null);
  }, [isOpen]);
  useEffect(() => {
    setFromAccountId(fromAccounts.find((a) => a.accountClass?.key === 'CASH')?.id ?? '');
    setReserveId('');
  }, [fromAccounts]);
  useEffect(() => setToAccountId(toAccounts.find((a) => a.accountClass?.key === 'CASH')?.id ?? ''), [toAccounts]);

  const liquid = (list: AccountRecord[]) =>
    list.filter((a) => a.accountClass?.isLiquid).map((a) => ({ label: `${a.name} · ${formatMoney(a.balance)}`, value: a.id }));
  const reserves = fromAccounts.filter((a) => a.reserveKind === 'BUCKET');

  async function submit() {
    setError(null);
    if (!fromUnitId || !toUnitId) return setError('Choose both units.');
    if (fromUnitId === toUnitId) return setError('Choose two different units.');
    if (!isAmount(amount) || toPaisa(amount) <= 0n) return setError('Enter the amount.');
    if (description.trim().length < 2) return setError('Say what it’s for.');
    if (!fromAccountId || !toAccountId) return setError('Choose the account on each side.');
    setSaving(true);
    try {
      const r = await interUnitTransfer({
        fromUnitId,
        toUnitId,
        transferDate: date,
        amount: amount.trim(),
        fromAccountId,
        toAccountId,
        reserveAccountId: reserveId || undefined,
        description: description.trim(),
      });
      onSaved(r.status);
    } catch (err) {
      setError(errorMessage(err, 'Could not record the transfer.'));
    } finally {
      setSaving(false);
    }
  }

  const unitOptions = units.map((u) => ({ label: `${u.name} (${u.code})`, value: u.id }));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Inter-unit transfer"
      subtitle={isApprover ? 'Posts to both units at once' : 'A Partner approves it before it posts'}
      size="large"
      showFooter
      onConfirm={submit}
      confirmLabel={saving ? 'Saving…' : isApprover ? 'Transfer' : 'Send for approval'}
      confirmDisabled={saving}
      outsideClickClose={false}
    >
      <div className="flex flex-col gap-4">
        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-xl border border-gray-200 p-3">
            <p className="text-sm font-semibold text-gray-900">From</p>
            <Select label="Unit" required value={fromUnitId} onChange={setFromUnitId} placeholder="Paying unit" options={unitOptions} />
            <Select label="Paid from" required value={fromAccountId} onChange={setFromAccountId} placeholder="Cash, bank or wallet" options={liquid(fromAccounts)} />
            {reserves.length > 0 && (
              <Select
                label="Out of reserve"
                value={reserveId}
                onChange={setReserveId}
                options={[{ label: 'Not from a reserve', value: '' }, ...reserves.map((a) => ({ label: `${a.name} · ${formatMoney(a.balance)}`, value: a.id }))]}
              />
            )}
          </div>
          <div className="flex flex-col gap-3 rounded-xl border border-gray-200 p-3">
            <p className="text-sm font-semibold text-gray-900">To</p>
            <Select label="Unit" required value={toUnitId} onChange={setToUnitId} placeholder="Receiving unit" options={unitOptions.filter((o) => o.value !== fromUnitId)} />
            <Select label="Received into" required value={toAccountId} onChange={setToAccountId} placeholder="Cash, bank or wallet" options={liquid(toAccounts)} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Date" type="date" required value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
          <Input label="Amount (Rs)" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
        </div>
        <Input
          label="Description"
          required
          value={description}
          maxLength={500}
          placeholder="e.g. Joy Land machines payment"
          onChange={(e) => setDescription(e.target.value)}
        />
        <p className="text-xs text-gray-500">
          The paying unit records what it&apos;s owed (“Due from …”) and the receiving unit what it owes (“Due to …”). Paying it back is a transfer the other way.
        </p>
      </div>
    </Modal>
  );
}
