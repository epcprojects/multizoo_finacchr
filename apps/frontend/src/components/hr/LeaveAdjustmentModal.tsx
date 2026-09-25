'use client';

import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { createLeaveAdjustment, type LeaveTypeRecord } from '../../lib/api/hr';
import { errorMessage } from '../../lib/money';

type Props = {
  target: { employeeId: string; fullName: string; year: number } | null;
  leaveTypes: LeaveTypeRecord[];
  onClose: () => void;
  onSaved: () => void;
};

const DAYS = /^-?\d{1,3}(\.[05])?$/;

/**
 * Correct a leave balance — most often the balance each person brings
 * across from the workbooks at cutover. Never edited afterwards; a mistake
 * is another adjustment the other way.
 */
export default function LeaveAdjustmentModal({ target, leaveTypes, onClose, onSaved }: Props) {
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const paid = leaveTypes.filter((t) => t.isPaid && t.isActive);

  useEffect(() => {
    if (!target) return;
    setLeaveTypeId(paid[0]?.id ?? '');
    setDays('');
    setReason('');
    setError(null);
  }, [target]);

  async function submit() {
    if (!target) return;
    setError(null);
    if (!leaveTypeId) return setError('Choose the leave type.');
    if (!DAYS.test(days.trim()) || Number(days) === 0) return setError('Enter whole or half days, e.g. 3 or -1.5.');
    if (reason.trim().length < 3) return setError('Say why — it’s kept with the balance.');
    setSaving(true);
    try {
      await createLeaveAdjustment({ employeeId: target.employeeId, leaveTypeId, leaveYear: target.year, days: days.trim(), reason: reason.trim() });
      onSaved();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the adjustment.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={Boolean(target)}
      onClose={onClose}
      title="Adjust leave balance"
      subtitle={target ? `${target.fullName} · ${target.year}` : ''}
      size="medium"
      showFooter
      onConfirm={submit}
      confirmLabel={saving ? 'Saving…' : 'Save adjustment'}
      confirmDisabled={saving}
    >
      <div className="flex flex-col gap-4">
        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Leave type" value={leaveTypeId} onChange={setLeaveTypeId} options={paid.map((t) => ({ label: t.name, value: t.id }))} />
          <Input
            label="Days (+ adds, − removes)"
            required
            value={days}
            placeholder="e.g. 4 or -1.5"
            onChange={(e) => setDays(e.target.value.replace(/[^\d.-]/g, ''))}
          />
        </div>
        <Input
          label="Reason"
          required
          value={reason}
          maxLength={500}
          placeholder="Opening balance from the workbook, correction, …"
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
    </Modal>
  );
}
