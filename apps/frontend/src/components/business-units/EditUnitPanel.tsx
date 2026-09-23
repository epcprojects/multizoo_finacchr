'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import Modal, { ModalPosition } from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';
import AccountFormModal from '../accounts/AccountFormModal';
import { CheckedBoxIcon, EditIcon, PlusIcon, UncheckedBoxIcon } from '../ui/icons';
import {
  addUnitAccounts,
  getUnitOpeningBalances,
  getUnitTemplates,
  listAccountClasses,
  listAccounts,
  setUnitOpeningBalances,
  UNIT_TYPE_LABELS,
  updateBusinessUnit,
  type AccountClassRecord,
  type AccountRecord,
  type BusinessUnitRecord,
  type BusinessUnitType,
  type UnitOpeningBalances,
  type UnitTemplates,
} from '../../lib/api/ledger';
import { errorMessage, formatDate, formatMoney, isAmount, todayIso, toPaisa } from '../../lib/money';

const TABS = ['Details', 'Accounts', 'Opening balances'] as const;
type Tab = (typeof TABS)[number];

type EditUnitPanelProps = {
  unit: BusinessUnitRecord | null;
  units: BusinessUnitRecord[];
  onClose: () => void;
  /** Called after any saved change so the page can refresh. */
  onChanged: () => void;
  canManageAccounts: boolean;
};

/** Mirrors the API's relabelUnitCode — for the preview only. */
function relabel(code: string, oldUnit: string, newUnit: string) {
  const escaped = oldUnit.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
  return code.replace(new RegExp(`(^|[^A-Z0-9])${escaped}(?=$|[^A-Z0-9])`), `$1${newUnit}`);
}

function Message({ tone, text }: { tone: 'ok' | 'error'; text: string }) {
  return (
    <p
      className={clsx(
        'rounded-md border px-3 py-2 text-sm',
        tone === 'ok' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-300 bg-red-50 text-red-600',
      )}
    >
      {text}
    </p>
  );
}

/**
 * Everything about an existing unit, in the same three parts as the Add
 * wizard. Details save in place. Accounts are added (never silently
 * removed). Opening balances are posted entries, so correcting one
 * reverses it and posts the corrected entry — history is never rewritten.
 */
export default function EditUnitPanel({ unit, units, onClose, onChanged, canManageAccounts }: EditUnitPanelProps) {
  const [tab, setTab] = useState<Tab>('Details');
  const unitId = unit?.id;
  useEffect(() => {
    if (unitId) setTab('Details');
  }, [unitId]);

  return (
    <Modal
      isOpen={Boolean(unit)}
      onClose={onClose}
      title={unit ? `Edit ${unit.name}` : 'Edit Business Unit'}
      subtitle={unit ? `${unit.code} · ${UNIT_TYPE_LABELS[unit.type]}` : undefined}
      position={ModalPosition.RIGHT}
      size="extraLarge"
      outsideClickClose={false}
    >
      {unit && (
        <div className="flex flex-col gap-5">
          <div role="tablist" className="flex gap-1 border-b border-gray-200">
            {TABS.map((t) => (
              <button
                key={t}
                role="tab"
                type="button"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={clsx(
                  '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition',
                  tab === t ? 'border-accent text-accent' : 'border-transparent text-gray-600 hover:text-gray-900',
                )}
              >
                {t}
              </button>
            ))}
          </div>
          {tab === 'Details' && <DetailsTab unit={unit} units={units} onChanged={onChanged} />}
          {tab === 'Accounts' && (
            <AccountsTab unit={unit} units={units} onChanged={onChanged} canManageAccounts={canManageAccounts} />
          )}
          {tab === 'Opening balances' && <OpeningTab unit={unit} onChanged={onChanged} />}
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function DetailsTab({ unit, units, onChanged }: { unit: BusinessUnitRecord; units: BusinessUnitRecord[]; onChanged: () => void }) {
  const [name, setName] = useState(unit.name);
  const [code, setCode] = useState(unit.code);
  const [relabelCodes, setRelabelCodes] = useState(true);
  const [type, setType] = useState<BusinessUnitType>(unit.type);
  const [description, setDescription] = useState(unit.description ?? '');
  const [isActive, setIsActive] = useState(unit.isActive);
  const [sample, setSample] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setName(unit.name);
    setCode(unit.code);
    setType(unit.type);
    setDescription(unit.description ?? '');
    setIsActive(unit.isActive);
  }, [unit]);

  useEffect(() => {
    void listAccounts({ businessUnitId: unit.id, includeInactive: true })
      .then((list) => setSample(list.filter((a) => a.businessUnit?.id === unit.id).map((a) => a.code).slice(0, 3)))
      .catch(() => setSample([]));
  }, [unit.id]);

  const codeChanged = code !== unit.code;
  const codeValid = /^[A-Z][A-Z0-9]{1,11}$/.test(code);
  const codeTaken = codeChanged && units.some((u) => u.code === code);

  async function save() {
    setMessage(null);
    if (name.trim().length < 2) return setMessage({ tone: 'error', text: 'Give the unit a name.' });
    if (!codeValid) return setMessage({ tone: 'error', text: 'The code must be 2–12 letters/digits and start with a letter.' });
    if (codeTaken) return setMessage({ tone: 'error', text: `Code ${code} is already used by another unit.` });
    setSaving(true);
    try {
      await updateBusinessUnit(unit.id, {
        name: name.trim(),
        type,
        description: description.trim(),
        ...(codeChanged ? { code, relabelAccountCodes: relabelCodes } : {}),
        ...(isActive !== unit.isActive ? { isActive } : {}),
      });
      setMessage({ tone: 'ok', text: 'Saved.' });
      onChanged();
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err, 'Could not save the unit.') });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {message && <Message {...message} />}
      <Input label="Unit name" required value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />

      <div>
        <Input
          label="Short code"
          required
          value={code}
          maxLength={12}
          errorText={codeTaken ? 'Already used by another unit' : undefined}
          helperText="Used when numbering this unit's new accounts."
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
        />
        {codeChanged && codeValid && !codeTaken && (
          <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <button type="button" onClick={() => setRelabelCodes((v) => !v)} className="flex items-start gap-2 text-left">
              <span className="mt-0.5">{relabelCodes ? <CheckedBoxIcon /> : <UncheckedBoxIcon />}</span>
              <span className="text-sm text-gray-800">
                Also update this unit&apos;s existing account codes
                <span className="block text-xs text-gray-600">
                  {sample.length
                    ? sample.map((c) => `${c} → ${relabel(c, unit.code, code)}`).join(' · ')
                    : 'Nothing to update.'}
                  {' '}Codes are labels only — no entry or balance changes either way.
                </span>
              </span>
            </button>
          </div>
        )}
      </div>

      <Select
        label="Type of business"
        required
        value={type}
        onChange={(v) => setType(v as BusinessUnitType)}
        options={(Object.keys(UNIT_TYPE_LABELS) as BusinessUnitType[]).map((t) => ({ label: UNIT_TYPE_LABELS[t], value: t }))}
      />
      <Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
      <button type="button" onClick={() => setIsActive((v) => !v)} className="flex items-start gap-2 text-left">
        <span className="mt-0.5">{isActive ? <CheckedBoxIcon /> : <UncheckedBoxIcon />}</span>
        <span className="text-sm text-gray-800">
          Active
          <span className="block text-xs text-gray-600">
            A unit can only be deactivated once all its money-on-hand accounts are at zero.
          </span>
        </span>
      </button>
      <div className="flex justify-end border-t border-gray-200 pt-4">
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save details'}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function AccountsTab({
  unit,
  units,
  onChanged,
  canManageAccounts,
}: {
  unit: BusinessUnitRecord;
  units: BusinessUnitRecord[];
  onChanged: () => void;
  canManageAccounts: boolean;
}) {
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [classes, setClasses] = useState<AccountClassRecord[]>([]);
  const [templates, setTemplates] = useState<UnitTemplates>({ reserveCatalog: [], provisionableClasses: [] });
  const [loading, setLoading] = useState(true);
  const [pickClasses, setPickClasses] = useState<string[]>([]);
  const [pickBuckets, setPickBuckets] = useState<string[]>([]);
  const [customBucket, setCustomBucket] = useState('');
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AccountRecord | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, t, c] = await Promise.all([
        listAccounts({ businessUnitId: unit.id, includeInactive: true }),
        getUnitTemplates(),
        listAccountClasses(),
      ]);
      setAccounts(list);
      setTemplates(t);
      setClasses(c);
    } finally {
      setLoading(false);
    }
  }, [unit.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const own = accounts.filter((a) => a.businessUnit?.id === unit.id);
  const ownClassIds = new Set(own.map((a) => a.accountClass?.id));
  const ownNames = new Set(own.map((a) => a.name.toUpperCase()));
  const missingClasses = templates.provisionableClasses.filter((c) => !ownClassIds.has(c.id));
  const missingBuckets = useMemo(
    () =>
      [...new Set([...templates.reserveCatalog, ...pickBuckets])].filter(
        (b) => !ownNames.has(`${b} RESERVE`.toUpperCase()),
      ),
    [templates.reserveCatalog, pickBuckets, ownNames],
  );

  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  async function addSelected() {
    setMessage(null);
    setAdding(true);
    try {
      const { created } = await addUnitAccounts(unit.id, { accountClassIds: pickClasses, reserveBuckets: pickBuckets });
      setMessage({ tone: 'ok', text: created.length ? `Added ${created.map((c) => c.code).join(', ')}.` : 'Those accounts already exist.' });
      setPickClasses([]);
      setPickBuckets([]);
      await refresh();
      onChanged();
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err, 'Could not add the accounts.') });
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {message && <Message {...message} />}

      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full min-w-140 text-left">
          <thead className="bg-gray-50">
            <tr>
              {['Code', 'Account', 'Class', 'Balance', ''].map((h, i) => (
                <th key={h || i} className={clsx('px-4 py-2.5 text-xs font-semibold text-gray-900', i === 3 && 'text-right')}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : (
              own.map((a) => (
                <tr key={a.id} className={clsx('border-t border-gray-100', !a.isActive && 'opacity-50')}>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-gray-600">{a.code}</td>
                  <td className="px-4 py-2.5 text-sm">
                    <Link href={`/accounts/${a.id}`} className="text-gray-900 hover:text-accent">
                      {a.name}
                    </Link>
                    {!a.isActive && <span className="ml-2 text-xs text-gray-500">(inactive)</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                      {a.accountClass?.name}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right text-sm tabular-nums text-gray-900">
                    {formatMoney(a.balance)}
                  </td>
                  <td className="w-12 px-2 py-2.5 text-right">
                    {canManageAccounts && (
                      <button
                        type="button"
                        aria-label={`Edit ${a.name}`}
                        onClick={() => {
                          setEditing(a);
                          setFormOpen(true);
                        }}
                        className="rounded-md p-1.5 hover:bg-gray-100"
                      >
                        <EditIcon />
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-gray-900">Add accounts to {unit.name}</p>
          {canManageAccounts && (
            <Button
              variant="secondary"
              size="sm"
              icon={<PlusIcon fill="#101828" width="16" height="16" />}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              Other account…
            </Button>
          )}
        </div>

        {missingClasses.length > 0 && (
          <div>
            <p className="mb-2 text-xs text-gray-600">Standard accounts this unit doesn&apos;t have yet</p>
            <div className="flex flex-wrap gap-2">
              {missingClasses.map((c) => (
                <Chip key={c.id} on={pickClasses.includes(c.id)} onClick={() => setPickClasses((x) => toggle(x, c.id))}>
                  {c.accountName} <span className="text-gray-400">· {c.name}</span>
                </Chip>
              ))}
            </div>
          </div>
        )}

        {unit.type !== 'HOLDING' && (
          <div>
            <p className="mb-2 text-xs text-gray-600">Reserve buckets</p>
            <div className="flex flex-wrap gap-2">
              {missingBuckets.map((b) => (
                <Chip key={b} on={pickBuckets.includes(b)} onClick={() => setPickBuckets((x) => toggle(x, b))}>
                  {b}
                </Chip>
              ))}
            </div>
            <div className="mt-3 flex items-end gap-2">
              <Input label="Another reserve" placeholder="e.g. Party Fund" value={customBucket} maxLength={40} onChange={(e) => setCustomBucket(e.target.value)} />
              <Button
                variant="secondary"
                disabled={!customBucket.trim()}
                onClick={() => {
                  const b = customBucket.trim();
                  if (b && !pickBuckets.includes(b)) setPickBuckets((x) => [...x, b]);
                  setCustomBucket('');
                }}
              >
                Add
              </Button>
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <Button onClick={addSelected} disabled={adding || (!pickClasses.length && !pickBuckets.length)}>
            {adding ? 'Adding…' : `Add ${pickClasses.length + pickBuckets.length || ''} selected`}
          </Button>
        </div>
      </div>

      <AccountFormModal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        account={editing}
        accounts={accounts}
        classes={classes}
        units={units}
        defaultUnitId={unit.id}
        onSaved={() => {
          setFormOpen(false);
          void refresh();
          onChanged();
        }}
      />
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm',
        on ? 'border-accent bg-accent-soft text-accent' : 'border-gray-200 text-gray-700 hover:bg-gray-50',
      )}
    >
      {on ? <CheckedBoxIcon width="14" height="14" /> : <UncheckedBoxIcon width="14" height="14" />}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------

function OpeningTab({ unit, onChanged }: { unit: BusinessUnitRecord; onChanged: () => void }) {
  const [data, setData] = useState<UnitOpeningBalances | null>(null);
  const [asOfDate, setAsOfDate] = useState(todayIso());
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async (d?: UnitOpeningBalances) => {
    const next = d ?? (await getUnitOpeningBalances(unit.id));
    setData(next);
    setAsOfDate(next.asOfDate ?? todayIso());
    setAmounts(Object.fromEntries(next.accounts.map((a) => [a.id, toPaisa(a.amount) === 0n ? '' : a.amount])));
  }, [unit.id]);

  useEffect(() => {
    void load().catch((err) => setMessage({ tone: 'error', text: errorMessage(err, 'Could not load opening balances.') }));
  }, [load]);

  const hasExisting = Boolean(data?.entries.length);
  const assets = data?.accounts.filter((a) => a.type === 'ASSET') ?? [];
  const liabilities = data?.accounts.filter((a) => a.type === 'LIABILITY') ?? [];
  const sum = (list: typeof assets) =>
    list.reduce((s, a) => s + (isAmount(amounts[a.id] ?? '') ? toPaisa(amounts[a.id]) : 0n), 0n);
  const equity = sum(assets) - sum(liabilities);

  async function save() {
    if (!data) return;
    setMessage(null);
    const bad = data.accounts.find((a) => amounts[a.id] && !isAmount(amounts[a.id]));
    if (bad) return setMessage({ tone: 'error', text: `${bad.name}: up to 2 decimal places.` });
    setSaving(true);
    try {
      const result = await setUnitOpeningBalances(unit.id, {
        asOfDate,
        amounts: data.accounts
          .filter((a) => amounts[a.id] && toPaisa(amounts[a.id]) > 0n)
          .map((a) => ({ accountId: a.id, amount: amounts[a.id] })),
        replaceExisting: hasExisting,
        reason: reason.trim() || undefined,
      });
      await load(result);
      setReason('');
      setMessage({
        tone: 'ok',
        text: hasExisting
          ? 'Opening balance corrected: the old entry was reversed and the corrected one posted.'
          : 'Opening balance posted.',
      });
      onChanged();
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err, 'Could not save the opening balance.') });
    } finally {
      setSaving(false);
    }
  }

  if (!data) return <p className="py-6 text-center text-sm text-gray-500">{message?.text ?? 'Loading…'}</p>;

  const field = (a: UnitOpeningBalances['accounts'][number]) => (
    <Input
      key={a.id}
      label={`${a.name}`}
      helperText={`${a.code} · ${a.className}`}
      inputMode="decimal"
      placeholder="0.00"
      value={amounts[a.id] ?? ''}
      onChange={(e) => setAmounts((x) => ({ ...x, [a.id]: e.target.value.replace(/[^\d.]/g, '') }))}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      {message && <Message {...message} />}

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
        {hasExisting ? (
          <>
            Current opening balance:{' '}
            {data.entries.map((e, i) => (
              <span key={e.id}>
                {i > 0 && ', '}
                <span className="font-mono text-xs">{e.displayNo}</span> on {formatDate(e.entryDate)}
              </span>
            ))}
            . Posted entries are never edited — saving below <b>reverses</b> it (dated as the original) and posts the
            corrected figures, so the change stays visible in the ledger.
          </>
        ) : (
          <>No opening balance yet. Enter what this unit held on the day it came into the system.</>
        )}
      </div>

      <Input label="Balances as of" type="date" value={asOfDate} max={todayIso()} onChange={(e) => setAsOfDate(e.target.value)} />

      {assets.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold text-gray-900">What the unit held</p>
          <div className="grid gap-4 sm:grid-cols-2">{assets.map(field)}</div>
        </div>
      )}
      {liabilities.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold text-gray-900">What the unit owed</p>
          <div className="grid gap-4 sm:grid-cols-2">{liabilities.map(field)}</div>
        </div>
      )}
      {!data.accounts.length && (
        <p className="text-sm text-gray-600">This unit has no accounts that can carry an opening balance — add some on the Accounts tab.</p>
      )}

      <p className="text-xs text-gray-600">
        Net {formatMoney(equity < 0n ? -equity : equity)} {equity < 0n ? 'debited to' : 'credited to'} Opening Balance
        Equity.
      </p>

      {hasExisting && (
        <Input label="Reason for the correction" placeholder="e.g. Bank figure was wrong" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
      )}

      <div className="flex justify-end border-t border-gray-200 pt-4">
        <Button onClick={save} disabled={saving || !data.accounts.length}>
          {saving ? 'Saving…' : hasExisting ? 'Correct opening balance' : 'Post opening balance'}
        </Button>
      </div>
    </div>
  );
}
