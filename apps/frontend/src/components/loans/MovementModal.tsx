'use client';

import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import MovementFields, { draftToPayload, emptyDraft, type MovementDraft } from './MovementFields';
import { addMovement, type LoanDetail, type MovementStatus } from '../../lib/api/loans';
import { errorMessage } from '../../lib/money';

/** Records a movement on a loan: posted at once, or sent to a Partner when it needs one. */
export default function MovementModal({
  loan,
  onClose,
  onSaved,
}: {
  loan: LoanDetail | null;
  onClose: () => void;
  onSaved: (status: MovementStatus, loan: LoanDetail) => void;
}) {
  const [draft, setDraft] = useState<MovementDraft>(emptyDraft('lend'));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isPartner = loan?.counterparty?.kind === 'PARTNER';

  useEffect(() => {
    if (!loan) return;
    // The usual next thing: money coming back.
    setDraft(emptyDraft(loan.direction === 'RECEIVABLE' ? 'repaid' : 'repay'));
    setError(null);
  }, [loan]);

  async function submit() {
    if (!loan) return;
    setError(null);
    const payload = draftToPayload(draft, loan.direction, isPartner);
    if (typeof payload === 'string') return setError(payload);
    setSaving(true);
    try {
      const r = await addMovement(loan.id, payload);
      onSaved(r.status, r.loan);
    } catch (err) {
      setError(errorMessage(err, 'Could not record it.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={Boolean(loan)}
      onClose={onClose}
      title="Record a movement"
      subtitle={loan ? `${loan.loanNo} · ${loan.counterparty?.name} · ${loan.businessUnit?.name}` : undefined}
      size="large"
      showFooter
      onConfirm={submit}
      confirmLabel={saving ? 'Saving…' : 'Record'}
      confirmDisabled={saving}
      outsideClickClose={false}
    >
      {loan && (
        <div className="flex flex-col gap-4">
          {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
          <MovementFields direction={loan.direction} isPartner={isPartner} unitId={loan.businessUnit?.id ?? ''} draft={draft} onChange={setDraft} />
          <p className="text-xs text-gray-500">
            Cash repayments and an officer spending their float post straight away, as do advances within the approved ceiling
            {loan.limit ? ` (${loan.headroom ? `Rs ${loan.headroom} left` : 'none left'})` : ' (this loan has none)'}. Anything else waits for a Partner.
          </p>
        </div>
      )}
    </Modal>
  );
}
