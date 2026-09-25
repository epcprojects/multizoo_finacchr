'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useUser } from '../../../../components/layout/UserProvider';
import Button from '../../../../components/ui/Button';
import PageBanner from '../../../../components/ui/PageBanner';
import { NoticeLine, Pill, Section, type Notice } from '../../../../components/hr/ui';
import PayrollPolicyModal from '../../../../components/payroll/PayrollPolicyModal';
import { BONUS_TIER_LABELS, EMPLOYMENT_TYPE_LABELS } from '../../../../lib/api/hr';
import { listPayrollPolicies, type PayrollPolicyRecord } from '../../../../lib/api/payroll';
import { errorMessage, formatDate, formatMoney } from '../../../../lib/money';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-gray-50 p-3">
      <span className="text-[11px] uppercase tracking-wide text-gray-500">{label}</span>
      <span className="text-sm text-gray-900">{children}</span>
    </div>
  );
}

function PolicyFacts({ p }: { p: PayrollPolicyRecord }) {
  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      <Fact label="A day’s pay">Monthly salary ÷ {p.daysPerMonth}</Fact>
      <Fact label="EOBI">
        {p.eobiEnabled ? (
          <>
            {p.eobiEmployeePct}% employee + {p.eobiEmployerPct}% employer of {formatMoney(p.eobiMinimumWage, { decimals: false })} —{' '}
            {p.eobiEmploymentTypes.map((t) => EMPLOYMENT_TYPE_LABELS[t].toLowerCase()).join(', ')}
          </>
        ) : (
          <span className="text-gray-500">Off (loaded: {p.eobiEmployeePct}% + {p.eobiEmployerPct}% of {formatMoney(p.eobiMinimumWage, { decimals: false })})</span>
        )}
      </Fact>
      <Fact label="Income tax">
        {p.taxEnabled ? null : <span className="text-gray-500">Off — loaded bands: </span>}
        {p.taxBands.map((b) => `${b.rate}% from ${formatMoney(b.from, { decimals: false, prefix: false })}`).join(' · ')}
      </Fact>
      <Fact label="Provident fund">{p.pfEnabled ? `${p.pfEmployeePct}% employee + ${p.pfEmployerPct}% employer` : <span className="text-gray-500">Off</span>}</Fact>
      <Fact label="Commission pool">{p.commissionPct}% of qualifying sales, rounded down to the rupee</Fact>
      <Fact label="Tiers">
        {p.bonusTiers
          .map((t) => `${BONUS_TIER_LABELS[t.tier]}s ${t.pct}% ${t.split === 'EQUAL' ? 'per head' : `by ${t.unitLabel ?? 'units'}`}${t.roundUp ? ' (rounded up)' : ''}`)
          .join(' · ')}
      </Fact>
    </div>
  );
}

/**
 * Payroll setup: the versioned payroll policy (Fig. 16) — the day-rate
 * divisor, EOBI, income tax, provident fund and the commission pool.
 */
export default function PayrollSettingsPage() {
  const { hasPermission } = useUser();
  const canEdit = hasPermission('rules.edit_hr_policy');
  const [policies, setPolicies] = useState<PayrollPolicyRecord[] | null>(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const refresh = useCallback(async () => {
    try {
      setPolicies(await listPayrollPolicies());
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, 'Could not load the payroll policy.') });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const current = policies?.find((p) => p.isCurrent) ?? null;
  const upcoming = policies?.filter((p) => p.isUpcoming) ?? [];

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <div className="shrink-0">
          <PageBanner
            imageSrc="/payroll-icon.svg"
            imageAlt="Payroll setup"
            title="Payroll setup"
            stats={[
              { title: 'Version in force', count: current ? `v${current.version}` : '—', color: '#34D399' },
              { title: 'Statutory deductions', count: current ? [current.eobiEnabled && 'EOBI', current.taxEnabled && 'Tax', current.pfEnabled && 'PF'].filter(Boolean).join(' · ') || 'Off' : '…', color: '#F5A623' },
              { title: 'Scheduled changes', count: upcoming.length, color: '#60A5FA' },
            ]}
          />
        </div>

        <NoticeLine notice={notice} onClose={() => setNotice(null)} />

        <Section
          title="Payroll policy in force"
          subtitle={current ? `v${current.version}, since ${formatDate(current.effectiveFrom)}${current.note ? ` — ${current.note}` : ''}` : undefined}
          actions={canEdit && <Button onClick={() => setOpen(true)}>New version</Button>}
        >
          {current ? <PolicyFacts p={current} /> : <p className="text-sm text-gray-500">{policies ? 'No payroll policy yet — run the seed or publish one.' : 'Loading…'}</p>}
          <p className="text-xs text-gray-600">
            EOBI, tax and provident fund stay off until the accountant confirms them against current law — the salary sheet deducts none of them. A change is a new
            version from a date; months already paid keep the version they were paid on.
          </p>
        </Section>

        {policies && policies.length > 1 && (
          <Section title="Version history">
            <div className="flex flex-col gap-3">
              {policies.map((p) => (
                <details key={p.id} className="rounded-xl border border-gray-200 p-3">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold">v{p.version}</span>
                    <span className="text-gray-600">
                      from {formatDate(p.effectiveFrom)}
                      {p.effectiveTo ? ` to ${formatDate(p.effectiveTo)}` : ''}
                    </span>
                    {p.isCurrent && <Pill tone="green">In force</Pill>}
                    {p.isUpcoming && <Pill tone="blue">Upcoming</Pill>}
                    {p.status === 'SUPERSEDED' && <Pill>Replaced before use</Pill>}
                    {p.createdByName && <span className="text-xs text-gray-500">by {p.createdByName}</span>}
                  </summary>
                  <div className="mt-3 flex flex-col gap-2">
                    {p.note && <p className="text-sm text-gray-700">{p.note}</p>}
                    <PolicyFacts p={p} />
                  </div>
                </details>
              ))}
            </div>
          </Section>
        )}
      </div>

      <PayrollPolicyModal
        isOpen={open}
        current={upcoming[0] ?? current}
        onClose={() => setOpen(false)}
        onSaved={(message) => {
          setOpen(false);
          setNotice({ tone: 'ok', text: message });
          void refresh();
        }}
      />
    </div>
  );
}
