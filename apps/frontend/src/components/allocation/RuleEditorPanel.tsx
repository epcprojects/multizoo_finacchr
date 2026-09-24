'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import Modal, { ModalPosition } from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';
import { PlusIcon, TrashIcon } from '../ui/icons';
import RulePreviewPanel from './RulePreviewPanel';
import { TRANCHE_COLORS, TrancheBar } from './RuleWaterfall';
import { listAccounts, type AccountRecord } from '../../lib/api/ledger';
import {
  createAllocationRule,
  listAllocationRules,
  listPartners,
  ruleAction,
  updateAllocationRule,
  type AllocationMethod,
  type AllocationRuleRecord,
  type PartnerRecord,
  type RuleTranchePayload,
} from '../../lib/api/allocation';
import { errorMessage, formatDate, todayIso } from '../../lib/money';

type LineDraft = { key: number; target: string; weight: string };
type TrancheDraft = { key: number; name: string; share: string; method: AllocationMethod; lines: LineDraft[] };

let nextKey = 1;
const k = () => nextKey++;

/** Browser twin of the API's scaled percentages: "33.3333" → 333333n. */
function scaled(value: string): bigint | null {
  const text = value.trim();
  if (!/^\d{1,6}(\.\d{1,4})?$/.test(text)) return null;
  const [w, f = ''] = text.split('.');
  return BigInt(w) * 10000n + BigInt(f.padEnd(4, '0'));
}
function unscaled(v: bigint) {
  const f = (v % 10000n).toString().padStart(4, '0').replace(/0+$/, '');
  return f ? `${v / 10000n}.${f}` : `${v / 10000n}`;
}
const HUNDRED = 1000000n;

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function fromRule(rule: Pick<AllocationRuleRecord, 'tranches'>): TrancheDraft[] {
  return rule.tranches.map((t) => ({
    key: k(),
    name: t.name,
    share: t.share,
    method: t.method,
    lines: t.lines.map((l) => ({ key: k(), target: `${l.targetType}:${l.accountId ?? l.partnerId}`, weight: l.weight })),
  }));
}

function toPayload(tranches: TrancheDraft[]): RuleTranchePayload[] {
  return tranches.map((t) => ({
    name: t.name.trim(),
    share: t.share.trim(),
    method: t.method,
    lines: t.lines
      .filter((l) => l.target)
      .map((l) => {
        const [type, id] = l.target.split(':');
        return type === 'PARTNER'
          ? { targetType: 'PARTNER' as const, partnerId: id, weight: l.weight.trim() }
          : { targetType: 'RESERVE' as const, accountId: id, weight: l.weight.trim() };
      }),
  }));
}

/** The same checks the API makes, in the same words, while typing. */
function problemsOf(tranches: TrancheDraft[]): string[] {
  const out: string[] = [];
  if (!tranches.length) return ['Add at least one tranche.'];
  let total = 0n;
  tranches.forEach((t, i) => {
    const name = t.name.trim() || `Tranche ${i + 1}`;
    const share = scaled(t.share);
    if (share === null || share <= 0n || share > HUNDRED) out.push(`${name}: enter a share between 0 and 100%.`);
    total += share ?? 0n;
    if (!t.lines.length) out.push(`${name}: add at least one line.`);
    let sum = 0n;
    const seen = new Set<string>();
    t.lines.forEach((l) => {
      if (!l.target) out.push(`${name}: choose where every line goes.`);
      else if (seen.has(l.target)) out.push(`${name}: the same destination appears twice — combine them.`);
      seen.add(l.target);
      const w = scaled(l.weight);
      if (w === null || w <= 0n) out.push(`${name}: every line needs a number above 0 (up to 4 decimals).`);
      sum += w ?? 0n;
    });
    if (t.method === 'PERCENT' && sum !== HUNDRED) out.push(`${name}: the lines add up to ${unscaled(sum)}% — they must total exactly 100%.`);
  });
  if (total !== HUNDRED) out.push(`The tranches take ${unscaled(total)}% of income — together they must take exactly 100%.`);
  return [...new Set(out)];
}

type RuleEditorPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  unit: { id: string; code: string; name: string };
  /** A draft to keep editing (mode "edit"), or a version to start from (mode "new"). */
  base: AllocationRuleRecord | null;
  mode: 'new' | 'edit';
  /** The day after the last allocated day — nothing earlier can change. */
  earliestStart: string;
  canApprove: boolean;
  onSaved: (rule: AllocationRuleRecord) => void;
};

/**
 * Propose (Accountant) or make (Partner) a new version of a unit's
 * waterfall. Every change previews live against a sample day and the last
 * month of real income before anything is saved; nothing here edits an
 * approved version — it always becomes a new one from a future date.
 */
export default function RuleEditorPanel({
  isOpen,
  onClose,
  unit,
  base,
  mode,
  earliestStart,
  canApprove,
  onSaved,
}: RuleEditorPanelProps) {
  const [tranches, setTranches] = useState<TrancheDraft[]>([]);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [note, setNote] = useState('');
  const [reserves, setReserves] = useState<AccountRecord[]>([]);
  const [partners, setPartners] = useState<PartnerRecord[]>([]);
  const [otherRules, setOtherRules] = useState<AllocationRuleRecord[]>([]);
  const [copyFrom, setCopyFrom] = useState('');
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const [serverProblems, setServerProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<null | 'draft' | 'submit' | 'publish'>(null);

  useEffect(() => {
    if (!isOpen) return;
    setTranches(
      base
        ? fromRule(base)
        : [{ key: k(), name: 'Operations & reserves', share: '100', method: 'PERCENT', lines: [{ key: k(), target: '', weight: '100' }] }],
    );
    const tomorrow = addDays(todayIso(), 1);
    setEffectiveFrom(mode === 'edit' && base ? base.effectiveFrom : earliestStart > tomorrow ? earliestStart : tomorrow);
    setNote(mode === 'edit' && base ? (base.note ?? '') : '');
    setCopyFrom('');
    setCopyNote(null);
    setError(null);
    setServerProblems([]);
    void Promise.all([
      listAccounts({ businessUnitId: unit.id }),
      listPartners(),
      listAllocationRules({ status: 'APPROVED' }),
    ]).then(([accounts, p, rules]) => {
      setReserves(accounts.filter((a) => a.reserveKind === 'BUCKET' && a.isActive && a.businessUnit?.id === unit.id));
      setPartners(p.filter((x) => x.isActive));
      setOtherRules(rules.filter((r) => r.isCurrent && r.businessUnitId !== unit.id));
    });
  }, [isOpen, base, mode, unit.id, earliestStart]);

  const targetOptions = useMemo(
    () => [
      ...reserves.map((a) => ({ label: a.name, value: `RESERVE:${a.id}` })),
      ...partners.map((p) => ({ label: `${p.name} (partner · ${p.shortName})`, value: `PARTNER:${p.id}` })),
    ],
    [reserves, partners],
  );

  const problems = useMemo(() => problemsOf(tranches), [tranches]);
  const payload = useMemo(() => toPayload(tranches), [tranches]);
  const allProblems = problems.length ? problems : serverProblems;
  const dateOk = Boolean(effectiveFrom) && effectiveFrom >= earliestStart;

  const update = (key: number, patch: Partial<TrancheDraft>) =>
    setTranches((prev) => prev.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  const updateLine = (tKey: number, lKey: number, patch: Partial<LineDraft>) =>
    setTranches((prev) =>
      prev.map((t) => (t.key === tKey ? { ...t, lines: t.lines.map((l) => (l.key === lKey ? { ...l, ...patch } : l)) } : t)),
    );

  /** "Start from another unit's rule": reserve lines map by bucket name; partners carry over. */
  function copyRule(ruleId: string) {
    setCopyFrom(ruleId);
    const rule = otherRules.find((r) => r.id === ruleId);
    if (!rule) return;
    const byBucket = new Map(reserves.map((a) => [a.name.toUpperCase(), a.id]));
    const dropped: string[] = [];
    setTranches(
      rule.tranches.map((t) => ({
        key: k(),
        name: t.name,
        share: t.share,
        method: t.method,
        lines: t.lines.flatMap((l) => {
          if (l.targetType === 'PARTNER') return [{ key: k(), target: `PARTNER:${l.partnerId}`, weight: l.weight }];
          const id = byBucket.get(l.label.toUpperCase());
          if (!id) {
            dropped.push(l.label);
            return [];
          }
          return [{ key: k(), target: `RESERVE:${id}`, weight: l.weight }];
        }),
      })),
    );
    setCopyNote(
      dropped.length
        ? `Copied ${rule.businessUnit?.name}'s rule. ${unit.name} has no ${dropped.join(', ')} — those lines were left out, so re-balance before saving.`
        : `Copied ${rule.businessUnit?.name}'s rule v${rule.version}. Adjust it for ${unit.name} before saving.`,
    );
  }

  async function save(action: 'draft' | 'submit' | 'publish') {
    setError(null);
    if (allProblems.length) return setError('Fix the problems listed above first.');
    if (!dateOk) return setError(`The new version can start on ${formatDate(earliestStart)} at the earliest.`);
    setSaving(action);
    try {
      let rule: AllocationRuleRecord;
      if (mode === 'edit' && base) {
        rule = await updateAllocationRule(base.id, { effectiveFrom, note, tranches: payload });
        if (action === 'submit') rule = await ruleAction(rule.id, 'submit');
        if (action === 'publish') rule = await ruleAction(rule.id, 'approve', note);
      } else {
        rule = await createAllocationRule({
          businessUnitId: unit.id,
          effectiveFrom,
          note: note.trim() || undefined,
          tranches: payload,
          submit: action === 'submit',
          publish: action === 'publish',
        });
      }
      onSaved(rule);
    } catch (err) {
      setError(errorMessage(err, 'Could not save this rule.'));
    } finally {
      setSaving(null);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mode === 'edit' && base ? `Edit draft v${base.version} — ${unit.name}` : `New allocation rule — ${unit.name}`}
      subtitle="How each day's income is earmarked. Saved as a new version; approved versions are never edited."
      position={ModalPosition.RIGHT}
      size="extraLarge"
      outsideClickClose={false}
    >
      <div className="flex flex-col gap-5 pb-2">
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            label="Takes effect from"
            type="date"
            required
            value={effectiveFrom}
            min={earliestStart}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            helperText={`Days up to ${formatDate(addDays(earliestStart, -1))} keep the rule they were allocated under.`}
            errorText={effectiveFrom && !dateOk ? `Earliest: ${formatDate(earliestStart)}` : undefined}
          />
          {mode === 'new' && otherRules.length > 0 && (
            <Select
              label="Start from another unit's rule"
              placeholder="Optional"
              value={copyFrom}
              onChange={copyRule}
              options={otherRules.map((r) => ({ label: `${r.businessUnit?.name} — v${r.version}`, value: r.id }))}
            />
          )}
        </div>
        {copyNote && <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">{copyNote}</p>}

        <div>
          <TrancheBar tranches={tranches.map((t) => ({ name: t.name, share: scaled(t.share) === null ? '0' : t.share }))} className="h-3" />
          <p className="mt-1.5 text-xs text-gray-600">
            Each tranche takes a share of the day&apos;s income; its lines split that share — by percentages that total
            100%, or by parts (25 : 40), which always split exactly.
          </p>
        </div>

        {tranches.map((t, ti) => {
          const shareScaled = scaled(t.share) ?? 0n;
          const weights = t.lines.map((l) => scaled(l.weight) ?? 0n);
          const divisor = t.method === 'PERCENT' ? HUNDRED : weights.reduce((s, w) => s + w, 0n);
          return (
            <section
              key={t.key}
              className="rounded-xl border border-gray-200"
              style={{ borderLeft: `4px solid ${TRANCHE_COLORS[ti % TRANCHE_COLORS.length]}` }}
            >
              <div className="grid gap-3 border-b border-gray-200 p-3 md:grid-cols-[minmax(0,1fr)_130px_190px_40px] md:items-end">
                <Input label="Tranche" value={t.name} maxLength={80} onChange={(e) => update(t.key, { name: e.target.value })} />
                <Input
                  label="% of income"
                  inputMode="decimal"
                  value={t.share}
                  onChange={(e) => update(t.key, { share: e.target.value.replace(/[^\d.]/g, '') })}
                />
                <div>
                  <p className="mb-1.5 text-sm text-gray-800 md:text-base">Split by</p>
                  <div className="flex rounded-lg border border-gray-200 p-0.5">
                    {(['PERCENT', 'PARTS'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => update(t.key, { method: m })}
                        className={clsx(
                          'flex-1 rounded-md px-2 py-1.5 text-sm font-medium',
                          t.method === m ? 'bg-accent text-white' : 'text-gray-700 hover:bg-gray-50',
                        )}
                      >
                        {m === 'PERCENT' ? '% of tranche' : 'Parts'}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${t.name || 'tranche'}`}
                  disabled={tranches.length <= 1}
                  onClick={() => setTranches((prev) => prev.filter((x) => x.key !== t.key))}
                  className="flex h-10.5 items-center justify-center rounded-lg border border-error-200 bg-error-100 disabled:opacity-40"
                >
                  <TrashIcon />
                </button>
              </div>

              <div className="flex flex-col gap-2 p-3">
                {t.lines.map((l, li) => {
                  const w = weights[li];
                  const ofIncome = divisor > 0n ? (shareScaled * w * 2n + divisor) / (2n * divisor) : 0n;
                  return (
                    <div key={l.key} className="grid grid-cols-[minmax(0,1fr)_100px_36px] items-center gap-2 md:grid-cols-[minmax(0,1fr)_110px_90px_36px]">
                      <Select
                        showSearch
                        placeholder="Reserve or partner"
                        value={l.target}
                        onChange={(v) => updateLine(t.key, l.key, { target: v })}
                        options={targetOptions}
                      />
                      <div className="relative">
                        <input
                          aria-label={t.method === 'PERCENT' ? '% of tranche' : 'Parts'}
                          inputMode="decimal"
                          value={l.weight}
                          onChange={(e) => updateLine(t.key, l.key, { weight: e.target.value.replace(/[^\d.]/g, '') })}
                          className="h-10.5 w-full rounded-lg border border-gray-200 px-3 pr-7 text-right text-sm tabular-nums outline-none focus:border-gray-400"
                        />
                        <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-gray-400">
                          {t.method === 'PERCENT' ? '%' : 'pt'}
                        </span>
                      </div>
                      <span className="hidden text-right text-xs tabular-nums text-gray-600 md:block" title="Share of the day's income">
                        {unscaled(ofIncome)}% of income
                      </span>
                      <button
                        type="button"
                        aria-label="Remove line"
                        disabled={t.lines.length <= 1}
                        onClick={() => update(t.key, { lines: t.lines.filter((x) => x.key !== l.key) })}
                        className="flex h-10.5 items-center justify-center rounded-lg border border-error-200 bg-error-100 disabled:opacity-40"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  );
                })}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    icon={<PlusIcon fill="#101828" width="16" height="16" />}
                    onClick={() => update(t.key, { lines: [...t.lines, { key: k(), target: '', weight: '' }] })}
                  >
                    Add line
                  </Button>
                  {t.method === 'PERCENT' && (
                    <span
                      className={clsx(
                        'text-xs font-medium tabular-nums',
                        weights.reduce((s, w) => s + w, 0n) === HUNDRED ? 'text-green-600' : 'text-danger',
                      )}
                    >
                      Lines total {unscaled(weights.reduce((s, w) => s + w, 0n))}% of 100%
                    </span>
                  )}
                </div>
              </div>
            </section>
          );
        })}

        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={<PlusIcon fill="#101828" width="16" height="16" />}
            onClick={() =>
              setTranches((prev) => [
                ...prev,
                { key: k(), name: 'Partners', share: '', method: 'PARTS', lines: [{ key: k(), target: '', weight: '1' }] },
              ])
            }
          >
            Add tranche
          </Button>
        </div>

        {allProblems.length > 0 ? (
          <ul className="list-disc rounded-md border border-warning-200 bg-warning-25 py-2 pr-3 pl-7 text-sm text-warning-800">
            {allProblems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : (
          <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
            Every rupee of income is earmarked exactly once.
          </p>
        )}

        {!problems.length && (
          <section className="rounded-xl border border-gray-200 p-3">
            <p className="mb-3 text-sm font-semibold text-gray-900">Preview before saving</p>
            <RulePreviewPanel businessUnitId={unit.id} tranches={payload} onProblems={setServerProblems} />
          </section>
        )}

        <Input
          label="Why the change?"
          placeholder="e.g. Stock reserve 43% → 42% after the supplier contract (shown to the approver)"
          value={note}
          maxLength={1000}
          onChange={(e) => setNote(e.target.value)}
        />

        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

        <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-wrap justify-end gap-2 border-t border-gray-200 bg-white px-4 py-3 md:-mx-5 md:-mb-5 md:px-5">
          <Button variant="secondary" onClick={onClose} disabled={Boolean(saving)}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={() => save('draft')} disabled={Boolean(saving)}>
            {saving === 'draft' ? 'Saving…' : mode === 'edit' ? 'Save draft' : 'Save as draft'}
          </Button>
          {canApprove ? (
            <Button onClick={() => save('publish')} disabled={Boolean(saving) || allProblems.length > 0}>
              {saving === 'publish' ? 'Approving…' : 'Approve & publish'}
            </Button>
          ) : (
            <Button onClick={() => save('submit')} disabled={Boolean(saving) || allProblems.length > 0}>
              {saving === 'submit' ? 'Submitting…' : 'Submit for Partner approval'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
