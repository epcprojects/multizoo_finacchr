'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { listAccounts, type AccountRecord } from '../../lib/api/ledger';
import type { PayPayload } from '../../lib/api/payroll';
import { errorMessage, formatMoney, todayIso, toPaisa } from '../../lib/money';

type Props = {
  isOpen: boolean;
  title: string;
  subtitle?: string;
  /** The unit whose cash, bank or wallet pays it. */
  unitId: string;
  amount: string;
  /** Payments can't be dated before this. */
  notBefore: string;
  children?: ReactNode;
  onClose: () => void;
  onPay: (payload: Omit<PayPayload, 'employeeIds'>) => Promise<void>;
};

/**
 * Paying out net pay: from which of the unit's cash, bank or wallet
 * accounts, on what date — and, usually, out of the Salary reserve the
 * allocation engine has been filling, so the earmark is released with it.
 */
export default function PayModal({ isOpen, title, subtitle, unitId, amount, notBefore, children, onClose, onPay }: Props) {
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [reserves, setReserves] = useState<AccountRecord[]>([]);
  const [accountId, setAccountId] = useState('');
  const [reserveId, setReserveId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !unitId) return;
    setError(null);
    setDate(todayIso() < notBefore ? notBefore : todayIso());
    void listAccounts({ businessUnitId: unitId }).then((list) => {
      const usable = list.filter((a) => a.isActive && a.isPostable && a.businessUnit?.id === unitId);
      const liquid = usable.filter((a) => a.accountClass?.isLiquid);
      const buckets = usable.filter((a) => a.reserveKind === 'BUCKET');
      setAccounts(liquid);
      setReserves(buckets);
      setAccountId(liquid.find((a) => a.accountClass?.key === 'CASH')?.id ?? liquid[0]?.id ?? '');
      setReserveId(buckets.find((a) => /salary/i.test(a.name))?.id ?? '');
    });
  }, [isOpen, unitId, notBefore]);

  const from = accounts.find((a) => a.id === accountId);
  const reserve = reserves.find((a) => a.id === reserveId);
  const short = from && toPaisa(from.balance) < toPaisa(amount);
  const reserveShort = reserve && toPaisa(reserve.balance) < toPaisa(amount);

  async function submit() {
    setError(null);
    if (!accountId) return setError('Choose the account it’s paid from.');
    setSaving(true);
    try {
      await onPay({ paymentDate: date, accountId, reserveAccountId: reserveId || undefined });
    } catch (err) {
      setError(errorMessage(err, 'Could not record the payment.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      size="medium"
      showFooter
      onConfirm={submit}
      confirmLabel={saving ? 'Paying…' : `Pay ${formatMoney(amount)}`}
      confirmDisabled={saving}
    >
      <div className="flex flex-col gap-4">
        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        {children}
        <Input label="Paid on" type="date" required value={date} min={notBefore} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
        <Select
          label="Paid from"
          required
          value={accountId}
          onChange={setAccountId}
          options={accounts.map((a) => ({ label: `${a.name} (${a.code}) · ${formatMoney(a.balance)}`, value: a.id }))}
        />
        {short && <p className="-mt-2 text-xs text-warning-800">That’s more than the account holds right now.</p>}
        <Select
          label="Out of reserve"
          value={reserveId}
          onChange={setReserveId}
          options={[{ label: 'Not from a reserve', value: '' }, ...reserves.map((a) => ({ label: `${a.name} · ${formatMoney(a.balance)}`, value: a.id }))]}
        />
        <p className="-mt-2 text-xs text-gray-600">
          {reserve
            ? `The ${reserve.name} earmark is released by the same amount — the money was set aside for this.${reserveShort ? ' It holds less than this payment.' : ''}`
            : 'Paying out of the Salary reserve keeps the unit’s earmarks honest; leave it off only if the reserve wasn’t meant for this.'}
        </p>
      </div>
    </Modal>
  );
}
