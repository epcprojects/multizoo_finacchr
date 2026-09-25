'use client';

import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { TextArea } from './ui';
import { createDisciplinary, type DisciplinaryType, type EmployeeRecord } from '../../lib/api/hr';
import { errorMessage, isAmount, todayIso } from '../../lib/money';

type Props = {
  isOpen: boolean;
  /** Preselected employee (from their page); otherwise pick from the list. */
  employee?: EmployeeRecord | null;
  employees: EmployeeRecord[];
  /** Holds disciplinary.approve — may record it already approved. */
  canApprove: boolean;
  onClose: () => void;
  onSaved: () => void;
};

/**
 * A fine or a warning, with its reason — instead of a bare number in the
 * salary sheet's Fine column. A Branch Manager raises it; the Accountant
 * approves before payroll deducts it.
 */
export default function DisciplinaryModal({ isOpen, employee, employees, canApprove, onClose, onSaved }: Props) {
  const [employeeId, setEmployeeId] = useState('');
  const [type, setType] = useState<DisciplinaryType>('FINE');
  const [incidentDate, setIncidentDate] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [approve, setApprove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setEmployeeId(employee?.id ?? '');
    setType('FINE');
    setIncidentDate(todayIso());
    setAmount('');
    setReason('');
    setApprove(false);
    setError(null);
  }, [isOpen, employee]);

  async function submit() {
    setError(null);
    if (!employeeId) return setError('Choose the employee.');
    if (type === 'FINE' && (!isAmount(amount) || Number(amount) <= 0)) return setError('Enter the fine amount.');
    if (reason.trim().length < 3) return setError('Say what happened.');
    setSaving(true);
    try {
      await createDisciplinary({
        employeeId,
        type,
        incidentDate,
        reason: reason.trim(),
        ...(type === 'FINE' ? { amount: amount.trim() } : {}),
        ...(approve ? { approve: true } : {}),
      });
      onSaved();
    } catch (err) {
      setError(errorMessage(err, 'Could not save it.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={type === 'FINE' ? 'Raise a fine' : 'Record a warning'}
      subtitle={canApprove ? 'You can approve it as you record it.' : 'It goes to the Accountant for approval.'}
      size="medium"
      showFooter
      onConfirm={submit}
      confirmLabel={saving ? 'Saving…' : approve ? 'Record approved' : 'Submit for approval'}
      confirmDisabled={saving}
    >
      <div className="flex flex-col gap-4">
        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        {!employee && (
          <Select
            label="Employee"
            required
            showSearch
            value={employeeId}
            onChange={setEmployeeId}
            options={employees
              .filter((e) => e.status === 'ACTIVE' || e.isLeaving)
              .map((e) => ({ label: `${e.fullName} · ${e.designation.name} (${e.businessUnit.code})`, value: e.id }))}
          />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Type"
            value={type}
            onChange={(v) => setType(v as DisciplinaryType)}
            options={[
              { label: 'Fine', value: 'FINE' },
              { label: 'Warning (no amount)', value: 'WARNING' },
            ]}
          />
          <Input label="Date of incident" type="date" required value={incidentDate} max={todayIso()} onChange={(e) => setIncidentDate(e.target.value)} />
        </div>
        {type === 'FINE' && (
          <Input label="Amount (Rs)" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
        )}
        <TextArea label="Reason" required value={reason} onChange={setReason} placeholder="What happened, in a sentence someone will understand in a year." />
        {canApprove && (
          <label className="flex items-center gap-2 text-sm text-gray-800">
            <input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} />
            Approve it now
          </label>
        )}
      </div>
    </Modal>
  );
}
