'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useUser } from '../../../components/layout/UserProvider';
import Button from '../../../components/ui/Button';
import PageBanner from '../../../components/ui/PageBanner';
import { PlusIcon } from '../../../components/ui/icons';
import { NoticeLine, Pill, Section, type Notice } from '../../../components/hr/ui';
import CostCentreModal from '../../../components/cost-centres/CostCentreModal';
import { listBusinessUnits, type BusinessUnitRecord } from '../../../lib/api/ledger';
import { listCostCentres, type CostCentreRecord } from '../../../lib/api/cost-centres';
import { errorMessage, formatMoney, toPaisa, fromPaisa } from '../../../lib/money';

const th = 'px-4 py-2.5 font-semibold';
const td = 'px-4 py-2.5';

/**
 * Cost centres (architecture plan Part 03 §10, M10): tags that say what
 * spending was really for, and whose books it lands in. Replaces the
 * "MIK(…342 expense…)" notes typed into the cash sheets.
 */
export default function CostCentresPage() {
  const { hasPermission, hasAnyPermission } = useUser();
  const canManage = hasAnyPermission(['accounts.manage', 'rules.edit_allocation']);
  const isPartner = hasPermission('rules.edit_allocation');
  const canReport = hasAnyPermission(['ledger.view', 'pnl.view_consolidated']);

  const [centres, setCentres] = useState<CostCentreRecord[] | null>(null);
  const [units, setUnits] = useState<BusinessUnitRecord[]>([]);
  const [editing, setEditing] = useState<CostCentreRecord | 'new' | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const refresh = useCallback(async () => {
    try {
      setCentres(await listCostCentres());
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, 'Could not load cost centres.') });
    }
  }, []);

  useEffect(() => {
    void refresh();
    void listBusinessUnits().then((u) => setUnits(u.filter((x) => x.isActive)));
  }, [refresh]);

  const active = (centres ?? []).filter((c) => c.isActive);
  const spent = fromPaisa((centres ?? []).reduce((s, c) => s + toPaisa(c.spent ?? '0'), 0n));
  const routed = active.filter((c) => c.chargeTo === 'PARTNER').length;

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <div className="shrink-0">
          <PageBanner
            imageSrc="/cost-centre-icon.svg"
            imageAlt="Cost centres"
            title="Cost centres"
            stats={[
              { title: 'Active cost centres', count: centres ? active.length : '…', color: '#A78BFA' },
              { title: 'Charged to a partner', count: centres ? routed : '…', color: '#F5A623' },
              { title: 'Spent to date', count: centres ? formatMoney(spent, { decimals: false }) : '…', color: '#34D399' },
            ]}
          />
        </div>

        <NoticeLine notice={notice} onClose={() => setNotice(null)} />

        <Section
          title="Cost centres"
          subtitle="Tag spending on a money-out or general entry. A centre charged to a partner is paid out of their profit, not the unit’s P&L."
          actions={
            canManage && (
              <Button icon={<PlusIcon />} onClick={() => setEditing('new')}>
                New cost centre
              </Button>
            )
          }
        >
          {!centres ? (
            <p className="py-6 text-center text-sm text-gray-500">Loading…</p>
          ) : !centres.length ? (
            <p className="py-6 text-center text-sm text-gray-500">No cost centres yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-180 text-left text-sm">
                <thead className="bg-gray-50 text-xs text-gray-900">
                  <tr>
                    <th className={th}>Code</th>
                    <th className={th}>Name</th>
                    <th className={th}>Charged to</th>
                    <th className={th}>Used by</th>
                    <th className={`${th} text-right`}>Spent to date</th>
                    <th className={`${th} text-right`}>Entries</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {centres.map((c) => (
                    <tr key={c.id} className={`border-t border-gray-200 ${c.isActive ? '' : 'text-gray-400'}`}>
                      <td className={`${td} font-mono text-xs font-semibold`}>{c.code}</td>
                      <td className={td}>
                        {canReport ? (
                          <Link href={`/cost-centres/${c.id}`} className="font-medium text-gray-900 hover:text-accent">
                            {c.name}
                          </Link>
                        ) : (
                          <span className="font-medium">{c.name}</span>
                        )}
                        {c.description && <p className="max-w-md truncate text-xs text-gray-500">{c.description}</p>}
                      </td>
                      <td className={td}>
                        {c.chargeTo === 'PARTNER' ? (
                          <Pill tone="violet">{c.partner?.shortName}&apos;s profit</Pill>
                        ) : (
                          <Pill>Unit’s own P&amp;L</Pill>
                        )}
                        {!c.isActive && <span className="ml-1.5"><Pill>Inactive</Pill></span>}
                      </td>
                      <td className={td}>{c.businessUnit ? c.businessUnit.code : 'Any unit'}</td>
                      <td className={`${td} text-right tabular-nums`}>{formatMoney(c.spent ?? '0')}</td>
                      <td className={`${td} text-right tabular-nums`}>{c.entryCount ?? 0}</td>
                      <td className={`${td} text-right`}>
                        {canManage && (
                          <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>
                            Edit
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      <CostCentreModal
        isOpen={editing !== null}
        centre={editing === 'new' ? null : editing}
        units={units}
        isPartner={isPartner}
        onClose={() => setEditing(null)}
        onSaved={(c) => {
          setEditing(null);
          setNotice({ tone: 'ok', text: `Cost centre ${c.code} saved.` });
          void refresh();
        }}
      />
    </div>
  );
}
