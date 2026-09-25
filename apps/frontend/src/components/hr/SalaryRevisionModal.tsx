'use client';

import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { addSalaryRevision, type EmployeeRecord, type PayBasis } from '../../lib/api/hr';
import { errorMessage, formatMoney, isAmount, todayIso, toPaisa } from '../../lib/money';

type Props = {
  employee: EmployeeRecord | null;
  onClose: () => void;
  onSaved: () => void;
};

/**
 * A raise (or correction) from a date. The salary sheet's "=25000*1.1"
 * becomes a dated revision — March's payroll still sees March's salary.
 */
export default function SalaryRevisionModal({ employee, onClose, onSaved }: Props) {
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [payBasis, setPayBasis] = useState<PayBasis>('MONTHLY');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!employee) return;
    setEffectiveFrom(`${todayIso().slice(0, 8)}01`);
    setAmount('');
    setPayBasis(employee.salary?.payBasis ?? 'MONTHLY');
    setReason('');
    setError(null);
  }, [employee]);

  const current = employee?.salary ? toPaisa(employee.salary.baseSalary) : 0n;
  const next = isAmount(amount) ? toPaisa(amount) : null;
  const change = next !== null && current > 0n ? Number(((next - current) * 10000n) / current) / 100 : null;

  async function submit() {
    if (!employee) return;
    setError(null);
    if (!isAmount(amount) || amount.startsWith('-')) return setError('Enter the new salary.');
    if (reason.trim().length < 3) return setError('Say why — it’s shown in the salary history.');
    setSaving(true);
    try {
      await addSalaryRevision(employee.id, { effectiveFrom, baseSalary: amount.trim(), payBasis, reason: reason.trim() });
      onSaved();
    } catch (err) {
      setError(errorMessage(err, 'Could not record the change.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={Boolean(employee)}
      onClose={onClose}
      title="Change salary"
      subtitle={employee ? `${employee.fullName} — now ${employee.salary ? formatMoney(employee.salary.baseSalary) : '—'}` : ''}
      size="medium"
      showFooter
      onConfirm={submit}
      confirmLabel={saving ? 'Saving…' : 'Record change'}
      confirmDisabled={saving}
    >
      <div className="flex flex-col gap-4">
        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="From" type="date" required value={effectiveFrom} min={employee?.joinDate} onChange={(e) => setEffectiveFrom(e.target.value)} />
          <Select
            label="Paid"
            value={payBasis}
            onChange={(v) => setPayBasis(v as PayBasis)}
            options={[
              { label: 'Per month', value: 'MONTHLY' },
              { label: 'Per day', value: 'DAILY' },
            ]}
          />
        </div>
        <Input
          label="New salary (Rs)"
          required
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
          helperText={change !== null ? `${change >= 0 ? '+' : ''}${change}% on the current salary` : undefined}
        />
        <Input label="Reason" required value={reason} maxLength={500} placeholder="e.g. Annual 10% raise" onChange={(e) => setReason(e.target.value)} />
        <p className="text-xs text-gray-600">
          A date already in force can’t be overwritten — it would change a month that may already be paid. A change that hasn’t
          started yet can be replaced by entering the same date again.
        </p>
      </div>
    </Modal>
  );
}
