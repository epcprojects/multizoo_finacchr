'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '../../../components/layout/UserProvider';
import Button from '../../../components/ui/Button';
import PageBanner from '../../../components/ui/PageBanner';
import Select from '../../../components/ui/Select';
import { PlusIcon } from '../../../components/ui/icons';
import { NoticeLine, Pill, Section, Tabs, type Notice } from '../../../components/hr/ui';
import ConnectionModal from '../../../components/utilities/ConnectionModal';
import { NewBillModal } from '../../../components/utilities/BillModals';
import { listBusinessUnits, type BusinessUnitRecord } from '../../../lib/api/ledger';
import { METHOD_LABELS, listBills, listConnections, type BillRow, type ConnectionRecord } from '../../../lib/api/utilities';
import { errorMessage, formatDate, formatMoney, fromPaisa, toPaisa } from '../../../lib/money';

const TABS = ['Bills', 'Connections'] as const;
type Tab = (typeof TABS)[number];

const th = 'px-4 py-2.5 font-semibold';
const td = 'px-4 py-2.5';

/**
 * Utility bill allocation (architecture plan Part 03 §8, M8): each shared
 * connection's bills, the sub-meter readings or weights that share them,
 * and each unit's charge — replacing the `Sub Meters Details` sheet.
 */
export default function UtilitiesPage() {
  const router = useRouter();
  const { hasPermission } = useUser();
  const canManage = hasPermission('utilities.manage');

  const [tab, setTab] = useState<Tab>('Bills');
  const [connections, setConnections] = useState<ConnectionRecord[]>([]);
  const [bills, setBills] = useState<BillRow[] | null>(null);
  const [filter, setFilter] = useState('');
  const [units, setUnits] = useState<BusinessUnitRecord[]>([]);
  const [editing, setEditing] = useState<ConnectionRecord | 'new' | null>(null);
  const [newBill, setNewBill] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const refresh = useCallback(async () => {
    try {
      const [c, b] = await Promise.all([listConnections(), listBills(filter || undefined)]);
      setConnections(c);
      setBills(b);
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, 'Could not load utilities.') });
    }
  }, [filter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    void listBusinessUnits().then((u) => setUnits(u.filter((x) => x.isActive)));
  }, []);

  const drafts = (bills ?? []).filter((b) => b.status === 'DRAFT').length;
  const year = new Date().getFullYear().toString();
  const recharged = fromPaisa((bills ?? []).filter((b) => b.status === 'POSTED' && b.periodTo.startsWith(year)).reduce((s, b) => s + toPaisa(b.recharged ?? '0'), 0n));

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <div className="shrink-0">
          <PageBanner
            imageSrc="/utilities-icon.svg"
            imageAlt="Utilities"
            title="Utilities"
            stats={[
              { title: 'Shared connections', count: connections.filter((c) => c.isActive).length, color: '#60A5FA' },
              { title: 'Bills in draft', count: bills ? drafts : '…', color: drafts ? '#F5A623' : '#34D399' },
              { title: `Charged to other units in ${year}`, count: bills ? formatMoney(recharged, { decimals: false }) : '…', color: '#A78BFA' },
            ]}
          />
        </div>

        <NoticeLine notice={notice} onClose={() => setNotice(null)} />

        <Section
          title={<Tabs tabs={TABS} value={tab} onChange={setTab} counts={{ Bills: drafts }} />}
          actions={
            canManage &&
            (tab === 'Bills' ? (
              <Button icon={<PlusIcon />} onClick={() => setNewBill(filter || '')} disabled={!connections.length}>
                New bill
              </Button>
            ) : (
              <Button icon={<PlusIcon />} onClick={() => setEditing('new')}>
                New connection
              </Button>
            ))
          }
        >
          {tab === 'Bills' && (
            <>
              <div className="w-72">
                <Select
                  value={filter}
                  onChange={setFilter}
                  options={[{ label: 'All connections', value: '' }, ...connections.map((c) => ({ label: c.name, value: c.id }))]}
                />
              </div>
              {!bills ? (
                <p className="py-6 text-center text-sm text-gray-500">Loading…</p>
              ) : !bills.length ? (
                <p className="py-6 text-center text-sm text-gray-500">No bills yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full min-w-190 text-left text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-900">
                      <tr>
                        <th className={th}>Cycle</th>
                        <th className={th}>Connection</th>
                        <th className={`${th} text-right`}>Bill</th>
                        <th className={`${th} text-right`}>Units</th>
                        <th className={`${th} text-right`}>Rate / unit</th>
                        <th className={`${th} text-right`}>Charged to others</th>
                        <th className={th}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bills.map((b) => (
                        <tr key={b.id} onClick={() => router.push(`/utilities/bills/${b.id}`)} className="cursor-pointer border-t border-gray-200 hover:bg-gray-50">
                          <td className={`${td} whitespace-nowrap`}>
                            {formatDate(b.periodFrom)} – {formatDate(b.periodTo)}
                          </td>
                          <td className={td}>
                            {b.connection.name}
                            <p className="text-xs text-gray-500">paid by {b.connection.businessUnit.code}</p>
                          </td>
                          <td className={`${td} text-right tabular-nums`}>{formatMoney(b.billAmount)}</td>
                          <td className={`${td} text-right tabular-nums`}>{b.totalUnits ? formatMoney(b.totalUnits, { prefix: false }) : '—'}</td>
                          <td className={`${td} text-right tabular-nums`}>{b.rate ?? '—'}</td>
                          <td className={`${td} text-right tabular-nums`}>{b.recharged ? formatMoney(b.recharged) : '—'}</td>
                          <td className={td}>
                            <Pill tone={b.status === 'POSTED' ? 'green' : 'amber'}>{b.status === 'POSTED' ? 'Posted' : 'Draft'}</Pill>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {tab === 'Connections' && (
            <div className="grid gap-3 lg:grid-cols-2">
              {connections.map((c) => (
                <div key={c.id} className={`flex flex-col gap-2 rounded-xl border border-gray-200 p-4 ${c.isActive ? '' : 'opacity-60'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-gray-900">{c.name}</p>
                      <p className="text-xs text-gray-500">
                        {c.utility}
                        {c.provider ? ` · ${c.provider}` : ''} · paid by {c.businessUnit.name} · {c.expenseAccount?.name}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Pill tone="blue">{METHOD_LABELS[c.method].label}</Pill>
                      {!c.isActive && <Pill>Inactive</Pill>}
                    </div>
                  </div>
                  {c.method === 'SUB_METERED' ? (
                    <>
                      <p className="text-sm text-gray-700">
                        {c.subMeters.filter((s) => s.isActive).map((s) => `${s.name} → ${s.businessUnit.code}`).join(' · ') || 'No sub-meters'}
                      </p>
                      <p className="text-xs text-gray-500">
                        Unmetered: {c.remainderSplit.map((s) => `${s.pct}% ${s.businessUnit.code}`).join(' / ') || '—'}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-gray-700">
                      {c.shares.length} lines ·{' '}
                      {Object.entries(
                        c.shares.reduce<Record<string, number>>((acc, s) => {
                          for (const [u, w] of Object.entries(s.weights)) acc[u] = (acc[u] ?? 0) + Math.round(Number(w) * 10000);
                          return acc;
                        }, {}),
                      )
                        .map(([u, w]) => `${units.find((x) => x.id === u)?.code ?? '?'} ${w / 10000}`)
                        .join(' · ')}
                    </p>
                  )}
                  <p className="text-xs text-gray-500">
                    {c.lastBill ? `Last bill to ${formatDate(c.lastBill.periodTo)} · ${formatMoney(c.lastBill.billAmount)}` : 'No bills yet'}
                  </p>
                  {canManage && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>
                        Edit
                      </Button>
                      {c.isActive && (
                        <Button size="sm" onClick={() => setNewBill(c.id)}>
                          New bill
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {!connections.length && <p className="py-6 text-center text-sm text-gray-500">No shared connections set up.</p>}
            </div>
          )}
        </Section>
      </div>

      <ConnectionModal
        isOpen={editing !== null}
        connection={editing === 'new' ? null : editing}
        units={units}
        onClose={() => setEditing(null)}
        onSaved={(c) => {
          setEditing(null);
          setNotice({ tone: 'ok', text: `${c.name} saved.` });
          void refresh();
        }}
      />
      <NewBillModal
        isOpen={newBill !== null}
        connections={connections}
        connectionId={newBill || undefined}
        onClose={() => setNewBill(null)}
        onSaved={(b) => router.push(`/utilities/bills/${b.id}`)}
      />
    </div>
  );
}
