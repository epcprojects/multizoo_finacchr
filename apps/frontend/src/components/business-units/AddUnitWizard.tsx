'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import Modal, { ModalPosition } from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';
import { CheckedBoxIcon, UncheckedBoxIcon } from '../ui/icons';
import {
  createBusinessUnit,
  getUnitTemplates,
  UNIT_TYPE_LABELS,
  type BusinessUnitRecord,
  type BusinessUnitType,
} from '../../lib/api/ledger';
import { errorMessage, formatMoney, isAmount, todayIso, toPaisa } from '../../lib/money';

const STEPS = ['Details', 'Reserves', 'Opening balances'] as const;

type AddUnitWizardProps = {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (unit: BusinessUnitRecord) => void;
  units: BusinessUnitRecord[];
};

function suggestCode(name: string) {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .split(' ')
    .filter(Boolean)
    .map((w, i, all) => (all.length === 1 ? w.slice(0, 8) : w[0]))
    .join('')
    .slice(0, 12);
}

/**
 * "Adding a business unit is a wizard, not a migration" — architecture plan
 * Part 04. Provisions cash / bank / wallet, the chosen reserve buckets, and
 * optional opening balances in one step.
 */
export default function AddUnitWizard({ isOpen, onClose, onCreated, units }: AddUnitWizardProps) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [type, setType] = useState<BusinessUnitType>('RETAIL');
  const [description, setDescription] = useState('');
  const [catalog, setCatalog] = useState<string[]>([]);
  const [copyFrom, setCopyFrom] = useState('');
  const [buckets, setBuckets] = useState<string[]>([]);
  const [customBucket, setCustomBucket] = useState('');
  const [asOfDate, setAsOfDate] = useState(todayIso());
  const [cash, setCash] = useState('');
  const [bank, setBank] = useState('');
  const [wallet, setWallet] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setStep(0);
    setName('');
    setCode('');
    setCodeTouched(false);
    setType('RETAIL');
    setDescription('');
    setCopyFrom('');
    setBuckets([]);
    setCustomBucket('');
    setAsOfDate(todayIso());
    setCash('');
    setBank('');
    setWallet('');
    setError(null);
    void getUnitTemplates()
      .then((t) => setCatalog(t.reserveCatalog))
      .catch(() => setCatalog([]));
  }, [isOpen]);

  useEffect(() => {
    if (!codeTouched) setCode(suggestCode(name));
  }, [name, codeTouched]);

  useEffect(() => {
    const source = units.find((u) => u.id === copyFrom);
    if (source) setBuckets(source.reserveBuckets);
  }, [copyFrom, units]);

  const isHolding = type === 'HOLDING';
  const allBuckets = [...new Set([...catalog, ...buckets])];

  function toggle(bucket: string) {
    setBuckets((b) => (b.includes(bucket) ? b.filter((x) => x !== bucket) : [...b, bucket]));
  }

  function next() {
    setError(null);
    if (step === 0) {
      if (name.trim().length < 2) return setError('Give the unit a name.');
      if (!/^[A-Z][A-Z0-9]{1,11}$/.test(code)) {
        return setError('The code must be 2–12 letters/digits and start with a letter — e.g. KIOSK.');
      }
      if (units.some((u) => u.code === code)) return setError(`Code ${code} is already used.`);
    }
    setStep((s) => s + 1);
  }

  async function create() {
    setError(null);
    for (const [label, value] of [['Cash', cash], ['Bank', bank], ['Wallet', wallet]] as const) {
      if (value && !isAmount(value)) return setError(`${label}: up to 2 decimal places.`);
    }
    const hasOpening = [cash, bank, wallet].some((v) => v && toPaisa(v) > 0n);
    setSubmitting(true);
    try {
      const unit = await createBusinessUnit({
        code,
        name: name.trim(),
        type,
        description: description.trim() || undefined,
        reserveBuckets: isHolding ? [] : buckets,
        openingBalances: hasOpening
          ? {
              asOfDate,
              cash: isHolding ? undefined : cash || undefined,
              bank: bank || undefined,
              wallet: isHolding ? undefined : wallet || undefined,
            }
          : undefined,
      });
      onCreated(unit);
    } catch (err) {
      setError(errorMessage(err, 'Could not create the business unit.'));
    } finally {
      setSubmitting(false);
    }
  }

  const accountsPreview = [
    ...(isHolding ? ['Bank Account'] : ['Cash in Hand', 'Bank Account', 'Easypaisa Wallet']),
    ...(isHolding ? [] : buckets.map((b) => `${b} Reserve`)),
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add Business Unit"
      subtitle="Sets up the unit and its full standard account set in one step."
      position={ModalPosition.RIGHT}
      outsideClickClose={false}
    >
      <div className="flex h-full flex-col gap-5">
        <ol className="flex gap-2">
          {STEPS.map((label, i) => (
            <li
              key={label}
              className={clsx(
                'flex flex-1 flex-col gap-1 border-t-2 pt-2 text-xs font-medium',
                i <= step ? 'border-accent text-accent' : 'border-gray-200 text-gray-400',
              )}
            >
              Step {i + 1}
              <span className={clsx('text-sm', i <= step ? 'text-gray-900' : 'text-gray-400')}>{label}</span>
            </li>
          ))}
        </ol>

        {error && (
          <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}

        {step === 0 && (
          <div className="flex flex-col gap-4">
            <Input label="Unit name" required placeholder="e.g. Panda Cafe — Airport Kiosk" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
            <Input
              label="Short code"
              required
              value={code}
              maxLength={12}
              helperText="Prefixes every account in this unit (e.g. KIOSK-1100 Cash in Hand). It can't be changed later."
              onChange={(e) => {
                setCodeTouched(true);
                setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
              }}
            />
            <Select
              label="Type of business"
              required
              value={type}
              onChange={(v) => setType(v as BusinessUnitType)}
              options={(Object.keys(UNIT_TYPE_LABELS) as BusinessUnitType[]).map((t) => ({ label: UNIT_TYPE_LABELS[t], value: t }))}
            />
            <Input label="Description" placeholder="Optional" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-4">
            {isHolding ? (
              <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
                A holding company only gets a bank account — it has no daily income to allocate into reserves.
              </p>
            ) : (
              <>
                <p className="text-sm text-gray-600">
                  Reserves are pots of cash earmarked for a purpose — the buckets each day&apos;s income is split into.
                  The percentages themselves are set later in the allocation rules.
                </p>
                <Select
                  label="Start from an existing unit"
                  showSearch
                  placeholder="Start blank"
                  value={copyFrom}
                  onChange={setCopyFrom}
                  options={[
                    { label: 'Start blank', value: '' },
                    ...units.filter((u) => u.reserveBuckets.length).map((u) => ({ label: `${u.name} (${u.reserveBuckets.length} reserves)`, value: u.id })),
                  ]}
                />
                <div className="flex flex-wrap gap-2">
                  {allBuckets.map((b) => {
                    const on = buckets.includes(b);
                    return (
                      <button
                        key={b}
                        type="button"
                        onClick={() => toggle(b)}
                        className={clsx(
                          'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm',
                          on ? 'border-accent bg-accent-soft text-accent' : 'border-gray-200 text-gray-700 hover:bg-gray-50',
                        )}
                      >
                        {on ? <CheckedBoxIcon width="14" height="14" /> : <UncheckedBoxIcon width="14" height="14" />}
                        {b}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-end gap-2">
                  <Input
                    label="Add another reserve"
                    placeholder="e.g. Party Fund"
                    value={customBucket}
                    maxLength={40}
                    onChange={(e) => setCustomBucket(e.target.value)}
                  />
                  <Button
                    variant="secondary"
                    disabled={!customBucket.trim()}
                    onClick={() => {
                      const b = customBucket.trim();
                      if (b && !buckets.includes(b)) setBuckets((x) => [...x, b]);
                      setCustomBucket('');
                    }}
                  >
                    Add
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-600">
              If this unit already holds money, enter it here — it&apos;s posted as an opening balance entry. Leave blank to
              start at zero.
            </p>
            <Input label="Balances as of" type="date" value={asOfDate} max={todayIso()} onChange={(e) => setAsOfDate(e.target.value)} />
            <div className="grid gap-4 sm:grid-cols-3">
              {!isHolding && (
                <Input label="Cash in hand" inputMode="decimal" placeholder="0.00" value={cash} onChange={(e) => setCash(e.target.value.replace(/[^\d.]/g, ''))} />
              )}
              <Input label="Bank" inputMode="decimal" placeholder="0.00" value={bank} onChange={(e) => setBank(e.target.value.replace(/[^\d.]/g, ''))} />
              {!isHolding && (
                <Input label="Easypaisa" inputMode="decimal" placeholder="0.00" value={wallet} onChange={(e) => setWallet(e.target.value.replace(/[^\d.]/g, ''))} />
              )}
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <p className="mb-2 text-sm font-semibold text-gray-900">
                {name} ({code}) will get {accountsPreview.length} accounts
              </p>
              <ul className="grid grid-cols-1 gap-1 text-sm text-gray-700 sm:grid-cols-2">
                {accountsPreview.map((a) => (
                  <li key={a}>• {a}</li>
                ))}
              </ul>
              {[cash, bank, wallet].some((v) => v && isAmount(v) && toPaisa(v) > 0n) && (
                <p className="mt-2 text-xs text-gray-600">
                  Opening total{' '}
                  {formatMoney(
                    [cash, bank, wallet].reduce((s, v) => s + (v && isAmount(v) ? toPaisa(v) : 0n), 0n),
                  )}{' '}
                  against Opening Balance Equity.
                </p>
              )}
            </div>
          </div>
        )}

        <div className="mt-auto flex justify-between gap-2 border-t border-gray-200 pt-4">
          <Button variant="secondary" onClick={() => (step ? setStep((s) => s - 1) : onClose())} disabled={submitting}>
            {step ? 'Back' : 'Cancel'}
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={next}>Next</Button>
          ) : (
            <Button onClick={create} disabled={submitting}>
              {submitting ? 'Creating…' : 'Create unit'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
