'use client';

import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { ADJUSTMENT_LABELS, type AdjustmentKind, type PayRow } from '../../lib/api/payroll';
import { errorMessage, formatMoney, isAmount } from '../../lib/money';

type Props = {
  row: PayRow | null;
  onClose: () => void;
  onSave: (payload: { employeeId: string; kind: AdjustmentKind; amount: string; description: string }) => Promise<void>;
};

const PLACEHOLDERS: Record<AdjustmentKind, string> = {
  ALLOWANCE: 'e.g. Transport allowance',
  FOOD: 'e.g. Staff meals',
  DEDUCTION: 'e.g. Uniform not returned',
  ADVANCE_RECOVERY: 'e.g. Hardship — recover less this month',
};

/**
 * One figure for one person on this run — what the salary sheet's Remarks
 * column used to explain ("5K Transport and 3K food allowance").
 */
export default function AdjustmentModal({ row, onClose, onSave }: Props) {
  const [kind, setKind] = useState<AdjustmentKind>('ALLOWANCE');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setKind('ALLOWANCE');
    setAmount('');
    setDescription('');
    setError(null);
  }, [row]);

  const recovering = Boolean(row?.details.recoveries.length);

  async function submit() {
    if (!row) return;
    setError(null);
    if (!isAmount(amount) || amount.startsWith('-')) return setError('Enter an amount.');
    if (description.trim().length < 2) return setError('Say what it’s for — it’s printed on the payslip.');
    setSaving(true);
    try {
      await onSave({ employeeId: row.employeeId, kind, amount: amount.trim(), description: description.trim() });
    } catch (err) {
      setError(errorMessage(err, 'Could not save that.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={Boolean(row)}
      onClose={onClose}
      title="Add to this payslip"
      subtitle={row ? `${row.fullName} — net now ${formatMoney(row.net)}` : ''}
      size="medium"
      showFooter
      onConfirm={submit}
      confirmLabel={saving ? 'Saving…' : 'Add'}
      confirmDisabled={saving}
    >
      <div className="flex flex-col gap-4">
        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <Select
          label="What"
          value={kind}
          onChange={(v) => setKind(v as AdjustmentKind)}
          options={(Object.keys(ADJUSTMENT_LABELS) as AdjustmentKind[]).map((k) => ({ label: ADJUSTMENT_LABELS[k], value: k }))}
        />
        <Input
          label="Amount (Rs)"
          required
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
          helperText={
            kind === 'ADVANCE_RECOVERY'
              ? `Replaces this month’s scheduled recovery${recovering ? '' : ' (nothing is being recovered from them this month)'}. Enter 0 to skip a month.`
              : undefined
          }
        />
        <Input label="Reason" required value={description} maxLength={200} placeholder={PLACEHOLDERS[kind]} onChange={(e) => setDescription(e.target.value)} />
      </div>
    </Modal>
  );
}
