'use client';

import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { listAccounts, type AccountRecord } from '../../lib/api/ledger';
import { createAdvance } from '../../lib/api/payroll';
import type { EmployeeRecord } from '../../lib/api/hr';
import { errorMessage, formatMoney, isAmount, todayIso, toPaisa } from '../../lib/money';

type Props = {
  isOpen: boolean;
  employees: EmployeeRecord[];
  /** Preselect someone (from their employee page). */
  employeeId?: string;
  onClose: () => void;
  onSaved: () => void;
};

/**
 * Money paid ahead of salary. It's paid out of the unit's cash now and
 * recovered by payroll — the next month in full, or so much a month.
 */
export default function AdvanceModal({ isOpen, employees, employeeId: preset, onClose, onSaved }: Props) {
  const [employeeId, setEmployeeId] = useState('');
  const [issueDate, setIssueDate] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [installment, setInstallment] = useState('');
  const [reason, setReason] = useState('');
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [reserves, setReserves] = useState<AccountRecord[]>([]);
  const [accountId, setAccountId] = useState('');
  const [reserveId, setReserveId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setEmployeeId(preset ?? '');
    setIssueDate(todayIso());
    setAmount('');
    setInstallment('');
    setReason('');
    setError(null);
  }, [isOpen, preset]);

  const employee = employees.find((e) => e.id === employeeId);
  const unitId = employee?.businessUnit.id;

  useEffect(() => {
    if (!unitId) {
      setAccounts([]);
      setReserves([]);
      return;
    }
    void listAccounts({ businessUnitId: unitId }).then((list) => {
      const usable = list.filter((a) => a.isActive && a.isPostable && a.businessUnit?.id === unitId);
      const liquid = usable.filter((a) => a.accountClass?.isLiquid);
      setAccounts(liquid);
      setReserves(usable.filter((a) => a.reserveKind === 'BUCKET'));
      setAccountId(liquid.find((a) => a.accountClass?.key === 'CASH')?.id ?? liquid[0]?.id ?? '');
      setReserveId('');
    });
  }, [unitId]);

  const months =
    isAmount(amount) && isAmount(installment) && toPaisa(installment) > 0n
      ? Number((toPaisa(amount) + toPaisa(installment) - 1n) / toPaisa(installment))
      : null;

  async function submit() {
    setError(null);
    if (!employee) return setError('Choose who it’s for.');
    if (!isAmount(amount) || toPaisa(amount) <= 0n) return setError('Enter the amount.');
    if (installment && (!isAmount(installment) || toPaisa(installment) <= 0n)) return setError('Enter the monthly recovery, or leave it blank.');
    if (reason.trim().length < 3) return setError('Say what it’s for.');
    if (!accountId) return setError('Choose the account it’s paid from.');
    setSaving(true);
    try {
      await createAdvance({
        employeeId: employee.id,
        issueDate,
        amount: amount.trim(),
        installment: installment.trim() || undefined,
        reason: reason.trim(),
        accountId,
        reserveAccountId: reserveId || undefined,
      });
      onSaved();
    } catch (err) {
      setError(errorMessage(err, 'Could not record the advance.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Salary advance"
      subtitle="Paid now, recovered from their pay"
      size="medium"
      showFooter
      onConfirm={submit}
      confirmLabel={saving ? 'Saving…' : 'Pay advance'}
      confirmDisabled={saving}
    >
      <div className="flex flex-col gap-4">
        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <Select
          label="Employee"
          required
          showSearch
          value={employeeId}
          onChange={setEmployeeId}
          placeholder="Choose someone"
          options={employees.map((e) => ({ label: `${e.fullName} · ${e.businessUnit.code} · ${e.designation.name}`, value: e.id }))}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Paid on" type="date" required value={issueDate} max={todayIso()} onChange={(e) => setIssueDate(e.target.value)} />
          <Input
            label="Amount (Rs)"
            required
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            helperText={employee?.salary ? `Salary ${formatMoney(employee.salary.baseSalary)}` : undefined}
          />
        </div>
        <Input
          label="Recover per month (Rs)"
          inputMode="decimal"
          value={installment}
          placeholder="Blank = all of it next payroll"
          onChange={(e) => setInstallment(e.target.value.replace(/[^\d.]/g, ''))}
          helperText={months ? `Cleared over ${months} ${months === 1 ? 'month' : 'months'}.` : 'Payroll never takes more than the month’s pay leaves room for.'}
        />
        <Input label="Reason" required value={reason} maxLength={500} placeholder="e.g. Medical bills" onChange={(e) => setReason(e.target.value)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Paid from"
            required
            value={accountId}
            onChange={setAccountId}
            placeholder={employee ? 'Choose an account' : 'Choose the employee first'}
            options={accounts.map((a) => ({ label: `${a.name} · ${formatMoney(a.balance)}`, value: a.id }))}
          />
          <Select
            label="Out of reserve"
            value={reserveId}
            onChange={setReserveId}
            options={[{ label: 'Not from a reserve', value: '' }, ...reserves.map((a) => ({ label: `${a.name} · ${formatMoney(a.balance)}`, value: a.id }))]}
          />
        </div>
      </div>
    </Modal>
  );
}
