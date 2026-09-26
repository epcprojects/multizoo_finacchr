'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser } from '../../../components/layout/UserProvider';
import Button from '../../../components/ui/Button';
import PageBanner from '../../../components/ui/PageBanner';
import { PlusIcon } from '../../../components/ui/icons';
import { NoticeLine, Pill, Section, type Notice } from '../../../components/hr/ui';
import { CampaignModal } from '../../../components/campaigns/CampaignModals';
import { listBusinessUnits, type BusinessUnitRecord } from '../../../lib/api/ledger';
import { listCampaigns, type CampaignSummary } from '../../../lib/api/capex';
import { errorMessage, formatDate, formatMoney, toPaisa } from '../../../lib/money';

const th = 'px-4 py-2.5 font-semibold';
const td = 'px-4 py-2.5';

/**
 * Seasonal campaigns (architecture plan Part 03 §11) — the `Ramazan 2023`
 * sheet: money raised for a drive against money spent on it, a
 * date-bounded P&L outside the unit's monthly cycle.
 */
export default function CampaignsPage() {
  const router = useRouter();
  const { hasPermission } = useUser();
  const canManage = hasPermission('capex.manage');
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null);
  const [units, setUnits] = useState<BusinessUnitRecord[]>([]);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const refresh = useCallback(async () => {
    try {
      setCampaigns(await listCampaigns());
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, 'Could not load campaigns.') });
    }
  }, []);

  useEffect(() => {
    void refresh();
    void listBusinessUnits().then((u) => setUnits(u.filter((x) => x.isActive && !x.isHolding)));
  }, [refresh]);

  const open = (campaigns ?? []).filter((c) => c.status === 'OPEN');
  const raised = (campaigns ?? []).reduce((s, c) => s + toPaisa(c.income), 0n);
  const spent = (campaigns ?? []).reduce((s, c) => s + toPaisa(c.expenses), 0n);

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <div className="shrink-0">
          <PageBanner
            imageSrc="/campaigns-icon.svg"
            imageAlt="Campaigns"
            title="Campaigns"
            stats={[
              { title: 'Running', count: campaigns ? open.length : '…', color: '#34D399' },
              { title: 'Raised, all campaigns', count: campaigns ? formatMoney(raised, { decimals: false }) : '…', color: '#60A5FA' },
              { title: 'Spent, all campaigns', count: campaigns ? formatMoney(spent, { decimals: false }) : '…', color: '#F5A623' },
            ]}
          />
        </div>
        <NoticeLine notice={notice} onClose={() => setNotice(null)} />
        <Section
          title="Campaigns"
          subtitle="Each runs through its own fund in the host unit, so donations never reach the waterfall and its spending stays out of the unit’s expenses until it’s closed."
          actions={
            canManage && (
              <Button icon={<PlusIcon />} onClick={() => setCreating(true)}>
                New campaign
              </Button>
            )
          }
        >
          {!campaigns ? (
            <p className="py-6 text-center text-sm text-gray-500">Loading…</p>
          ) : !campaigns.length ? (
            <p className="py-6 text-center text-sm text-gray-500">No campaigns yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-180 text-left text-sm">
                <thead className="bg-gray-50 text-xs text-gray-900">
                  <tr>
                    <th className={th}>Campaign</th>
                    <th className={th}>Runs</th>
                    <th className={`${th} text-right`}>Raised</th>
                    <th className={`${th} text-right`}>Spent</th>
                    <th className={`${th} text-right`}>Balance</th>
                    <th className={`${th} text-right`}>Budget</th>
                    <th className={th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr key={c.id} className="border-t border-gray-200">
                      <td className={td}>
                        <Link href={`/campaigns/${c.id}`} className="font-medium text-gray-900 hover:text-accent">
                          {c.name}
                        </Link>
                        <span className="block text-xs text-gray-500">{c.businessUnit.name}</span>
                      </td>
                      <td className={`${td} whitespace-nowrap`}>
                        {formatDate(c.startDate)}
                        {c.endDate ? ` – ${formatDate(c.endDate)}` : ' on'}
                      </td>
                      <td className={`${td} text-right tabular-nums`}>{formatMoney(c.income, { decimals: false })}</td>
                      <td className={`${td} text-right tabular-nums`}>{formatMoney(c.expenses, { decimals: false })}</td>
                      <td className={`${td} text-right tabular-nums font-medium ${c.balance.startsWith('-') ? 'text-danger' : ''}`}>{formatMoney(c.balance, { decimals: false })}</td>
                      <td className={`${td} text-right tabular-nums text-gray-600`}>{c.budgetTotal ? formatMoney(c.budgetTotal, { decimals: false }) : '—'}</td>
                      <td className={td}>{c.status === 'OPEN' ? <Pill tone="green">Running</Pill> : <Pill>Closed</Pill>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
      <CampaignModal
        isOpen={creating}
        campaign={null}
        units={units}
        onClose={() => setCreating(false)}
        onSaved={(c) => {
          setCreating(false);
          router.push(`/campaigns/${c.id}`);
        }}
      />
    </div>
  );
}
