'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '../../../../../components/layout/UserProvider';
import Button from '../../../../../components/ui/Button';
import Input from '../../../../../components/ui/Input';
import Select from '../../../../../components/ui/Select';
import ConfirmModal from '../../../../../components/ui/ConfirmModal';
import { Figure, NoticeLine, Pill, Section, TextArea, type Notice } from '../../../../../components/hr/ui';
import { BONUS_TIER_LABELS, formatMonth, listEmployees, type BonusTier, type EmployeeRecord } from '../../../../../lib/api/hr';
import {
  deleteBonusPool,
  getBonusPool,
  reviewBonusPool,
  setBonusMembers,
  updateBonusPool,
  type BonusPoolDetail,
} from '../../../../../lib/api/payroll';
import { errorMessage, formatMoney, fromPaisa, isAmount, toPaisa } from '../../../../../lib/money';
import PdfButton from '../../../../../components/reports/PdfButton';


type Member = { employeeId: string; tier: BonusTier; units: string };
const UNITS = /^\d{1,8}(\.\d{1,2})?$/;

/**
 * One commission pool — the Bonus Calculator sheet as a record: the sales,
 * each tier's share of the pool, and who shares it (by head, or by trips).
 */
export default function BonusPoolPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { hasPermission } = useUser();
  const canRun = hasPermission('payroll.run');

  const [pool, setPool] = useState<BonusPoolDetail | null>(null);
  const [staff, setStaff] = useState<EmployeeRecord[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [title, setTitle] = useState('');
  const [basis, setBasis] = useState('');
  const [sales, setSales] = useState('');
  const [adding, setAdding] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback((p: BonusPoolDetail) => {
    setPool(p);
    setMembers(p.members.map((x) => ({ employeeId: x.employeeId, tier: x.tier, units: x.units })));
    setTitle(p.title);
    setBasis(p.basis ?? '');
    setSales(p.qualifyingSales);
  }, []);

  useEffect(() => {
    getBonusPool(id).then(
      (p) => {
        load(p);
        void listEmployees({ businessUnitId: p.businessUnit.id }).then(setStaff);
      },
      (err) => setNotice({ tone: 'error', text: errorMessage(err, 'Could not load this pool.') }),
    );
  }, [id, load]);

  const dirtyMembers = useMemo(
    () => pool !== null && JSON.stringify(members) !== JSON.stringify(pool.members.map((x) => ({ employeeId: x.employeeId, tier: x.tier, units: x.units }))),
    [members, pool],
  );
  const dirtyDetails = pool !== null && (title !== pool.title || basis !== (pool.basis ?? '') || sales !== pool.qualifyingSales);

  if (!pool) return <div className="p-8 text-center text-sm text-gray-500">{notice?.text ?? 'Loading…'}</div>;
  const draft = pool.status === 'DRAFT';
  const editable = draft && canRun;
  const tierRule = (t: BonusTier) => pool.tiers.find((x) => x.tier === t);
  const nameOf = (eid: string) => staff.find((s) => s.id === eid) ?? null;
  const addable = staff.filter((s) => !members.some((m) => m.employeeId === s.id));

  async function run(fn: () => Promise<BonusPoolDetail>, ok: string) {
    setBusy(true);
    try {
      load(await fn());
      setNotice({ tone: 'ok', text: ok });
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, 'That didn’t work.') });
    } finally {
      setBusy(false);
    }
  }

  function add(eid: string) {
    const e = nameOf(eid);
    if (!e) return;
    const own = e.effectiveBonusTier;
    const tier = pool && pool.tiers.some((t) => t.tier === own) ? own : (pool?.tiers[0]?.tier ?? 'WORKER');
    setMembers((ms) => [...ms, { employeeId: eid, tier, units: '1' }]);
    setAdding('');
  }

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <Section
          title={
            <span className="flex flex-wrap items-center gap-2">
              <Link href="/payroll" className="text-gray-400 hover:text-accent">
                Payroll
              </Link>
              <span className="text-gray-300">/</span>
              {pool.title}
              <Pill tone={draft ? 'amber' : 'green'}>{draft ? 'Draft' : 'Approved'}</Pill>
            </span>
          }
          subtitle={`${pool.businessUnit.name} · paid with ${formatMonth(pool.month)} salaries · rules from payroll policy v${pool.policyVersion}${pool.approvedByName ? ` · approved by ${pool.approvedByName}` : ''}`}
          actions={
            <>
              <PdfButton report="bonus-sheet" params={{ poolId: pool.id }} />
              {canRun && (
              <>
                {draft && (
                  <Button variant="secondary" onClick={() => setConfirmDelete(true)}>
                    Delete
                  </Button>
                )}
                {draft ? (
                  <Button disabled={busy || dirtyMembers || dirtyDetails} title={dirtyMembers || dirtyDetails ? 'Save your changes first' : undefined} onClick={() => void run(() => reviewBonusPool(pool.id, 'approve'), 'Approved — the shares go into the month’s payroll.')}>
                    Approve
                  </Button>
                ) : (
                  <Button variant="secondary" disabled={busy || pool.paidInPayslips > 0} title={pool.paidInPayslips ? 'Already on finalised payslips' : undefined} onClick={() => void run(() => reviewBonusPool(pool.id, 'unapprove'), 'Back to draft.')}>
                    Back to draft
                  </Button>
                )}
              </>
            )}
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Figure label="Qualifying sales" value={formatMoney(pool.qualifyingSales)} />
            <Figure label={`Pool (${pool.commissionPct}%, rounded down)`} value={formatMoney(pool.pool)} tone="accent" />
            <Figure label="Shared out" value={formatMoney(fromPaisa(toPaisa(pool.pool) - toPaisa(pool.undistributed)))} />
            <Figure
              label={pool.undistributed.startsWith('-') ? 'Paid over by rounding up' : 'Not shared (no one in the tier)'}
              value={formatMoney(pool.undistributed.replace('-', ''))}
              tone={pool.undistributed !== '0.00' && !pool.undistributed.startsWith('-') ? 'danger' : undefined}
            />
          </div>
          {pool.paidInPayslips > 0 && <p className="text-xs text-gray-600">On {pool.paidInPayslips} finalised payslips.</p>}
        </Section>

        <NoticeLine notice={notice} onClose={() => setNotice(null)} />

        {editable && (
          <Section title="Sales" actions={dirtyDetails && <Button disabled={busy || !isAmount(sales) || title.trim().length < 2} onClick={() => void run(() => updateBonusPool(pool.id, { title: title.trim(), basis: basis.trim(), qualifyingSales: sales.trim() }), 'Saved.')}>Save</Button>}>
            <div className="grid gap-4 md:grid-cols-2">
              <Input label="Name" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
              <Input label="Qualifying sales (Rs)" inputMode="decimal" value={sales} onChange={(e) => setSales(e.target.value.replace(/[^\d.]/g, ''))} />
            </div>
            <TextArea label="What the sales are" value={basis} rows={2} onChange={setBasis} />
          </Section>
        )}

        <Section title="Tiers" subtitle="Each tier takes its share of the pool, then divides it between its people.">
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full min-w-160 text-left text-sm">
              <thead className="bg-gray-50 text-xs text-gray-900">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Tier</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Share</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                  <th className="px-4 py-2.5 font-semibold">Divided</th>
                  <th className="px-4 py-2.5 text-right font-semibold">People</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Paid out</th>
                </tr>
              </thead>
              <tbody>
                {pool.tiers.map((t) => (
                  <tr key={t.tier} className="border-t border-gray-100">
                    <td className="px-4 py-2.5 font-medium">{BONUS_TIER_LABELS[t.tier]}s</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{t.pct}%</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(t.amount)}</td>
                    <td className="px-4 py-2.5 text-gray-700">
                      {t.split === 'EQUAL' ? 'per person' : `by ${t.unitLabel ?? 'units'}${t.perUnit ? ` — ${formatMoney(t.perUnit)} each` : ''}`}
                      {t.roundUp ? ', rounded up' : ''}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{t.split === 'EQUAL' ? t.headcount : `${t.headcount} · ${Number(t.totalUnits)} ${t.unitLabel ?? ''}`}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{t.headcount ? formatMoney(t.distributed) : <span className="text-danger">nobody</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section
          title="Who shares it"
          subtitle={editable ? 'Everyone at the unit with a bonus tier was added to start with. Changes are shared out when you save.' : undefined}
          actions={editable && dirtyMembers && (
            <Button
              disabled={busy || members.some((mm) => !UNITS.test(mm.units))}
              onClick={() => void run(() => setBonusMembers(pool.id, members), 'Saved — shares recalculated.')}
            >
              Save people
            </Button>
          )}
        >
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full min-w-160 text-left text-sm">
              <thead className="bg-gray-50 text-xs text-gray-900">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Person</th>
                  <th className="px-4 py-2.5 font-semibold">Tier</th>
                  <th className="px-4 py-2.5 font-semibold">Count</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Share</th>
                  {editable && <th className="px-4 py-2.5" />}
                </tr>
              </thead>
              <tbody>
                {members.map((mm, i) => {
                  const saved = pool.members.find((x) => x.employeeId === mm.employeeId);
                  const who = nameOf(mm.employeeId);
                  const rule = tierRule(mm.tier);
                  return (
                    <tr key={mm.employeeId} className="border-t border-gray-100">
                      <td className="px-4 py-2">
                        <p className="font-medium text-gray-900">{who?.fullName ?? saved?.fullName}</p>
                        <p className="text-xs text-gray-500">{who?.designation.name ?? saved?.designation}</p>
                      </td>
                      <td className="w-48 px-4 py-2">
                        {editable ? (
                          <Select
                            value={mm.tier}
                            onChange={(v) => setMembers((ms) => ms.map((x, j) => (j === i ? { ...x, tier: v as BonusTier } : x)))}
                            options={pool.tiers.map((t) => ({ label: BONUS_TIER_LABELS[t.tier], value: t.tier }))}
                          />
                        ) : (
                          BONUS_TIER_LABELS[mm.tier]
                        )}
                      </td>
                      <td className="w-40 px-4 py-2">
                        {rule?.split === 'BY_UNITS' ? (
                          editable ? (
                            <Input
                              value={mm.units}
                              inputMode="decimal"
                              aria-label={rule.unitLabel ?? 'units'}
                              errorText={UNITS.test(mm.units) ? undefined : 'A number'}
                              onChange={(e) => setMembers((ms) => ms.map((x, j) => (j === i ? { ...x, units: e.target.value } : x)))}
                            />
                          ) : (
                            `${mm.units} ${rule.unitLabel ?? ''}`
                          )
                        ) : (
                          <span className="text-gray-400">per head</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-medium tabular-nums">{saved && !dirtyMembers ? formatMoney(saved.amount) : <span className="text-gray-400">save to see</span>}</td>
                      {editable && (
                        <td className="px-4 py-2 text-right">
                          <button type="button" className="text-sm text-gray-400 hover:text-danger" onClick={() => setMembers((ms) => ms.filter((_, j) => j !== i))}>
                            Remove
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {members.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-gray-500">
                      Nobody yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {editable && addable.length > 0 && (
            <div className="w-full md:w-80">
              <Select
                showSearch
                placeholder="Add someone…"
                value={adding}
                onChange={add}
                options={addable.map((s) => ({ label: `${s.fullName} · ${s.designation.name}`, value: s.id }))}
              />
            </div>
          )}
        </Section>
      </div>

      <ConfirmModal
        isOpen={confirmDelete}
        title="Delete this pool?"
        message="Nothing has been paid from a draft pool; it’s simply removed."
        confirmLabel="Delete"
        variant="danger"
        isSubmitting={busy}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          try {
            await deleteBonusPool(pool.id);
            router.push('/payroll');
          } catch (err) {
            setNotice({ tone: 'error', text: errorMessage(err, 'Could not delete it.') });
            setConfirmDelete(false);
          }
        }}
      />
    </div>
  );
}
