'use client';

import { useEffect, useMemo, useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { TextArea } from '../hr/ui';
import { BONUS_TIER_LABELS, EMPLOYMENT_TYPE_LABELS, EMPLOYMENT_TYPES, type BonusTier, type EmploymentType } from '../../lib/api/hr';
import {
  SPLIT_LABELS,
  createPayrollPolicy,
  type BonusSplit,
  type PayrollPolicyPayload,
  type PayrollPolicyRecord,
} from '../../lib/api/payroll';
import { errorMessage, formatDate, formatMoney, isAmount, todayIso, toPaisa } from '../../lib/money';

const PCT = /^\d{1,3}(\.\d{1,2})?$/;
const TIERS: BonusTier[] = ['SUPERVISOR', 'TICKETER', 'WORKER', 'MANAGER'];

type TierRow = { tier: BonusTier; included: boolean; pct: string; split: BonusSplit; roundUp: boolean; unitLabel: string };
type Form = Omit<PayrollPolicyPayload, 'bonusTiers' | 'daysPerMonth' | 'effectiveFrom'> & { daysPerMonth: string; tiers: TierRow[] };

function fromPolicy(p: PayrollPolicyRecord | null): Form {
  return {
    note: '',
    daysPerMonth: String(p?.daysPerMonth ?? 30),
    eobiEnabled: p?.eobiEnabled ?? false,
    eobiMinimumWage: p?.eobiMinimumWage ?? '40700.00',
    eobiEmployeePct: p?.eobiEmployeePct ?? '1',
    eobiEmployerPct: p?.eobiEmployerPct ?? '5',
    eobiEmploymentTypes: p?.eobiEmploymentTypes ?? ['PERMANENT', 'CONTRACT'],
    taxEnabled: p?.taxEnabled ?? false,
    taxBands: p?.taxBands ?? [{ from: '0.00', rate: '0' }],
    pfEnabled: p?.pfEnabled ?? false,
    pfEmployeePct: p?.pfEmployeePct ?? '0',
    pfEmployerPct: p?.pfEmployerPct ?? '0',
    commissionPct: p?.commissionPct ?? '5',
    tiers: TIERS.map((tier) => {
      const t = p?.bonusTiers.find((x) => x.tier === tier);
      return { tier, included: Boolean(t), pct: t?.pct ?? '0', split: t?.split ?? 'EQUAL', roundUp: t?.roundUp ?? false, unitLabel: t?.unitLabel ?? 'trips' };
    }),
  };
}

function describe(f: Form): Record<string, string> {
  const onOff = (on: boolean, text: string) => (on ? text : 'off');
  return {
    'A day’s pay': `salary ÷ ${f.daysPerMonth}`,
    EOBI: onOff(f.eobiEnabled, `${f.eobiEmployeePct}% employee + ${f.eobiEmployerPct}% employer of ${formatMoney(f.eobiMinimumWage, { decimals: false })}, for ${f.eobiEmploymentTypes.map((t) => EMPLOYMENT_TYPE_LABELS[t].toLowerCase()).join(', ')}`),
    'Income tax': onOff(f.taxEnabled, f.taxBands.map((b) => `${b.rate}% from ${formatMoney(b.from, { decimals: false, prefix: false })}`).join(', ')),
    'Provident fund': onOff(f.pfEnabled, `${f.pfEmployeePct}% employee + ${f.pfEmployerPct}% employer`),
    'Commission pool': `${f.commissionPct}% of qualifying sales`,
    ...Object.fromEntries(
      f.tiers.map((t) => [
        `${BONUS_TIER_LABELS[t.tier]}s`,
        t.included ? `${t.pct}% of the pool, ${t.split === 'EQUAL' ? 'per person' : `by ${t.unitLabel}`}${t.roundUp ? ', rounded up' : ''}` : 'not in the pool',
      ]),
    ),
  };
}

function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm font-semibold text-gray-900">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/**
 * Publish a new payroll policy version (Fig. 16): statutory rates and the
 * commission pool's tiers. Months already paid keep the version they were
 * paid on.
 */
export default function PayrollPolicyModal({
  isOpen,
  current,
  onClose,
  onSaved,
}: {
  isOpen: boolean;
  current: PayrollPolicyRecord | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [form, setForm] = useState<Form>(fromPolicy(current));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const [y, m] = todayIso().split('-').map(Number);
    setEffectiveFrom(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10));
    setForm(fromPolicy(current));
    setError(null);
  }, [isOpen, current]);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const setTier = (i: number, patch: Partial<TierRow>) => set({ tiers: form.tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const setBand = (i: number, patch: Partial<{ from: string; rate: string }>) =>
    set({ taxBands: form.taxBands.map((b, j) => (j === i ? { ...b, ...patch } : b)) });

  const tierTotal = form.tiers.filter((t) => t.included).reduce((s, t) => s + (PCT.test(t.pct) ? toPaisa(t.pct) : 0n), 0n);
  const changes = useMemo(() => {
    const before = describe(fromPolicy(current));
    const after = describe(form);
    return Object.keys(after)
      .filter((k) => before[k] !== after[k])
      .map((k) => `${k}: ${before[k]} → ${after[k]}`);
  }, [form, current]);

  async function submit() {
    setError(null);
    if (effectiveFrom < todayIso()) return setError('A new version starts today at the earliest.');
    const pcts = [form.eobiEmployeePct, form.eobiEmployerPct, form.pfEmployeePct, form.pfEmployerPct, form.commissionPct, ...form.taxBands.map((b) => b.rate)];
    if (pcts.some((p) => !PCT.test(p))) return setError('Percentages are numbers with at most 2 decimals.');
    if (!isAmount(form.eobiMinimumWage)) return setError('Enter the minimum wage EOBI is charged on.');
    if (form.taxBands.some((b) => !isAmount(b.from))) return setError('Each tax band starts at an amount.');
    const included = form.tiers.filter((t) => t.included);
    if (!included.length) return setError('Keep at least one tier in the pool.');
    if (tierTotal !== 10_000n) return setError('The tiers must share out exactly 100% of the pool.');
    if (!changes.length) return setError('Nothing has changed from the version in force.');
    setSaving(true);
    try {
      const res = await createPayrollPolicy({
        effectiveFrom,
        note: form.note?.trim() || undefined,
        daysPerMonth: Number(form.daysPerMonth) || 30,
        eobiEnabled: form.eobiEnabled,
        eobiMinimumWage: form.eobiMinimumWage,
        eobiEmployeePct: form.eobiEmployeePct,
        eobiEmployerPct: form.eobiEmployerPct,
        eobiEmploymentTypes: form.eobiEmploymentTypes,
        taxEnabled: form.taxEnabled,
        taxBands: form.taxBands,
        pfEnabled: form.pfEnabled,
        pfEmployeePct: form.pfEmployeePct,
        pfEmployerPct: form.pfEmployerPct,
        commissionPct: form.commissionPct,
        bonusTiers: included.map((t) => ({ tier: t.tier, pct: t.pct, split: t.split, roundUp: t.roundUp, unitLabel: t.split === 'BY_UNITS' ? t.unitLabel : undefined })),
      });
      onSaved(`Payroll policy v${res.version} published from ${formatDate(effectiveFrom)}${res.replaced.length ? ` — it replaces v${res.replaced.join(', v')}, which hadn’t started` : ''}.`);
    } catch (err) {
      setError(errorMessage(err, 'Could not publish the policy.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="New payroll policy"
      subtitle={
        current
          ? `Starting from v${current.version}, ${current.isUpcoming ? 'which starts' : 'in force since'} ${formatDate(current.effectiveFrom)}`
          : ''
      }
      size="extraLarge"
      showFooter
      onConfirm={submit}
      confirmLabel={saving ? 'Publishing…' : 'Publish version'}
      confirmDisabled={saving}
    >
      <div className="flex flex-col gap-5">
        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <div className="grid gap-4 md:grid-cols-3">
          <Input
            label="Starts on"
            type="date"
            required
            value={effectiveFrom}
            min={todayIso()}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            helperText="A month is paid on the version in force on its last day."
          />
          <Input
            label="A day’s pay = salary ÷"
            type="number"
            min={28}
            max={31}
            value={form.daysPerMonth}
            onChange={(e) => set({ daysPerMonth: e.target.value })}
            helperText="The salary sheet uses 30, whatever the month."
          />
        </div>

        <div className="rounded-xl border border-gray-200 p-3">
          <Toggle on={form.eobiEnabled} label="EOBI" onChange={(v) => set({ eobiEnabled: v })} />
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Input label="Minimum wage (Rs / month)" value={form.eobiMinimumWage} onChange={(e) => set({ eobiMinimumWage: e.target.value })} />
            <Input label="Employee %" value={form.eobiEmployeePct} onChange={(e) => set({ eobiEmployeePct: e.target.value })} />
            <Input label="Employer %" value={form.eobiEmployerPct} onChange={(e) => set({ eobiEmployerPct: e.target.value })} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-800">
            <span className="text-gray-500">Registered:</span>
            {EMPLOYMENT_TYPES.map((t) => (
              <label key={t} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.eobiEmploymentTypes.includes(t)}
                  onChange={(e) =>
                    set({
                      eobiEmploymentTypes: e.target.checked
                        ? [...form.eobiEmploymentTypes, t]
                        : form.eobiEmploymentTypes.filter((x: EmploymentType) => x !== t),
                    })
                  }
                />
                {EMPLOYMENT_TYPE_LABELS[t]}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-600">Charged on the notified minimum wage (the higher of federal or provincial), not on the salary.</p>
        </div>

        <div className="rounded-xl border border-gray-200 p-3">
          <Toggle on={form.taxEnabled} label="Income tax withholding" onChange={(v) => set({ taxEnabled: v })} />
          <p className="mt-1 text-xs text-gray-600">Each band’s rate applies only to the annual income inside it; a month withholds a twelfth of the year’s tax on that month’s pay × 12.</p>
          <div className="mt-3 flex flex-col gap-2">
            {form.taxBands.map((b, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <Input label={i === 0 ? 'From (Rs a year)' : undefined} value={b.from} disabled={i === 0} onChange={(e) => setBand(i, { from: e.target.value })} />
                <Input label={i === 0 ? 'Rate %' : undefined} value={b.rate} onChange={(e) => setBand(i, { rate: e.target.value })} />
                <button
                  type="button"
                  disabled={i === 0}
                  className="mb-2 rounded-md px-2 text-sm text-gray-500 hover:text-danger disabled:opacity-0"
                  onClick={() => set({ taxBands: form.taxBands.filter((_, j) => j !== i) })}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="self-start text-sm font-medium text-accent"
              onClick={() => set({ taxBands: [...form.taxBands, { from: '', rate: '' }] })}
            >
              + Add a band
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 p-3">
          <Toggle on={form.pfEnabled} label="Provident fund" onChange={(v) => set({ pfEnabled: v })} />
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input label="Employee % of salary" value={form.pfEmployeePct} onChange={(e) => set({ pfEmployeePct: e.target.value })} />
            <Input label="Employer % of salary" value={form.pfEmployerPct} onChange={(e) => set({ pfEmployerPct: e.target.value })} />
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 p-3">
          <p className="text-sm font-semibold text-gray-900">Commission pool</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Input
              label="Pool = % of qualifying sales"
              value={form.commissionPct}
              onChange={(e) => set({ commissionPct: e.target.value })}
              helperText="Rounded down to the rupee."
            />
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {form.tiers.map((t, i) => (
              <div key={t.tier} className="grid items-end gap-2 rounded-lg bg-gray-50 p-2 sm:grid-cols-[10rem_6rem_1fr_7rem]">
                <label className="flex items-center gap-2 pb-2 text-sm font-medium text-gray-900">
                  <input type="checkbox" checked={t.included} onChange={(e) => setTier(i, { included: e.target.checked })} />
                  {BONUS_TIER_LABELS[t.tier]}s
                </label>
                <Input label="% of pool" value={t.pct} disabled={!t.included} onChange={(e) => setTier(i, { pct: e.target.value })} />
                <div className="grid grid-cols-[1fr_7rem] gap-2">
                  <Select
                    label="Shared"
                    value={t.split}
                    onChange={(v) => setTier(i, { split: v as BonusSplit })}
                    options={(Object.keys(SPLIT_LABELS) as BonusSplit[]).map((k) => ({ label: SPLIT_LABELS[k], value: k }))}
                  />
                  <Input label="Counting" value={t.unitLabel} disabled={t.split !== 'BY_UNITS'} onChange={(e) => setTier(i, { unitLabel: e.target.value })} />
                </div>
                <label className="flex items-center gap-2 pb-2 text-sm text-gray-800">
                  <input type="checkbox" checked={t.roundUp} disabled={!t.included} onChange={(e) => setTier(i, { roundUp: e.target.checked })} />
                  Round up
                </label>
              </div>
            ))}
            <p className={tierTotal === 10_000n ? 'text-xs text-gray-600' : 'text-xs font-medium text-danger'}>
              The tiers share out {String(Number(tierTotal) / 100)}% of the pool{tierTotal === 10_000n ? '.' : ' — it must be exactly 100%.'} “Round up” pays each person a
              whole rupee rounded up, as the Bonus Calculator’s CEILING does.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm">
          <p className="mb-1 font-semibold text-gray-900">What changes</p>
          {changes.length ? (
            <ul className="list-disc space-y-1 pl-5 text-gray-700">
              {changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500">Nothing yet.</p>
          )}
        </div>
        <TextArea label="Why the change" value={form.note ?? ''} onChange={(v) => set({ note: v })} rows={2} placeholder="e.g. EOBI confirmed by the accountant, registered from October." />
      </div>
    </Modal>
  );
}
