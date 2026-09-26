'use client';

import { useEffect, useMemo, useState } from 'react';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { MonthPicker, UnitPicker } from '../hr/ui';
import type { BusinessUnitRecord } from '../../lib/api/ledger';
import { listPartners } from '../../lib/api/allocation';
import { formatMonth } from '../../lib/api/hr';
import { getPayrollRun, listBonusPools, listSettlements } from '../../lib/api/payroll';
import { listCounterparties } from '../../lib/api/loans';
import { listBills } from '../../lib/api/utilities';
import { listSalesEvents } from '../../lib/api/sales';
import { listCampaigns } from '../../lib/api/capex';
import { listCostCentres } from '../../lib/api/cost-centres';
import { listPayrollRuns, type ReportDefinition, type ReportParamName, type ReportParams } from '../../lib/api/reports';
import { formatDate, todayIso } from '../../lib/money';

type Option = { label: string; value: string };

/** Params a schedule works out for itself from its period. */
export const PERIOD_PARAMS: ReportParamName[] = ['asOf', 'from', 'to', 'month', 'year'];

const STATUS_OPTIONS: Record<string, Option[]> = {
  disciplinary: [
    { label: 'Any status', value: '' },
    { label: 'Approved', value: 'APPROVED' },
    { label: 'Awaiting approval', value: 'PENDING_APPROVAL' },
    { label: 'Rejected', value: 'REJECTED' },
    { label: 'Withdrawn', value: 'WITHDRAWN' },
  ],
  'capex-register': [
    { label: 'Everything', value: '' },
    { label: 'In use', value: 'ACTIVE' },
    { label: 'Retired', value: 'RETIRED' },
  ],
};

/** Sensible starting values: today, this month so far, last month, this year. */
export function defaultParams(def: ReportDefinition): ReportParams {
  const today = todayIso();
  const [y, m] = today.split('-').map(Number);
  const lastMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const out: ReportParams = {};
  for (const p of def.params) {
    if (p.name === 'asOf') out.asOf = today;
    if (p.name === 'from') out.from = def.key === 'disciplinary' ? `${y}-01-01` : `${today.slice(0, 8)}01`;
    if (p.name === 'to') out.to = today;
    if (p.name === 'month') out.month = def.key === 'attendance-summary' ? today.slice(0, 7) : lastMonth;
    if (p.name === 'year') out.year = y;
  }
  return out;
}

/** Loads the choices for a report's record pickers (runs, pools, bills …). */
function useOptions(def: ReportDefinition, runId: string | undefined) {
  const [options, setOptions] = useState<Partial<Record<ReportParamName, Option[]>>>({});
  const names = useMemo(() => def.params.map((p) => p.name).join(','), [def]);

  useEffect(() => {
    let live = true;
    const set = (name: ReportParamName, list: Option[]) => live && setOptions((o) => ({ ...o, [name]: list }));
    const want = (n: ReportParamName) => names.split(',').includes(n);
    if (want('partnerId'))
      void listPartners().then((ps) => set('partnerId', ps.map((p) => ({ label: `${p.name} (${p.shortName})`, value: p.id }))));
    if (want('runId'))
      void listPayrollRuns().then((rs) =>
        set('runId', rs.map((r) => ({ label: `${r.businessUnit.code} · ${formatMonth(r.month)} · ${r.status.toLowerCase()}`, value: r.id }))),
      );
    if (want('poolId'))
      void listBonusPools().then((ps) => set('poolId', ps.map((p) => ({ label: `${p.title} · ${p.businessUnit.code} · ${formatMonth(p.month)}`, value: p.id }))));
    if (want('settlementId'))
      void listSettlements().then((ss) =>
        set(
          'settlementId',
          ss.map((s) => ({ label: `${s.employee.fullName} · ${s.businessUnit.code}${s.exitDate ? ` · left ${formatDate(s.exitDate)}` : ''}`, value: s.id })),
        ),
      );
    if (want('counterpartyId'))
      void listCounterparties().then((cs) => set('counterpartyId', [{ label: 'All counterparties (summary)', value: '' }, ...cs.map((c) => ({ label: c.name, value: c.id }))]));
    if (want('billId'))
      void listBills().then((bs) =>
        set('billId', bs.map((b) => ({ label: `${b.connection.name} · ${formatDate(b.periodFrom)} – ${formatDate(b.periodTo)}${b.status === 'DRAFT' ? ' · draft' : ''}`, value: b.id }))),
      );
    if (want('eventId')) void listSalesEvents().then((es) => set('eventId', [{ label: 'No event', value: '' }, ...es.map((e) => ({ label: e.name, value: e.id }))]));
    if (want('campaignId')) void listCampaigns().then((cs) => set('campaignId', cs.map((c) => ({ label: `${c.name} · ${c.businessUnit.code}`, value: c.id }))));
    if (want('costCentreId')) void listCostCentres().then((cs) => set('costCentreId', cs.map((c) => ({ label: `${c.code} — ${c.name}`, value: c.id }))));
    return () => {
      live = false;
    };
  }, [names]);

  // A payslip for one person: the people on the chosen run.
  useEffect(() => {
    if (!names.includes('employeeId') || !runId) {
      setOptions((o) => ({ ...o, employeeId: [] }));
      return;
    }
    let live = true;
    void getPayrollRun(runId).then(
      (run) =>
        live &&
        setOptions((o) => ({
          ...o,
          employeeId: [{ label: 'Everyone on the run', value: '' }, ...run.rows.map((r) => ({ label: `${r.fullName} (${r.employeeCode})`, value: r.employeeId }))],
        })),
    );
    return () => {
      live = false;
    };
  }, [names, runId]);

  return options;
}

/**
 * The inputs a report takes, from its definition in the catalogue. With
 * `forSchedule`, the period inputs are left out — the schedule's period
 * fills them in on each run.
 */
export default function ReportParamsForm({
  def,
  values,
  onChange,
  units,
  forSchedule = false,
}: {
  def: ReportDefinition;
  values: ReportParams;
  onChange: (v: ReportParams) => void;
  units: BusinessUnitRecord[];
  forSchedule?: boolean;
}) {
  const options = useOptions(def, values.runId ? String(values.runId) : undefined);
  const set = (name: ReportParamName, value: string | number) => onChange({ ...values, [name]: value });
  const thisYear = Number(todayIso().slice(0, 4));
  const params = def.params.filter((p) => !forSchedule || !PERIOD_PARAMS.includes(p.name));
  if (!params.length) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {params.map((p) => {
        const value = values[p.name] === undefined ? '' : String(values[p.name]);
        const label = p.label;
        switch (p.name) {
          case 'asOf':
          case 'from':
          case 'to':
            return <Input key={p.name} label={label} type="date" required={p.required} value={value} max={todayIso()} onChange={(e) => set(p.name, e.target.value)} />;
          case 'month':
            return (
              <div key={p.name} className="flex flex-col gap-1.5">
                <span className="text-sm text-gray-800 md:text-base">
                  {label} {p.required && <span className="text-red-500"> *</span>}
                </span>
                <MonthPicker value={value || todayIso().slice(0, 7)} onChange={(v) => set(p.name, v)} />
              </div>
            );
          case 'year':
            return (
              <Select
                key={p.name}
                label={label}
                required={p.required}
                value={value}
                onChange={(v) => set(p.name, Number(v))}
                options={Array.from({ length: 6 }, (_, i) => String(thisYear - i)).map((y) => ({ label: y, value: y }))}
              />
            );
          case 'businessUnitId':
            return (
              <UnitPicker
                key={p.name}
                label={p.required ? `${label} *` : label}
                units={units}
                value={value}
                onChange={(v) => set(p.name, v)}
                allowAll={!p.required}
              />
            );
          case 'status':
            return <Select key={p.name} label={label} value={value} onChange={(v) => set(p.name, v)} options={STATUS_OPTIONS[def.key] ?? []} />;
          default: {
            const list = options[p.name];
            const optionalEmpty = !p.required && list && !list.some((o) => o.value === '');
            return (
              <Select
                key={p.name}
                label={label}
                required={p.required}
                showSearch
                placeholder={!list ? 'Loading…' : list.length ? 'Choose…' : p.name === 'employeeId' && !values.runId ? 'Pick a payroll run first' : 'Nothing to choose from yet'}
                value={value}
                onChange={(v) => set(p.name, v)}
                options={optionalEmpty ? [{ label: '—', value: '' }, ...list] : (list ?? [])}
              />
            );
          }
        }
      })}
    </div>
  );
}

/** "Daily at 23:30", "Mondays at 07:00", "The 1st of each month at 07:00". */
export function describeTiming(s: { cadence: string; runAt: string; weekday: number | null; dayOfMonth: number | null }): string {
  const days = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
  if (s.cadence === 'WEEKLY') return `${days[(s.weekday ?? 1) - 1]} at ${s.runAt}`;
  if (s.cadence === 'MONTHLY') {
    const d = s.dayOfMonth ?? 1;
    const suffix = d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th';
    return `The ${d}${suffix} of each month at ${s.runAt}`;
  }
  return `Daily at ${s.runAt}`;
}
