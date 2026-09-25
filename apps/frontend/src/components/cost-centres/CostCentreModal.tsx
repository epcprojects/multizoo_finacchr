'use client';

import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { TextArea } from '../hr/ui';
import { listPartners, type PartnerRecord } from '../../lib/api/allocation';
import type { BusinessUnitRecord } from '../../lib/api/ledger';
import { createCostCentre, updateCostCentre, type CostCentreCharge, type CostCentreRecord } from '../../lib/api/cost-centres';
import { errorMessage } from '../../lib/money';

type Props = {
  isOpen: boolean;
  /** Edit this one; a new centre when null. */
  centre: CostCentreRecord | null;
  units: BusinessUnitRecord[];
  /** Holds rules.edit_allocation — may route a centre to a partner's profit. */
  isPartner: boolean;
  onClose: () => void;
  onSaved: (c: CostCentreRecord) => void;
};

/**
 * A cost centre: a code and name to tag spending with, and where that
 * spending ends up — the paying unit's own P&L, or a partner's profit (the
 * "342" media office, "Paid from Zoo MIK Profit").
 */
export default function CostCentreModal({ isOpen, centre, units, isPartner, onClose, onSaved }: Props) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [chargeTo, setChargeTo] = useState<CostCentreCharge>('UNIT');
  const [partnerId, setPartnerId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [active, setActive] = useState(true);
  const [partners, setPartners] = useState<PartnerRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setCode(centre?.code ?? '');
    setName(centre?.name ?? '');
    setDescription(centre?.description ?? '');
    setChargeTo(centre?.chargeTo ?? 'UNIT');
    setPartnerId(centre?.partner?.id ?? '');
    setUnitId(centre?.businessUnit?.id ?? '');
    setActive(centre?.isActive ?? true);
    setError(null);
    void listPartners()
      .then((ps) => setPartners(ps.filter((p) => p.isActive)))
      .catch(() => setPartners([]));
  }, [isOpen, centre]);

  // A centre that charges a partner is a Partner's to change (roles table).
  const locked = !isPartner && centre?.chargeTo === 'PARTNER';

  async function submit() {
    setError(null);
    if (!code.trim()) return setError('Give it a code — e.g. 342.');
    if (name.trim().length < 2) return setError('Give it a name.');
    if (chargeTo === 'PARTNER' && !partnerId) return setError('Choose the partner it’s charged to.');
    setSaving(true);
    try {
      const payload = {
        code: code.trim(),
        name: name.trim(),
        description: description.trim() || undefined,
        chargeTo,
        ...(chargeTo === 'PARTNER' ? { partnerId } : {}),
        businessUnitId: unitId || null,
      };
      const saved = centre
        ? await updateCostCentre(centre.id, {
            ...payload,
            description: description.trim() || null,
            partnerId: chargeTo === 'PARTNER' ? partnerId : null,
            isActive: active,
          })
        : await createCostCentre(payload);
      onSaved(saved);
    } catch (err) {
      setError(errorMessage(err, 'Could not save the cost centre.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={centre ? `Cost centre ${centre.code}` : 'New cost centre'}
      subtitle="A tag for spending, and whose books it lands in"
      size="medium"
      showFooter={!locked}
      onConfirm={submit}
      confirmLabel={saving ? 'Saving…' : 'Save'}
      confirmDisabled={saving}
    >
      <div className="flex flex-col gap-4">
        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        {locked && (
          <p className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-800">
            This centre charges {centre?.partner?.shortName}&apos;s profit — only a Partner can change it.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
          <Input label="Code" required value={code} maxLength={20} disabled={locked} placeholder="342" onChange={(e) => setCode(e.target.value)} />
          <Input label="Name" required value={name} maxLength={120} disabled={locked} placeholder="Media Office" onChange={(e) => setName(e.target.value)} />
        </div>
        <TextArea label="What it’s for" value={description} rows={2} onChange={setDescription} placeholder="Optional" />
        <div className="flex flex-col gap-2">
          <span className="text-sm text-gray-800 md:text-base">Charged to</span>
          {(
            [
              { v: 'UNIT', title: 'The paying unit’s own P&L', hint: 'The tag is for reporting: what this centre spent, by category and month.' },
              {
                v: 'PARTNER',
                title: 'A partner’s profit',
                hint: 'Paid out of the unit’s cash but charged to the partner: their capital & current account is debited and their profit reserve in the unit released, like a drawing. The unit’s P&L is untouched.',
              },
            ] as const
          ).map((o) => (
            <label
              key={o.v}
              className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${chargeTo === o.v ? 'border-accent bg-accent-soft/40' : 'border-gray-200'} ${
                (o.v === 'PARTNER' && !isPartner) || locked ? 'cursor-not-allowed opacity-60' : ''
              }`}
            >
              <input
                type="radio"
                name="chargeTo"
                className="mt-1"
                checked={chargeTo === o.v}
                disabled={(o.v === 'PARTNER' && !isPartner) || locked}
                onChange={() => setChargeTo(o.v)}
              />
              <span>
                <span className="block text-sm font-medium text-gray-900">{o.title}</span>
                <span className="block text-xs text-gray-600">{o.hint}</span>
                {o.v === 'PARTNER' && !isPartner && <span className="block text-xs text-gray-500">Only a Partner can set this.</span>}
              </span>
            </label>
          ))}
        </div>
        {chargeTo === 'PARTNER' && (
          <Select
            label="Partner"
            required
            value={partnerId}
            onChange={setPartnerId}
            placeholder="Choose a partner"
            options={partners.map((p) => ({ label: `${p.name} (${p.shortName})`, value: p.id }))}
          />
        )}
        <Select
          label="Used by"
          value={unitId}
          onChange={setUnitId}
          options={[{ label: 'Any unit', value: '' }, ...units.map((u) => ({ label: `${u.name} (${u.code}) only`, value: u.id }))]}
        />
        {centre && (
          <label className="flex items-center gap-2 text-sm text-gray-800">
            <input type="checkbox" checked={active} disabled={locked} onChange={(e) => setActive(e.target.checked)} />
            Active — can be picked on new entries
          </label>
        )}
      </div>
    </Modal>
  );
}
