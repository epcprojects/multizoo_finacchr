'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { listAccounts, type AccountRecord } from '../../lib/api/ledger';
import { movementVerbs, type LoanDirection, type MovementPayload, type MovementVerb } from '../../lib/api/loans';
import { formatMoney, isAmount, todayIso, toPaisa } from '../../lib/money';

export type MovementDraft = {
  verb: string;
  movementDate: string;
  amount: string;
  description: string;
  accountId: string;
  reserveId: string;
};

export const emptyDraft = (verb: string): MovementDraft => ({
  verb,
  movementDate: todayIso(),
  amount: '',
  description: '',
  accountId: '',
  reserveId: '',
});

/** Whether value goes out to them — the only case cash can come out of a reserve. */
function toThem(direction: LoanDirection, verb: MovementVerb) {
  return (direction === 'RECEIVABLE') === (verb.effect === 'INCREASE');
}

/** Builds the API payload, or says what's missing. */
export function draftToPayload(draft: MovementDraft, direction: LoanDirection, isPartner: boolean): MovementPayload | string {
  const verb = movementVerbs(direction, isPartner).find((v) => v.key === draft.verb);
  if (!verb) return 'Choose what happened.';
  if (!isAmount(draft.amount) || toPaisa(draft.amount) <= 0n) return 'Enter the amount.';
  if (draft.description.trim().length < 2) return 'Say what it was for.';
  if (verb.pick !== 'NONE' && !draft.accountId) return verb.pick === 'CASH' ? 'Choose the cash, bank or wallet account.' : 'Choose the account.';
  return {
    movementDate: draft.movementDate,
    effect: verb.effect,
    method: verb.method,
    amount: draft.amount.trim(),
    description: draft.description.trim(),
    ...(verb.pick !== 'NONE' ? { otherAccountId: draft.accountId } : {}),
    ...(verb.method === 'CASH' && toThem(direction, verb) && draft.reserveId ? { reserveAccountId: draft.reserveId } : {}),
  };
}

/**
 * What happened, in plain words — lent more, they repaid, they paid a bill
 * for us … — and the account on the other side it needs.
 */
export default function MovementFields({
  direction,
  isPartner,
  unitId,
  draft,
  onChange,
  onlyIncreases = false,
}: {
  direction: LoanDirection;
  isPartner: boolean;
  unitId: string;
  draft: MovementDraft;
  onChange: (d: MovementDraft) => void;
  /** A loan's first movement adds to what's owed — nothing to repay yet. */
  onlyIncreases?: boolean;
}) {
  const verbs = movementVerbs(direction, isPartner).filter((v) => !onlyIncreases || v.effect === 'INCREASE');
  const verb = verbs.find((v) => v.key === draft.verb) ?? verbs[0];
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);

  useEffect(() => {
    if (!unitId) {
      setAccounts([]);
      return;
    }
    void listAccounts({ businessUnitId: unitId })
      .then((list) => setAccounts(list.filter((a) => a.isActive && a.isPostable && (!a.businessUnit || a.businessUnit.id === unitId))))
      .catch(() => setAccounts([]));
  }, [unitId]);

  const choices = useMemo(() => {
    const plain = accounts.filter((a) => !a.loanId && !a.campaignId && !a.partnerId && !a.accountClass?.isReserve && a.systemKey !== 'OPENING_BALANCE_EQUITY');
    switch (verb?.pick) {
      case 'CASH':
        return plain.filter((a) => a.accountClass?.isLiquid);
      case 'EXPENSE':
        return plain.filter((a) => a.type === 'EXPENSE' && a.systemKey !== 'LOANS_WRITE_OFF');
      case 'INCOME_OR_ASSET':
        return plain.filter((a) => (a.type === 'INCOME' || a.type === 'ASSET') && !a.accountClass?.isLiquid);
      case 'WRITE_OFF':
        return accounts.filter((a) => a.systemKey === 'LOANS_WRITE_OFF');
      default:
        return [];
    }
  }, [accounts, verb]);
  const reserves = accounts.filter((a) => a.reserveKind === 'BUCKET');

  // Keep the chosen account valid for the verb; the write-off account picks itself.
  useEffect(() => {
    if (!verb) return;
    if (verb.pick === 'WRITE_OFF' && choices[0] && draft.accountId !== choices[0].id) onChange({ ...draft, accountId: choices[0].id });
    else if (draft.accountId && !choices.some((a) => a.id === draft.accountId)) onChange({ ...draft, accountId: '', reserveId: '' });
  }, [verb?.key, choices]);

  if (!verb) return null;
  const cashOut = verb.method === 'CASH' && toThem(direction, verb);
  const accountLabel =
    verb.pick === 'CASH'
      ? cashOut
        ? 'Paid from'
        : 'Received into'
      : verb.pick === 'EXPENSE'
        ? 'What it paid for'
        : verb.pick === 'INCOME_OR_ASSET'
          ? 'What was charged'
          : 'Written off to';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="What happened">
        {verbs.map((v) => (
          <button
            key={v.key}
            type="button"
            role="radio"
            aria-checked={verb.key === v.key}
            onClick={() => onChange({ ...draft, verb: v.key, accountId: '', reserveId: '' })}
            className={clsx(
              'rounded-full border px-3 py-1.5 text-sm font-medium transition',
              verb.key === v.key ? 'border-accent bg-accent text-white' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
            )}
          >
            {v.label}
          </button>
        ))}
      </div>
      <p className="-mt-2 text-sm text-gray-600">{verb.hint}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Date" type="date" required value={draft.movementDate} max={todayIso()} onChange={(e) => onChange({ ...draft, movementDate: e.target.value })} />
        <Input
          label="Amount (Rs)"
          required
          inputMode="decimal"
          value={draft.amount}
          onChange={(e) => onChange({ ...draft, amount: e.target.value.replace(/[^\d.]/g, '') })}
          errorText={draft.amount && !isAmount(draft.amount) ? 'Up to 2 decimal places' : undefined}
        />
      </div>
      <Input
        label="Description"
        required
        value={draft.description}
        maxLength={500}
        placeholder={verb.pick === 'EXPENSE' ? 'e.g. China rides purchased by ZD' : 'e.g. Rifaqat cash, loan return'}
        onChange={(e) => onChange({ ...draft, description: e.target.value })}
      />
      {verb.pick !== 'NONE' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label={accountLabel}
            required
            showSearch
            value={draft.accountId}
            onChange={(v) => onChange({ ...draft, accountId: v })}
            placeholder={unitId ? 'Choose an account' : 'Choose the unit first'}
            options={choices.map((a) => ({
              label: `${a.code} · ${a.parentName ? `${a.parentName} › ` : ''}${a.name}${a.accountClass?.isLiquid ? ` · ${formatMoney(a.balance)}` : ''}`,
              value: a.id,
            }))}
          />
          {cashOut && reserves.length > 0 && (
            <Select
              label="Out of reserve"
              value={draft.reserveId}
              onChange={(v) => onChange({ ...draft, reserveId: v })}
              options={[{ label: 'Not from a reserve', value: '' }, ...reserves.map((a) => ({ label: `${a.name} · ${formatMoney(a.balance)}`, value: a.id }))]}
            />
          )}
        </div>
      )}
    </div>
  );
}
