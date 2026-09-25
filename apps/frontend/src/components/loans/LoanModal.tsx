'use client';

import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { TextArea } from '../hr/ui';
import MovementFields, { draftToPayload, emptyDraft, type MovementDraft } from './MovementFields';
import type { BusinessUnitRecord } from '../../lib/api/ledger';
import { createLoan, DIRECTION_LABELS, KIND_LABELS, type CounterpartyRecord, type LoanDetail, type LoanDirection } from '../../lib/api/loans';
import { errorMessage, isAmount, toPaisa } from '../../lib/money';

type Props = {
  isOpen: boolean;
  counterparties: CounterpartyRecord[];
  units: BusinessUnitRecord[];
  counterpartyId?: string;
  /** Holds loans.approve: the loan is approved as it's made. */
  isApprover: boolean;
  onClose: () => void;
  onSaved: (loan: LoanDetail) => void;
};

/**
 * Opens a loan account: who, which unit's books, which way the money went,
 * the ceiling a Partner approves, and — usually — the first movement.
 */
export default function LoanModal({ isOpen, counterparties, units, counterpartyId, isApprover, onClose, onSaved }: Props) {
  const [cpId, setCpId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [direction, setDirection] = useState<LoanDirection>('RECEIVABLE');
  const [purpose, setPurpose] = useState('');
  const [limit, setLimit] = useState('');
  const [withFirst, setWithFirst] = useState(true);
  const [draft, setDraft] = useState<MovementDraft>(emptyDraft('lend'));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setCpId(counterpartyId ?? '');
    setUnitId('');
    setDirection('RECEIVABLE');
    setPurpose('');
    setLimit('');
    setWithFirst(true);
    setDraft(emptyDraft('lend'));
    setError(null);
  }, [isOpen, counterpartyId]);

  const cp = counterparties.find((c) => c.id === cpId);
  const isPartner = cp?.kind === 'PARTNER';

  function setDir(d: LoanDirection) {
    setDirection(d);
    setDraft((x) => ({ ...x, verb: d === 'RECEIVABLE' ? 'lend' : 'borrow', accountId: '', reserveId: '' }));
  }

  async function submit() {
    setError(null);
    if (!cp) return setError('Choose who the loan is with.');
    if (!unitId) return setError('Choose the unit whose books carry it.');
    if (purpose.trim().length < 3) return setError('Say what the loan is for.');
    if (limit && (!isAmount(limit) || toPaisa(limit) <= 0n)) return setError('The ceiling must be an amount, or blank.');
    const opening = withFirst ? draftToPayload(draft, direction, isPartner) : undefined;
    if (typeof opening === 'string') return setError(opening);
    setSaving(true);
    try {
      onSaved(
        await createLoan({
          counterpartyId: cp.id,
          businessUnitId: unitId,
          direction,
          purpose: purpose.trim(),
          limit: limit.trim() || undefined,
          opening,
        }),
      );
    } catch (err) {
      setError(errorMessage(err, 'Could not open the loan.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="New loan"
      subtitle={isApprover ? 'Approved as you open it' : 'A Partner approves it before anything posts'}
      size="large"
      showFooter
      onConfirm={submit}
      confirmLabel={saving ? 'Saving…' : isApprover ? 'Open loan' : 'Send for approval'}
      confirmDisabled={saving}
      outsideClickClose={false}
    >
      <div className="flex flex-col gap-4">
        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="With"
            required
            showSearch
            value={cpId}
            onChange={setCpId}
            placeholder="Choose a counterparty"
            options={counterparties
              .filter((c) => c.isActive)
              .map((c) => ({ label: `${c.name} · ${KIND_LABELS[c.kind]}`, value: c.id }))}
          />
          <Select
            label="In the books of"
            required
            value={unitId}
            onChange={setUnitId}
            placeholder="Choose a unit"
            options={units.map((u) => ({ label: `${u.name} (${u.code})`, value: u.id }))}
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {(['RECEIVABLE', 'PAYABLE'] as const).map((d) => (
            <label
              key={d}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm ${direction === d ? 'border-accent bg-accent-soft/40' : 'border-gray-200'}`}
            >
              <input type="radio" name="direction" checked={direction === d} onChange={() => setDir(d)} />
              {DIRECTION_LABELS[d]}
            </label>
          ))}
        </div>
        <TextArea
          label="Purpose"
          required
          rows={2}
          value={purpose}
          onChange={setPurpose}
          placeholder={direction === 'PAYABLE' ? 'e.g. ZD loan to Zoo for entertainment development' : 'e.g. Officer float for daily expenses'}
        />
        <Input
          label="Approved ceiling (Rs)"
          inputMode="decimal"
          value={limit}
          placeholder="Blank = every further advance needs a Partner"
          onChange={(e) => setLimit(e.target.value.replace(/[^\d.]/g, ''))}
          helperText="Advances within the ceiling post straight away. Cash repayments never wait."
        />
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input type="checkbox" checked={withFirst} onChange={(e) => setWithFirst(e.target.checked)} />
          Record the first movement now
        </label>
        {withFirst && (
          <div className="rounded-xl border border-gray-200 p-3">
            <MovementFields
              direction={direction}
              isPartner={isPartner}
              unitId={unitId}
              draft={draft}
              onChange={setDraft}
              onlyIncreases
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
