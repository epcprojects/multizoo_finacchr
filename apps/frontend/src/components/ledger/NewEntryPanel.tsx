'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import Modal, { ModalPosition } from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';
import { PlusIcon, TrashIcon } from '../ui/icons';
import {
  listAccounts,
  postJournalEntry,
  type AccountRecord,
  type BusinessUnitRecord,
  type EntryKind,
  type JournalEntryRecord,
  type NewEntryPayload,
} from '../../lib/api/ledger';
import {
  errorMessage,
  formatMoney,
  fromPaisa,
  isAmount,
  todayIso,
  toPaisa,
} from '../../lib/money';

type PostableKind = Exclude<EntryKind, 'REVERSAL'>;

const KIND_TABS: { kind: PostableKind; label: string; hint: string; accountantOnly?: boolean }[] = [
  { kind: 'MONEY_IN', label: 'Money in', hint: 'Sales or any money received into cash, bank or wallet.' },
  { kind: 'MONEY_OUT', label: 'Money out', hint: 'An expense or payment made from cash, bank or wallet.' },
  { kind: 'TRANSFER', label: 'Transfer', hint: 'Move money between this unit’s own cash, bank and wallet.' },
  {
    kind: 'OPENING_BALANCE',
    label: 'Opening balance',
    hint: 'Bring an existing balance into the system for the first time.',
    accountantOnly: true,
  },
  {
    kind: 'GENERAL',
    label: 'General journal',
    hint: 'Any balanced set of debits and credits — for corrections and adjustments.',
    accountantOnly: true,
  },
];

type JournalLineDraft = { key: number; accountId: string; debit: string; credit: string; memo: string };

type NewEntryPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  onPosted: (entry: JournalEntryRecord) => void;
  units: BusinessUnitRecord[];
  defaultUnitId?: string;
  /** Holds ledger.reconcile — may post opening balances and general journals. */
  isAccountant: boolean;
};

function accountLabel(a: AccountRecord) {
  return `${a.code} · ${a.parentName ? `${a.parentName} › ` : ''}${a.name}`;
}

/** Signed change as the account's own balance sees it (Follow the Rupee's +/−). */
function normalDelta(account: AccountRecord, debit: bigint, credit: bigint) {
  return (debit - credit) * (account.isDebitNormal ? 1n : -1n);
}

/**
 * The New Entry panel. For the everyday kinds the user never sees the words
 * debit or credit — they pick where money came from and where it went, and
 * the preview shows each account's before → after balance, exactly like the
 * ledger strips in Follow the Rupee. The accountant's general journal is the
 * one place debits and credits are entered directly.
 */
export default function NewEntryPanel({
  isOpen,
  onClose,
  onPosted,
  units,
  defaultUnitId,
  isAccountant,
}: NewEntryPanelProps) {
  const activeUnits = useMemo(() => units.filter((u) => u.isActive), [units]);
  const [kind, setKind] = useState<PostableKind>('MONEY_IN');
  const [unitId, setUnitId] = useState('');
  const [entryDate, setEntryDate] = useState(todayIso());
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const [liquidId, setLiquidId] = useState('');
  const [otherId, setOtherId] = useState('');
  const [lines, setLines] = useState<JournalLineDraft[]>([]);
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setKind('MONEY_IN');
    setUnitId(defaultUnitId ?? (activeUnits.length === 1 ? activeUnits[0].id : ''));
    setEntryDate(todayIso());
    setDescription('');
    setReference('');
    setAmount('');
    setLiquidId('');
    setOtherId('');
    setLines([
      { key: 1, accountId: '', debit: '', credit: '', memo: '' },
      { key: 2, accountId: '', debit: '', credit: '', memo: '' },
    ]);
    setError(null);
  }, [isOpen, defaultUnitId, activeUnits]);

  useEffect(() => {
    if (!isOpen || !unitId) {
      setAccounts([]);
      return;
    }
    setLoadingAccounts(true);
    listAccounts({ businessUnitId: unitId })
      .then((list) => setAccounts(list.filter((a) => a.isPostable && a.isActive && !a.accountClass?.isReserve)))
      .catch(() => setAccounts([]))
      .finally(() => setLoadingAccounts(false));
    setLiquidId('');
    setOtherId('');
  }, [isOpen, unitId]);

  useEffect(() => {
    setOtherId('');
    setError(null);
  }, [kind]);

  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const liquid = accounts.filter((a) => a.accountClass?.isLiquid);
  const nonLiquid = accounts.filter((a) => !a.accountClass?.isLiquid);
  const opts = (list: AccountRecord[]) => list.map((a) => ({ label: accountLabel(a), value: a.id }));

  // "Received from" favours income; "paid for" favours expenses.
  const sortBy = (first: AccountRecord['type']) => (a: AccountRecord, b: AccountRecord) =>
    Number(b.type === first) - Number(a.type === first) || a.code.localeCompare(b.code);
  const counterOptions =
    kind === 'MONEY_IN'
      ? opts([...nonLiquid].sort(sortBy('INCOME')))
      : kind === 'MONEY_OUT'
        ? opts([...nonLiquid].sort(sortBy('EXPENSE')))
        : kind === 'TRANSFER'
          ? opts(liquid.filter((a) => a.id !== liquidId))
          : opts(accounts.filter((a) => a.type === 'ASSET' || a.type === 'LIABILITY'));

  const openingEquity = accounts.find((a) => a.systemKey === 'OPENING_BALANCE_EQUITY');
  const amountPaisa = isAmount(amount) ? toPaisa(amount) : 0n;

  /** The entry's lines, built from the simple form or the journal grid. */
  const builtLines = useMemo((): { accountId: string; debit: bigint; credit: bigint; memo?: string }[] => {
    if (kind === 'GENERAL') {
      return lines
        .filter((l) => l.accountId)
        .map((l) => ({
          accountId: l.accountId,
          debit: isAmount(l.debit) ? toPaisa(l.debit) : 0n,
          credit: isAmount(l.credit) ? toPaisa(l.credit) : 0n,
          memo: l.memo.trim() || undefined,
        }));
    }
    if (amountPaisa <= 0n) return [];
    switch (kind) {
      case 'MONEY_IN':
        return liquidId && otherId
          ? [
              { accountId: liquidId, debit: amountPaisa, credit: 0n },
              { accountId: otherId, debit: 0n, credit: amountPaisa },
            ]
          : [];
      case 'MONEY_OUT':
        return liquidId && otherId
          ? [
              { accountId: otherId, debit: amountPaisa, credit: 0n },
              { accountId: liquidId, debit: 0n, credit: amountPaisa },
            ]
          : [];
      case 'TRANSFER':
        return liquidId && otherId
          ? [
              { accountId: otherId, debit: amountPaisa, credit: 0n },
              { accountId: liquidId, debit: 0n, credit: amountPaisa },
            ]
          : [];
      case 'OPENING_BALANCE': {
        const target = byId.get(otherId);
        if (!target || !openingEquity) return [];
        // An asset opens with a debit; a liability opens with a credit.
        return target.isDebitNormal
          ? [
              { accountId: target.id, debit: amountPaisa, credit: 0n },
              { accountId: openingEquity.id, debit: 0n, credit: amountPaisa },
            ]
          : [
              { accountId: openingEquity.id, debit: amountPaisa, credit: 0n },
              { accountId: target.id, debit: 0n, credit: amountPaisa },
            ];
      }
      default:
        return [];
    }
  }, [kind, lines, amountPaisa, liquidId, otherId, byId, openingEquity]);

  const totalDebit = builtLines.reduce((s, l) => s + l.debit, 0n);
  const totalCredit = builtLines.reduce((s, l) => s + l.credit, 0n);
  const balanced = builtLines.length >= 2 && totalDebit === totalCredit && totalDebit > 0n;

  /** Before → change → after, per account touched. */
  const preview = useMemo(() => {
    const deltas = new Map<string, bigint>();
    for (const l of builtLines) {
      const account = byId.get(l.accountId);
      if (!account) continue;
      deltas.set(l.accountId, (deltas.get(l.accountId) ?? 0n) + normalDelta(account, l.debit, l.credit));
    }
    return [...deltas.entries()].map(([id, delta]) => {
      const account = byId.get(id) as AccountRecord;
      const before = toPaisa(account.balance);
      return { account, before, delta, after: before + delta };
    });
  }, [builtLines, byId]);

  async function submit() {
    setError(null);
    if (!unitId) return setError('Choose a business unit.');
    if (!description.trim()) return setError('Add a short description — it’s what appears on the ledger.');
    if (kind !== 'GENERAL' && amountPaisa <= 0n) return setError('Enter an amount greater than zero (up to 2 decimals).');
    if (kind === 'GENERAL') {
      const bad = lines.find(
        (l) => l.accountId && ((l.debit && !isAmount(l.debit)) || (l.credit && !isAmount(l.credit))),
      );
      if (bad) return setError('Amounts may have at most 2 decimal places.');
    }
    if (!balanced) {
      return setError(
        kind === 'GENERAL'
          ? `Debits (${formatMoney(totalDebit)}) must equal credits (${formatMoney(totalCredit)}).`
          : 'Pick both accounts to continue.',
      );
    }

    const payload: NewEntryPayload = {
      entryDate,
      businessUnitId: unitId,
      description: description.trim(),
      reference: reference.trim() || undefined,
      kind,
      lines: builtLines.map((l) => ({
        accountId: l.accountId,
        ...(l.debit > 0n ? { debit: fromPaisa(l.debit) } : {}),
        ...(l.credit > 0n ? { credit: fromPaisa(l.credit) } : {}),
        ...(l.memo ? { memo: l.memo } : {}),
      })),
    };

    setSubmitting(true);
    try {
      onPosted(await postJournalEntry(payload));
    } catch (err) {
      setError(errorMessage(err, 'Could not post the entry.'));
    } finally {
      setSubmitting(false);
    }
  }

  const tabs = KIND_TABS.filter((t) => !t.accountantOnly || isAccountant);
  const tab = KIND_TABS.find((t) => t.kind === kind) as (typeof KIND_TABS)[number];

  const liquidLabel =
    kind === 'MONEY_IN' ? 'Received into' : kind === 'OPENING_BALANCE' ? 'Account' : 'Paid from';
  const otherLabel =
    kind === 'MONEY_IN' ? 'Received from' : kind === 'MONEY_OUT' ? 'Paid for' : 'Moved to';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="New Entry"
      subtitle="Every entry moves money between two or more accounts — the preview shows exactly how."
      position={ModalPosition.RIGHT}
      size={kind === 'GENERAL' ? 'extraLarge' : 'large'}
      showFooter
      onConfirm={submit}
      confirmLabel={submitting ? 'Posting…' : 'Post Entry'}
      confirmDisabled={submitting}
      outsideClickClose={false}
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Entry type">
          {tabs.map((t) => (
            <button
              key={t.kind}
              type="button"
              role="tab"
              aria-selected={kind === t.kind}
              onClick={() => setKind(t.kind)}
              className={clsx(
                'rounded-full border px-3.5 py-1.5 text-sm font-medium transition',
                kind === t.kind
                  ? 'border-accent bg-accent text-white'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="-mt-2 text-sm text-gray-600">{tab.hint}</p>

        {error && (
          <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <Select
            label="Business unit"
            required
            showSearch
            placeholder="Choose a unit"
            value={unitId}
            onChange={setUnitId}
            options={activeUnits.map((u) => ({ label: `${u.name} (${u.code})`, value: u.id }))}
          />
          <Input
            label="Date"
            type="date"
            required
            value={entryDate}
            max={todayIso()}
            onChange={(e) => setEntryDate(e.target.value)}
          />
        </div>

        <Input
          label="Description"
          required
          placeholder={
            kind === 'MONEY_IN'
              ? 'e.g. Ticket sales for the day'
              : kind === 'MONEY_OUT'
                ? 'e.g. 32kg chicken for carnivores'
                : 'What is this entry for?'
          }
          value={description}
          maxLength={500}
          onChange={(e) => setDescription(e.target.value)}
        />

        {kind !== 'GENERAL' ? (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              {kind !== 'OPENING_BALANCE' && (
                <Select
                  label={liquidLabel}
                  required
                  placeholder={loadingAccounts ? 'Loading…' : unitId ? 'Cash, bank or wallet' : 'Choose a unit first'}
                  value={liquidId}
                  onChange={setLiquidId}
                  options={opts(liquid)}
                />
              )}
              <Select
                label={kind === 'OPENING_BALANCE' ? 'Account' : otherLabel}
                required
                showSearch
                placeholder={loadingAccounts ? 'Loading…' : unitId ? 'Search accounts' : 'Choose a unit first'}
                value={otherId}
                onChange={setOtherId}
                options={counterOptions}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label="Amount (Rs)"
                required
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                errorText={amount && !isAmount(amount) ? 'Up to 2 decimal places' : undefined}
              />
              <Input
                label="Reference"
                placeholder="Receipt / bill no. (optional)"
                value={reference}
                maxLength={100}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
          </>
        ) : (
          <JournalGrid lines={lines} setLines={setLines} options={opts(accounts)} disabled={!unitId} />
        )}

        {kind === 'GENERAL' && (
          <Input
            label="Reference"
            placeholder="Optional"
            value={reference}
            maxLength={100}
            onChange={(e) => setReference(e.target.value)}
          />
        )}

        <div className="rounded-xl border border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2.5">
            <p className="text-sm font-semibold text-gray-900">What this entry does</p>
            {builtLines.length > 0 && (
              <span
                className={clsx(
                  'rounded-full px-2.5 py-0.5 text-xs font-medium',
                  balanced ? 'bg-green-100 text-green-700' : 'bg-error-100 text-danger',
                )}
              >
                {balanced ? 'Balanced' : `Off by ${formatMoney(totalDebit - totalCredit)}`}
              </span>
            )}
          </div>
          {preview.length ? (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-gray-500">
                  <th className="px-4 py-2 font-medium">Account</th>
                  <th className="px-4 py-2 text-right font-medium">Before</th>
                  <th className="px-4 py-2 text-right font-medium">Change</th>
                  <th className="px-4 py-2 text-right font-medium">After</th>
                </tr>
              </thead>
              <tbody>
                {preview.map(({ account, before, delta, after }) => (
                  <tr key={account.id} className="border-t border-gray-200 bg-white">
                    <td className="px-4 py-2.5 font-medium text-gray-900">{account.name}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{formatMoney(before)}</td>
                    <td
                      className={clsx(
                        'px-4 py-2.5 text-right font-semibold tabular-nums',
                        delta >= 0n ? 'text-green-600' : 'text-red-600',
                      )}
                    >
                      {delta >= 0n ? '+' : ''}
                      {formatMoney(delta)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">{formatMoney(after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-4 py-5 text-sm text-gray-500">
              Fill in the accounts and amount to see each balance before and after.
            </p>
          )}
          {kind === 'MONEY_IN' && preview.length > 0 && (
            <p className="border-t border-gray-200 px-4 py-2 text-xs text-gray-500">
              Income accounts don’t hold money — they total up what was earned over the period.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

function JournalGrid({
  lines,
  setLines,
  options,
  disabled,
}: {
  lines: JournalLineDraft[];
  setLines: (fn: (prev: JournalLineDraft[]) => JournalLineDraft[]) => void;
  options: { label: string; value: string }[];
  disabled: boolean;
}) {
  const update = (key: number, patch: Partial<JournalLineDraft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <div className="flex flex-col gap-2">
      <div className="hidden grid-cols-[minmax(0,1fr)_120px_120px_36px] gap-2 px-1 text-xs font-medium text-gray-500 md:grid">
        <span>Account</span>
        <span className="text-right">Debit</span>
        <span className="text-right">Credit</span>
        <span />
      </div>
      {lines.map((line) => (
        <div
          key={line.key}
          className="grid grid-cols-2 gap-2 rounded-lg border border-gray-200 p-2 md:grid-cols-[minmax(0,1fr)_120px_120px_36px] md:border-0 md:p-0"
        >
          <div className="col-span-2 md:col-span-1">
            <Select
              showSearch
              placeholder={disabled ? 'Choose a unit first' : 'Account'}
              value={line.accountId}
              onChange={(v) => update(line.key, { accountId: v })}
              options={options}
            />
          </div>
          <input
            aria-label="Debit"
            inputMode="decimal"
            placeholder="Debit"
            value={line.debit}
            onChange={(e) => update(line.key, { debit: e.target.value.replace(/[^\d.]/g, ''), credit: '' })}
            className="h-10.5 rounded-lg border border-gray-200 px-3 text-right text-sm tabular-nums outline-none focus:border-gray-400"
          />
          <input
            aria-label="Credit"
            inputMode="decimal"
            placeholder="Credit"
            value={line.credit}
            onChange={(e) => update(line.key, { credit: e.target.value.replace(/[^\d.]/g, ''), debit: '' })}
            className="h-10.5 rounded-lg border border-gray-200 px-3 text-right text-sm tabular-nums outline-none focus:border-gray-400"
          />
          <button
            type="button"
            aria-label="Remove line"
            disabled={lines.length <= 2}
            onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
            className="col-span-2 flex h-10.5 items-center justify-center rounded-lg border border-error-200 bg-error-100 disabled:opacity-40 md:col-span-1"
          >
            <TrashIcon />
          </button>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          icon={<PlusIcon fill="#101828" width="16" height="16" />}
          onClick={() =>
            setLines((prev) => [
              ...prev,
              { key: Math.max(0, ...prev.map((l) => l.key)) + 1, accountId: '', debit: '', credit: '', memo: '' },
            ])
          }
        >
          Add line
        </Button>
      </div>
    </div>
  );
}
