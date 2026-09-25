'use client';

import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import { TextArea } from './ui';
import { recordExit, type EmployeeRecord } from '../../lib/api/hr';
import { errorMessage, todayIso } from '../../lib/money';

type Props = {
  employee: EmployeeRecord | null;
  onClose: () => void;
  onSaved: (employee: EmployeeRecord) => void;
};

/** Record that someone is leaving. They stay on the sheets up to their last day; settlement is Module 5. */
export default function ExitModal({ employee, onClose, onSaved }: Props) {
  const [exitDate, setExitDate] = useState(todayIso());
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!employee) return;
    setExitDate(todayIso());
    setReason('');
    setError(null);
  }, [employee]);

  async function submit() {
    if (!employee) return;
    setError(null);
    if (reason.trim().length < 3) return setError('Say why they’re leaving.');
    setSaving(true);
    try {
      onSaved(await recordExit(employee.id, { exitDate, reason: reason.trim() }));
    } catch (err) {
      setError(errorMessage(err, 'Could not record the exit.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={Boolean(employee)}
      onClose={onClose}
      title="Record exit"
      subtitle={employee ? `${employee.fullName} · ${employee.employeeCode}` : ''}
      size="medium"
      showFooter
      onConfirm={submit}
      confirmLabel={saving ? 'Saving…' : 'Record exit'}
      confirmDisabled={saving}
    >
      <div className="flex flex-col gap-4">
        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <Input
          label="Last working day"
          type="date"
          required
          value={exitDate}
          min={employee?.joinDate}
          onChange={(e) => setExitDate(e.target.value)}
          helperText="Can be in the future — they stay on the attendance sheet until then."
        />
        <TextArea label="Reason" required value={reason} onChange={setReason} placeholder="Resigned, contract ended, …" />
        <p className="text-xs text-gray-600">
          Leave or attendance recorded after this date must be cleared first. Their final settlement (unpaid salary, leave
          encashment, advances and fines) is calculated by payroll in Module 5.
        </p>
      </div>
    </Modal>
  );
}
