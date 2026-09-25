'use client';

import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { useUser } from '../../../components/layout/UserProvider';
import Button from '../../../components/ui/Button';
import Select from '../../../components/ui/Select';
import PageBanner from '../../../components/ui/PageBanner';
import NewEntryPanel from '../../../components/ledger/NewEntryPanel';
import EntryDetailModal from '../../../components/ledger/EntryDetailModal';
import { PlusIcon, SearchIcon } from '../../../components/ui/icons';
import {
  KIND_LABELS,
  listBusinessUnits,
  listJournalEntries,
  type BusinessUnitRecord,
  type EntryKind,
  type JournalEntryRecord,
} from '../../../lib/api/ledger';
import { formatDate, formatMoney } from '../../../lib/money';

const PAGE_SIZE = 25;

const KIND_TONES: Record<EntryKind, string> = {
  MONEY_IN: 'bg-green-50 text-green-700 border-green-200',
  MONEY_OUT: 'bg-red-50 text-red-700 border-red-200',
  TRANSFER: 'bg-sky-50 text-sky-700 border-sky-200',
  OPENING_BALANCE: 'bg-gray-50 text-gray-700 border-gray-200',
  GENERAL: 'bg-accent-soft text-accent border-purple-200',
  REVERSAL: 'bg-warning-25 text-warning-800 border-warning-200',
  ALLOCATION: 'bg-teal-50 text-teal-700 border-teal-200',
  RESERVE_TRANSFER: 'bg-teal-50 text-teal-700 border-teal-200',
  PARTNER_DRAWING: 'bg-orange-50 text-orange-700 border-orange-200',
  PAYROLL: 'bg-violet-50 text-violet-700 border-violet-200',
};

export default function TransactionsPage() {
  const { hasPermission } = useUser();
  const canPost = hasPermission('transactions.create_own_unit');
  const isAccountant = hasPermission('ledger.reconcile');
  const canReverse = hasPermission('transactions.reverse');

  const [units, setUnits] = useState<BusinessUnitRecord[]>([]);
  const [entries, setEntries] = useState<JournalEntryRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [unitId, setUnitId] = useState('');
  const [kind, setKind] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [newOpen, setNewOpen] = useState(false);
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    void listBusinessUnits().then(setUnits).catch(() => undefined);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => setPage(1), [debouncedSearch, unitId, kind, from, to]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listJournalEntries({
        page,
        limit: PAGE_SIZE,
        search: debouncedSearch || undefined,
        businessUnitId: unitId || undefined,
        kind: (kind || undefined) as EntryKind | undefined,
        from: from || undefined,
        to: to || undefined,
      });
      setEntries(data.items);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, unitId, kind, from, to]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hasFilters = Boolean(search || unitId || kind || from || to);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:overflow-hidden xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <div className="shrink-0">
          <PageBanner
            imageSrc="/transactions-icon.svg"
            imageAlt="Entries"
            title="Entries"
            stats={[
              { title: 'Entries found', count: total, color: '#A78BFA' },
              { title: 'Business units', count: units.length, color: '#34D399' },
            ]}
          />
        </div>

        <div className="flex h-auto min-h-0 flex-none flex-col gap-4 overflow-visible rounded-xl bg-white p-4 shadow-[0_0_35px_0_rgb(0_0_0/0.04)] md:p-5 xl:h-full xl:flex-1 xl:overflow-hidden">
          <div className="flex shrink-0 flex-col gap-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 md:max-w-100 md:min-w-80">
                <div className="flex items-center gap-2">
                  <SearchIcon fill="#374151" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search description, reference or JE number"
                    className="min-w-0 flex-1 bg-transparent text-base text-gray-900 outline-none placeholder:text-gray-400"
                  />
                </div>
              </div>
              {canPost && (
                <Button
                  className="shrink-0 rounded-full"
                  icon={<PlusIcon width="20" height="20" />}
                  onClick={() => setNewOpen(true)}
                >
                  New Entry
                </Button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 md:flex md:flex-wrap md:items-center">
              <div className="col-span-2 md:w-60">
                <Select
                  placeholder="All units"
                  showSearch
                  value={unitId}
                  onChange={setUnitId}
                  options={units.map((u) => ({ label: u.name, value: u.id }))}
                />
              </div>
              <div className="col-span-2 md:w-48">
                <Select
                  placeholder="All types"
                  value={kind}
                  onChange={setKind}
                  options={(Object.keys(KIND_LABELS) as EntryKind[]).map((k) => ({ label: KIND_LABELS[k], value: k }))}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                From
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="h-10.5 min-w-0 flex-1 rounded-lg border border-gray-200 px-2 text-sm text-gray-800"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                To
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="h-10.5 min-w-0 flex-1 rounded-lg border border-gray-200 px-2 text-sm text-gray-800"
                />
              </label>
              <Button
                variant="secondary"
                className="col-span-2"
                disabled={!hasFilters}
                onClick={() => {
                  setSearch('');
                  setUnitId('');
                  setKind('');
                  setFrom('');
                  setTo('');
                }}
              >
                Clear Filters
              </Button>
            </div>

            {flash && (
              <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{flash}</p>
            )}
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-200 text-left">
                <thead>
                  <tr>
                    {['No.', 'Date', 'Unit', 'Description', 'Type', 'Amount', 'Entered by'].map((h) => (
                      <th
                        key={h}
                        className={clsx(
                          'sticky top-0 z-10 border-b border-gray-200 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-900',
                          h === 'Amount' && 'text-right',
                        )}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">
                        Loading…
                      </td>
                    </tr>
                  ) : entries.length ? (
                    entries.map((e) => (
                      <tr
                        key={e.id}
                        onClick={() => setOpenEntryId(e.id)}
                        className="cursor-pointer border-b border-gray-200 last:border-0 hover:bg-gray-50"
                      >
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-600">{e.displayNo}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-800">{formatDate(e.entryDate)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-800">{e.businessUnit?.code}</td>
                        <td className="px-4 py-3 text-sm text-gray-800">
                          <span className={clsx(e.reversedById && 'text-gray-400 line-through')}>{e.description}</span>
                          <span className="block text-xs text-gray-500">
                            {e.lines.map((l) => l.accountName).join(' → ')}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={clsx('whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', KIND_TONES[e.kind])}>
                            {KIND_LABELS[e.kind]}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium tabular-nums text-gray-900">
                          {formatMoney(e.amount)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{e.createdByName ?? '—'}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-500">
                        {hasFilters ? 'No entries match these filters.' : 'No entries yet — post the first one with New Entry.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 text-sm text-gray-600">
              <span>
                {total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <NewEntryPanel
        isOpen={newOpen}
        onClose={() => setNewOpen(false)}
        units={units}
        defaultUnitId={unitId || undefined}
        isAccountant={isAccountant}
        onPosted={(entry) => {
          setNewOpen(false);
          setFlash(`Posted ${entry.displayNo} — ${formatMoney(entry.amount)}.`);
          setTimeout(() => setFlash(null), 5000);
          void refresh();
        }}
      />

      <EntryDetailModal
        entryId={openEntryId}
        onClose={() => setOpenEntryId(null)}
        canReverse={canReverse}
        onChanged={() => void refresh()}
        onOpenEntry={setOpenEntryId}
      />
    </div>
  );
}
