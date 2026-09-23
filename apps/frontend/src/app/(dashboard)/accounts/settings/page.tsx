'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { useUser } from '../../../../components/layout/UserProvider';
import Button from '../../../../components/ui/Button';
import Input from '../../../../components/ui/Input';
import PageBanner from '../../../../components/ui/PageBanner';
import AccountClassFormModal from '../../../../components/accounts/AccountClassFormModal';
import { EditIcon, PlusIcon } from '../../../../components/ui/icons';
import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPES,
  getChartSettings,
  listAccountClasses,
  updateChartSettings,
  type AccountClassRecord,
  type ChartSettingsRecord,
  type UnitRule,
} from '../../../../lib/api/ledger';
import { errorMessage } from '../../../../lib/money';

const RULE_SHORT: Record<UnitRule, string> = {
  UNIT_REQUIRED: 'Per unit',
  GROUP_ONLY: 'Group-wide',
  EITHER: 'Either',
};

/** Mirrors the API's buildCode — only for the live preview. */
function preview(pattern: string, num: number, unit?: string) {
  return pattern.trim().toUpperCase().replace('{NUM}', String(num)).replace('{UNIT}', unit ?? '');
}

/**
 * Accounts → Settings: the rules behind the chart of accounts, editable by
 * the Accountant. The five buckets are fixed; everything underneath —
 * classes, their unit rules and code ranges, and how codes are written —
 * is configured here.
 */
export default function ChartSettingsPage() {
  const { hasPermission } = useUser();
  const canManage = hasPermission('accounts.manage');

  const [settings, setSettings] = useState<ChartSettingsRecord | null>(null);
  const [classes, setClasses] = useState<AccountClassRecord[]>([]);
  const [unitPattern, setUnitPattern] = useState('');
  const [groupPattern, setGroupPattern] = useState('');
  const [step, setStep] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AccountClassRecord | null>(null);

  const refresh = useCallback(async () => {
    const [s, c] = await Promise.all([getChartSettings(), listAccountClasses(true)]);
    setSettings(s);
    setUnitPattern(s.unitCodePattern);
    setGroupPattern(s.groupCodePattern);
    setStep(String(s.codeStep));
    setClasses(c);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function saveNumbering() {
    setMessage(null);
    setSaving(true);
    try {
      const s = await updateChartSettings({
        unitCodePattern: unitPattern,
        groupCodePattern: groupPattern,
        codeStep: Number(step) || 1,
      });
      setSettings(s);
      setUnitPattern(s.unitCodePattern);
      setGroupPattern(s.groupCodePattern);
      setMessage({ tone: 'ok', text: 'Numbering saved. New accounts will use it; existing codes are unchanged.' });
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err, 'Could not save the numbering settings.') });
    } finally {
      setSaving(false);
    }
  }

  const dirty =
    settings &&
    (unitPattern !== settings.unitCodePattern ||
      groupPattern !== settings.groupCodePattern ||
      step !== String(settings.codeStep));
  const n = Number(step) || 10;

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <div className="shrink-0">
          <PageBanner
            imageSrc="/accounts-icon.svg"
            imageAlt="Chart settings"
            title="Chart of Accounts Settings"
            stats={[
              { title: 'Account classes', count: classes.filter((c) => c.isActive).length, color: '#A78BFA' },
              { title: 'Unit code', count: settings?.examples.unit ?? '…', color: '#34D399' },
              { title: 'Group code', count: settings?.examples.group ?? '…', color: '#F5A623' },
            ]}
          />
        </div>

        <p className="px-1 text-sm text-gray-600">
          <Link href="/accounts" className="hover:text-accent">
            Chart of accounts
          </Link>{' '}
          / Settings. The five buckets — Assets, Liabilities, Equity, Income, Expenses — are fixed. Everything below
          them is configured here.
        </p>

        <section className="rounded-xl bg-white p-4 shadow-[0_0_35px_0_rgb(0_0_0/0.04)] md:p-5">
          <p className="text-lg font-bold text-black">Account code numbering</p>
          <p className="mb-4 text-sm text-gray-600">
            Use <code className="rounded bg-gray-100 px-1">{'{NUM}'}</code> for the number and{' '}
            <code className="rounded bg-gray-100 px-1">{'{UNIT}'}</code> for the unit&apos;s short code. Each class sets
            which numbers its accounts use. Codes are only labels — changing the pattern never touches existing
            accounts or entries.
          </p>
          {message && (
            <p
              className={clsx(
                'mb-3 rounded-md border px-3 py-2 text-sm',
                message.tone === 'ok' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-300 bg-red-50 text-red-600',
              )}
            >
              {message.text}
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-3">
            <Input
              label="Unit-owned accounts"
              value={unitPattern}
              maxLength={24}
              disabled={!canManage}
              helperText={`e.g. ${preview(unitPattern, 1100, 'CAFE')}, ${preview(unitPattern, 1100 + n, 'CAFE')} · must include {UNIT}`}
              onChange={(e) => setUnitPattern(e.target.value)}
            />
            <Input
              label="Group-wide accounts"
              value={groupPattern}
              maxLength={24}
              disabled={!canManage}
              helperText={`e.g. ${preview(groupPattern, 5110)}, ${preview(groupPattern, 5110 + n)}`}
              onChange={(e) => setGroupPattern(e.target.value)}
            />
            <Input
              label="Step between codes"
              inputMode="numeric"
              value={step}
              disabled={!canManage}
              helperText="10 leaves room to insert accounts in between later."
              onChange={(e) => setStep(e.target.value.replace(/\D/g, ''))}
            />
          </div>
          {canManage && (
            <div className="mt-4 flex justify-end">
              <Button onClick={saveNumbering} disabled={!dirty || saving}>
                {saving ? 'Saving…' : 'Save numbering'}
              </Button>
            </div>
          )}
        </section>

        <section className="rounded-xl bg-white p-4 shadow-[0_0_35px_0_rgb(0_0_0/0.04)] md:p-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-lg font-bold text-black">Account classes</p>
              <p className="text-sm text-gray-600">
                The kinds of account the chart can hold, and the rules each follows: which bucket, whether it belongs
                to a unit, its code range, and how it behaves.
              </p>
            </div>
            {canManage && (
              <Button
                className="shrink-0 rounded-full"
                icon={<PlusIcon width="20" height="20" />}
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                Add Class
              </Button>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full min-w-200 text-left">
              <thead className="bg-gray-50">
                <tr>
                  {['Class', 'Business unit', 'Codes', 'Behaviour', 'Accounts', ''].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-xs font-semibold text-gray-900">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              {ACCOUNT_TYPES.map((type) => {
                const rows = classes.filter((c) => c.type === type);
                if (!rows.length) return null;
                return (
                  <tbody key={type}>
                    <tr className="border-t border-gray-200 bg-gray-50/60">
                      <td colSpan={6} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        {ACCOUNT_TYPE_LABELS[type]}
                      </td>
                    </tr>
                    {rows.map((c) => (
                      <tr key={c.id} className={clsx('border-t border-gray-100', !c.isActive && 'opacity-50')}>
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium text-gray-900">
                            {c.name}
                            {c.isSystem && <span className="ml-2 text-xs font-normal text-gray-500">built-in</span>}
                            {!c.isActive && <span className="ml-2 text-xs font-normal text-gray-500">(inactive)</span>}
                          </p>
                          {c.description && <p className="max-w-80 truncate text-xs text-gray-500">{c.description}</p>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{RULE_SHORT[c.unitRule]}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-700">
                          {c.codeStart}–{c.codeEnd}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {c.isLiquid && <Chip tone="green">Money on hand</Chip>}
                            {c.isReserve && <Chip tone="amber">Reserve</Chip>}
                            {c.isReconcilable && <Chip tone="blue">Reconcilable</Chip>}
                            {c.provisionForNewUnits && <Chip tone="purple">New units get “{c.defaultAccountName || c.name}”</Chip>}
                            {!c.isLiquid && !c.isReserve && !c.isReconcilable && !c.provisionForNewUnits && (
                              <span className="text-xs text-gray-400">—</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm tabular-nums text-gray-700">{c.accountCount}</td>
                        <td className="px-2 py-3 text-right">
                          {canManage && (
                            <button
                              type="button"
                              aria-label={`Edit ${c.name}`}
                              onClick={() => {
                                setEditing(c);
                                setFormOpen(true);
                              }}
                              className="rounded-md p-1.5 hover:bg-gray-100"
                            >
                              <EditIcon />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                );
              })}
            </table>
          </div>
        </section>
      </div>

      <AccountClassFormModal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        accountClass={editing}
        onSaved={() => {
          setFormOpen(false);
          void refresh();
        }}
      />
    </div>
  );
}

function Chip({ tone, children }: { tone: 'green' | 'amber' | 'blue' | 'purple'; children: React.ReactNode }) {
  const tones = {
    green: 'bg-green-50 text-green-700 border-green-200',
    amber: 'bg-warning-25 text-warning-800 border-warning-200',
    blue: 'bg-sky-50 text-sky-700 border-sky-200',
    purple: 'bg-accent-soft text-accent border-purple-200',
  };
  return (
    <span className={clsx('whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', tones[tone])}>
      {children}
    </span>
  );
}
