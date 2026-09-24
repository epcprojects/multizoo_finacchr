'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import Modal, { ModalPosition } from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';
import UnitTypeSelect from './UnitTypeSelect';
import { CheckedBoxIcon, UncheckedBoxIcon } from '../ui/icons';
import {
  createBusinessUnit,
  getUnitTemplates,
  type BusinessUnitRecord,
  type UnitTemplates,
} from '../../lib/api/ledger';
import { errorMessage, formatMoney, isAmount, todayIso, toPaisa } from '../../lib/money';

const STEPS = ['Details', 'Accounts', 'Opening balances'] as const;

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
 * Part 04. Which accounts a new unit gets comes from the account classes
 * marked "create for new units" (Accounts → Settings), adjustable here.
 */
export default function AddUnitWizard({ isOpen, onClose, onCreated, units }: AddUnitWizardProps) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [typeId, setTypeId] = useState('');
  const [isHolding, setIsHolding] = useState(false);
  const [description, setDescription] = useState('');
  const [templates, setTemplates] = useState<UnitTemplates>({ reserveCatalog: [], provisionableClasses: [] });
  const [classIds, setClassIds] = useState<string[]>([]);
  const [copyFrom, setCopyFrom] = useState('');
  const [buckets, setBuckets] = useState<string[]>([]);
  const [customBucket, setCustomBucket] = useState('');
  const [asOfDate, setAsOfDate] = useState(todayIso());
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setStep(0);
    setName('');
    setCode('');
    setCodeTouched(false);
    setTypeId('');
    setIsHolding(false);
    setDescription('');
    setCopyFrom('');
    setBuckets([]);
    setCustomBucket('');
    setAsOfDate(todayIso());
    setAmounts({});
    setError(null);
    void getUnitTemplates()
      .then((t) => {
        setTemplates(t);
        setClassIds(t.provisionableClasses.filter((c) => c.byDefault).map((c) => c.id));
      })
      .catch(() => undefined);
  }, [isOpen]);

  useEffect(() => {
    if (!codeTouched) setCode(suggestCode(name));
  }, [name, codeTouched]);

  // A holding / non-trading type has no till: default it to a bank account only.
  useEffect(() => {
    const classes = templates.provisionableClasses;
    setClassIds(
      isHolding
        ? classes.filter((c) => c.key === 'BANK').map((c) => c.id)
        : classes.filter((c) => c.byDefault).map((c) => c.id),
    );
  }, [isHolding, templates]);

  useEffect(() => {
    const source = units.find((u) => u.id === copyFrom);
    if (source) setBuckets(source.reserveBuckets);
  }, [copyFrom, units]);

  const allBuckets = [...new Set([...templates.reserveCatalog, ...buckets])];
  const chosen = templates.provisionableClasses.filter((c) => classIds.includes(c.id));
  const liquidChosen = chosen.filter((c) => c.isLiquid);

  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  function next() {
    setError(null);
    if (step === 0) {
      if (name.trim().length < 2) return setError('Give the unit a name.');
      if (!/^[A-Z][A-Z0-9]{1,11}$/.test(code)) {
        return setError('The code must be 2–12 letters/digits and start with a letter — e.g. KIOSK.');
      }
      if (units.some((u) => u.code === code)) return setError(`Code ${code} is already used.`);
      if (!typeId) return setError('Choose the type of business.');
    }
    setStep((s) => s + 1);
  }

  async function create() {
    setError(null);
    const opening = liquidChosen
      .map((c) => ({ classId: c.id, amount: (amounts[c.id] ?? '').trim() }))
      .filter((a) => a.amount);
    const bad = opening.find((a) => !isAmount(a.amount));
    if (bad) return setError('Opening amounts may have at most 2 decimal places.');
    const nonZero = opening.filter((a) => toPaisa(a.amount) > 0n);

    setSubmitting(true);
    try {
      const unit = await createBusinessUnit({
        code,
        name: name.trim(),
        typeId,
        description: description.trim() || undefined,
        accountClassIds: classIds,
        reserveBuckets: isHolding ? [] : buckets,
        openingBalances: nonZero.length ? { asOfDate, amounts: nonZero } : undefined,
      });
      onCreated(unit);
    } catch (err) {
      setError(errorMessage(err, 'Could not create the business unit.'));
    } finally {
      setSubmitting(false);
    }
  }

  const accountsPreview = [
    ...chosen.map((c) => c.accountName),
    ...(isHolding ? [] : buckets.map((b) => `${b} Reserve`)),
  ];
  const openingTotal = liquidChosen.reduce(
    (s, c) => s + (isAmount(amounts[c.id] ?? '') ? toPaisa(amounts[c.id]) : 0n),
    0n,
  );

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
              helperText="Used in this unit's account codes (e.g. KIOSK-1100 Cash in Hand). Can be changed later from Edit."
              onChange={(e) => {
                setCodeTouched(true);
                setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
              }}
            />
            <UnitTypeSelect
              value={typeId}
              canAdd
              onChange={(id, t) => {
                setTypeId(id);
                setIsHolding(Boolean(t?.isHolding));
              }}
              onLoaded={(types) => {
                // Default to Retail (or the first type) the first time the list loads.
                if (typeId) return;
                const first = types.find((t) => t.key === 'RETAIL') ?? types[0];
                if (first) {
                  setTypeId(first.id);
                  setIsHolding(first.isHolding);
                }
              }}
            />
            <Input label="Description" placeholder="Optional" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-5">
            <div>
              <p className="mb-2 text-sm font-semibold text-gray-900">Standard accounts</p>
              <p className="mb-3 text-xs text-gray-600">
                Pre-ticked from the classes marked “create for new units” in Accounts → Settings.
              </p>
              <div className="flex flex-col gap-2">
                {templates.provisionableClasses.map((c) => {
                  const on = classIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setClassIds((x) => toggle(x, c.id))}
                      className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-left hover:bg-gray-50"
                    >
                      {on ? <CheckedBoxIcon /> : <UncheckedBoxIcon />}
                      <span className="text-sm text-gray-900">{c.accountName}</span>
                      <span className="text-xs text-gray-500">{c.name}{c.isLiquid ? ' · money on hand' : ''}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {isHolding ? (
              <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
                A holding company has no daily income to allocate, so it gets no reserves.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Reserves</p>
                  <p className="text-xs text-gray-600">
                    Pots of cash earmarked for a purpose — the buckets each day&apos;s income is split into. The
                    percentages are set later in the allocation rules.
                  </p>
                </div>
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
                        onClick={() => setBuckets((x) => toggle(x, b))}
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
                  <Input label="Add another reserve" placeholder="e.g. Party Fund" value={customBucket} maxLength={40} onChange={(e) => setCustomBucket(e.target.value)} />
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
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-600">
              If this unit already holds money, enter it here — it&apos;s posted as an opening balance entry. Leave blank to
              start at zero.
            </p>
            {liquidChosen.length ? (
              <>
                <Input label="Balances as of" type="date" value={asOfDate} max={todayIso()} onChange={(e) => setAsOfDate(e.target.value)} />
                <div className="grid gap-4 sm:grid-cols-3">
                  {liquidChosen.map((c) => (
                    <Input
                      key={c.id}
                      label={c.accountName}
                      inputMode="decimal"
                      placeholder="0.00"
                      value={amounts[c.id] ?? ''}
                      onChange={(e) => setAmounts((a) => ({ ...a, [c.id]: e.target.value.replace(/[^\d.]/g, '') }))}
                    />
                  ))}
                </div>
              </>
            ) : (
              <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">No money-on-hand accounts were chosen.</p>
            )}
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <p className="mb-2 text-sm font-semibold text-gray-900">
                {name} ({code}) will get {accountsPreview.length} accounts
              </p>
              <ul className="grid grid-cols-1 gap-1 text-sm text-gray-700 sm:grid-cols-2">
                {accountsPreview.map((a) => (
                  <li key={a}>• {a}</li>
                ))}
              </ul>
              {openingTotal > 0n && (
                <p className="mt-2 text-xs text-gray-600">
                  Opening total {formatMoney(openingTotal)} against Opening Balance Equity.
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
