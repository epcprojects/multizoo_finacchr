'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { useUser } from '../../../components/layout/UserProvider';
import Button from '../../../components/ui/Button';
import Select from '../../../components/ui/Select';
import PageBanner from '../../../components/ui/PageBanner';
import AccountFormModal from '../../../components/accounts/AccountFormModal';
import { CheckedBoxIcon, EditIcon, PlusIcon, SearchIcon, UncheckedBoxIcon } from '../../../components/ui/icons';
import {
  ACCOUNT_TYPE_HINTS,
  ACCOUNT_TYPE_LABELS,
  listAccounts,
  listBusinessUnits,
  SUBTYPE_LABELS,
  type AccountRecord,
  type AccountType,
  type BusinessUnitRecord,
} from '../../../lib/api/ledger';
import { formatMoney, toPaisa } from '../../../lib/money';

const TYPES: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];
const TYPE_LETTER: Record<AccountType, string> = { ASSET: 'A', LIABILITY: 'L', EQUITY: 'E', INCOME: 'I', EXPENSE: 'X' };

/** Headings first, their children directly beneath, everything else by code. */
function treeOrder(list: AccountRecord[]) {
  const ids = new Set(list.map((a) => a.id));
  const roots = list.filter((a) => !a.parentId || !ids.has(a.parentId));
  const out: { account: AccountRecord; depth: number }[] = [];
  for (const root of roots) {
    out.push({ account: root, depth: 0 });
    for (const child of list.filter((a) => a.parentId === root.id)) out.push({ account: child, depth: 1 });
  }
  return out;
}

export default function AccountsPage() {
  const router = useRouter();
  const { hasPermission } = useUser();
  const canManage = hasPermission('accounts.manage');

  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [units, setUnits] = useState<BusinessUnitRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [unitId, setUnitId] = useState('');
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AccountRecord | null>(null);

  useEffect(() => {
    void listBusinessUnits().then(setUnits).catch(() => undefined);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setAccounts(await listAccounts({ businessUnitId: unitId || undefined, includeInactive }));
    } finally {
      setLoading(false);
    }
  }, [unitId, includeInactive]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.code.toLowerCase().includes(q) ||
        (a.parentName ?? '').toLowerCase().includes(q),
    );
  }, [accounts, search]);

  const sections = TYPES.map((type) => {
    const list = filtered.filter((a) => a.type === type);
    const ids = new Set(list.map((a) => a.id));
    const total = list
      .filter((a) => !a.parentId || !ids.has(a.parentId))
      .reduce((sum, a) => sum + toPaisa(a.balance), 0n);
    return { type, rows: treeOrder(list), total };
  });

  const liquidTotal = accounts
    .filter((a) => ['CASH', 'BANK', 'WALLET'].includes(a.subtype))
    .reduce((s, a) => s + toPaisa(a.balance), 0n);

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:overflow-hidden xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <div className="shrink-0">
          <PageBanner
            imageSrc="/accounts-icon.svg"
            imageAlt="Chart of accounts"
            title="Chart of Accounts"
            stats={[
              { title: 'Accounts', count: accounts.length, color: '#A78BFA' },
              { title: 'Cash, bank & wallet', count: formatMoney(liquidTotal, { decimals: false }), color: '#34D399' },
            ]}
          />
        </div>

        <div className="flex h-auto min-h-0 flex-none flex-col gap-4 overflow-visible rounded-xl bg-white p-4 shadow-[0_0_35px_0_rgb(0_0_0/0.04)] md:p-5 xl:h-full xl:flex-1 xl:overflow-hidden">
          <div className="flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 md:max-w-100 md:min-w-80">
              <div className="flex items-center gap-2">
                <SearchIcon fill="#374151" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name or code"
                  className="min-w-0 flex-1 bg-transparent text-base text-gray-900 outline-none placeholder:text-gray-400"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-full sm:w-60">
                <Select
                  placeholder="All units"
                  showSearch
                  value={unitId}
                  onChange={setUnitId}
                  options={[{ label: 'All units', value: '' }, ...units.map((u) => ({ label: u.name, value: u.id }))]}
                />
              </div>
              <button
                type="button"
                onClick={() => setIncludeInactive((v) => !v)}
                className="flex items-center gap-2 text-sm text-gray-700"
              >
                {includeInactive ? <CheckedBoxIcon /> : <UncheckedBoxIcon />}
                Show inactive
              </button>
              {canManage && (
                <Button
                  className="shrink-0 rounded-full"
                  icon={<PlusIcon width="20" height="20" />}
                  onClick={() => {
                    setEditing(null);
                    setFormOpen(true);
                  }}
                >
                  Add Account
                </Button>
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-4 xl:overflow-y-auto">
            {loading ? (
              <p className="py-8 text-center text-sm text-gray-500">Loading…</p>
            ) : (
              sections.map(({ type, rows, total }) => (
                <section key={type} className="rounded-xl border border-gray-200">
                  <header className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-sm font-bold text-accent ring-1 ring-gray-200">
                        {TYPE_LETTER[type]}
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{ACCOUNT_TYPE_LABELS[type]}</p>
                        <p className="text-xs text-gray-500">{ACCOUNT_TYPE_HINTS[type]}</p>
                      </div>
                    </div>
                    <p className="text-sm font-semibold tabular-nums text-gray-900">{formatMoney(total)}</p>
                  </header>
                  {rows.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-160 text-left">
                        <tbody>
                          {rows.map(({ account: a, depth }) => (
                            <tr
                              key={a.id}
                              onClick={() => a.isPostable && router.push(`/accounts/${a.id}`)}
                              className={clsx(
                                'border-b border-gray-100 last:border-0',
                                a.isPostable && 'cursor-pointer hover:bg-gray-50',
                                !a.isActive && 'opacity-50',
                              )}
                            >
                              <td className="w-28 whitespace-nowrap px-4 py-2.5 font-mono text-xs text-gray-500">{a.code}</td>
                              <td className="px-4 py-2.5 text-sm">
                                <span
                                  className={clsx(depth ? 'pl-5 text-gray-800' : 'text-gray-900', !a.isPostable && 'font-semibold')}
                                >
                                  {a.name}
                                </span>
                                {!a.isActive && <span className="ml-2 text-xs text-gray-500">(inactive)</span>}
                              </td>
                              <td className="w-40 px-4 py-2.5 text-xs text-gray-600">
                                {a.businessUnit ? a.businessUnit.name : 'Group-wide'}
                              </td>
                              <td className="w-28 px-4 py-2.5">
                                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                                  {a.isPostable ? SUBTYPE_LABELS[a.subtype] : 'Heading'}
                                </span>
                              </td>
                              <td className="w-40 whitespace-nowrap px-4 py-2.5 text-right text-sm tabular-nums text-gray-900">
                                {formatMoney(a.balance)}
                              </td>
                              <td className="w-14 px-2 py-2.5 text-right">
                                {canManage && (
                                  <button
                                    type="button"
                                    aria-label={`Edit ${a.name}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
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
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="px-4 py-4 text-sm text-gray-500">No accounts here{search ? ' match your search' : ''}.</p>
                  )}
                </section>
              ))
            )}
          </div>
        </div>
      </div>

      <AccountFormModal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        account={editing}
        accounts={accounts}
        units={units}
        onSaved={() => {
          setFormOpen(false);
          void refresh();
        }}
      />
    </div>
  );
}
