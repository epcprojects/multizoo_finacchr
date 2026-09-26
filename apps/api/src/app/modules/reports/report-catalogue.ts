import { Permission } from '@multizoo/types';
import { HR_VIEWERS } from '../hr/hr-common';
import { PAYROLL_VIEWERS } from '../payroll/payroll-common';
import { PeriodKind } from './report-periods';

const P = Permission;

/** Everything a report can be asked for. Which ones apply is in its definition. */
export interface ReportParams {
  asOf?: string;
  from?: string;
  to?: string;
  month?: string;
  year?: number;
  businessUnitId?: string;
  partnerId?: string;
  runId?: string;
  employeeId?: string;
  poolId?: string;
  settlementId?: string;
  counterpartyId?: string;
  billId?: string;
  eventId?: string;
  campaignId?: string;
  costCentreId?: string;
  status?: string;
}

export type ReportParamName = keyof ReportParams;

export type ReportGroup = 'Finance' | 'HR & payroll' | 'Operations';

export interface ReportParamSpec {
  name: ReportParamName;
  required: boolean;
  /** What the picker is labelled on the Report centre. */
  label: string;
}

export interface ReportDefinition {
  key: string;
  title: string;
  group: ReportGroup;
  description: string;
  /** From the plan's report table (Part 08). */
  cadence: string;
  audience: string;
  period: PeriodKind;
  params: ReportParamSpec[];
  /**
   * The data it shows is what these screens show, so it needs one of the
   * same permissions — plus `reports.generate`, or `reports.generate_own_unit`
   * with the data scoped to the caller's units by the same services.
   */
  permissions: Permission[];
  /** Wide tables (grids, registers) print on landscape A4. */
  landscape: boolean;
  /** False for a report with no money in it. */
  amounts?: boolean;
}

const unit = (required = false): ReportParamSpec => ({ name: 'businessUnitId', required, label: 'Business unit' });
const range: ReportParamSpec[] = [
  { name: 'from', required: true, label: 'From' },
  { name: 'to', required: true, label: 'To' },
];

/**
 * The reporting suite — every report in the architecture plan's Part 08
 * table, plus the HR reports from Part 07. Order is the Report centre's.
 */
export const REPORTS: ReportDefinition[] = [
  // --- Finance -------------------------------------------------------------------------
  {
    key: 'cash-position',
    title: 'Daily cash position',
    group: 'Finance',
    description: 'Cash, bank and wallet balances for each unit at the end of a day, with the day’s money in and out.',
    cadence: 'Daily',
    audience: 'Partners, accountant',
    period: PeriodKind.DATE,
    params: [{ name: 'asOf', required: true, label: 'As at' }, unit()],
    permissions: [P.LEDGER_VIEW],
    landscape: false,
  },
  {
    key: 'expenses',
    title: 'Expense report by category',
    group: 'Finance',
    description: 'Spending by account title and sub-title for a day or a week, per unit, with every expense line behind it.',
    cadence: 'Daily / weekly',
    audience: 'Accountant, branch managers',
    period: PeriodKind.RANGE,
    params: [...range, unit()],
    permissions: [P.LEDGER_VIEW, P.TRANSACTIONS_CREATE_OWN_UNIT],
    landscape: false,
  },
  {
    key: 'category-rollup',
    title: 'Monthly category rollup',
    group: 'Finance',
    description: 'A unit’s year month by month: sales, each expense heading, the net, and each partner’s share — the daily-expense tabs’ P&L block.',
    cadence: 'Monthly',
    audience: 'Partners, accountant',
    period: PeriodKind.YEAR,
    params: [{ name: 'year', required: true, label: 'Year' }, unit()],
    permissions: [P.PNL_VIEW_CONSOLIDATED],
    landscape: true,
  },
  {
    key: 'pnl',
    title: 'Profit & loss',
    group: 'Finance',
    description: 'Income, expenses and net profit for a period — every unit side by side with the consolidated total, and the partners’ shares.',
    cadence: 'Monthly',
    audience: 'Partners',
    period: PeriodKind.RANGE,
    params: [...range, unit()],
    permissions: [P.PNL_VIEW_CONSOLIDATED],
    landscape: true,
  },
  {
    key: 'partner-statement',
    title: 'Partner profit & drawings statement',
    group: 'Finance',
    description: 'A partner’s share of each unit’s monthly profit, what they drew against it, and the balance — the Profit & Loss Statement sheet.',
    cadence: 'Monthly',
    audience: 'Each partner',
    period: PeriodKind.YEAR,
    params: [
      { name: 'partnerId', required: true, label: 'Partner' },
      { name: 'year', required: true, label: 'Year' },
    ],
    permissions: [P.PNL_VIEW_CONSOLIDATED, P.PNL_VIEW_OWN_SHARE],
    landscape: false,
  },
  {
    key: 'loans',
    title: 'Loan & payable/receivable statement',
    group: 'Finance',
    description: 'One counterparty’s loans and every movement with the running balance — or, with none picked, what’s owed each way across all loans.',
    cadence: 'On demand',
    audience: 'Partners, accountant',
    period: PeriodKind.RECORD,
    params: [{ name: 'counterpartyId', required: false, label: 'Counterparty' }],
    permissions: [P.LOANS_INITIATE, P.LOANS_APPROVE],
    landscape: false,
  },
  {
    key: 'cost-centre',
    title: 'Cost-centre report',
    group: 'Finance',
    description: 'A cost centre’s spending by category and month, and who bore it (the "342" sheets).',
    cadence: 'Monthly',
    audience: 'Partners, accountant',
    period: PeriodKind.RANGE,
    params: [{ name: 'costCentreId', required: true, label: 'Cost centre' }, ...range, unit()],
    permissions: [P.LEDGER_VIEW, P.PNL_VIEW_CONSOLIDATED],
    landscape: false,
  },
  // --- HR & payroll ------------------------------------------------------------------------
  {
    key: 'payroll-register',
    title: 'Payroll register',
    group: 'HR & payroll',
    description: 'A unit’s month of pay: each person’s salary, absences, advances, bonus, fines, deductions and net, with totals.',
    cadence: 'Monthly',
    audience: 'Accountant',
    period: PeriodKind.RECORD,
    params: [{ name: 'runId', required: true, label: 'Payroll run' }],
    permissions: PAYROLL_VIEWERS,
    landscape: true,
  },
  {
    key: 'payslips',
    title: 'Payslips',
    group: 'HR & payroll',
    description: 'One page per person for a payroll run — or a single person’s payslip.',
    cadence: 'Monthly',
    audience: 'Accountant, employees',
    period: PeriodKind.RECORD,
    params: [
      { name: 'runId', required: true, label: 'Payroll run' },
      { name: 'employeeId', required: false, label: 'Employee' },
    ],
    permissions: PAYROLL_VIEWERS,
    landscape: false,
  },
  {
    key: 'bonus-sheet',
    title: 'Bonus / incentive calculation sheet',
    group: 'HR & payroll',
    description: 'A commission pool: qualifying sales, the pool, each tier’s share and each person’s amount.',
    cadence: 'Monthly / seasonal',
    audience: 'Accountant, managers',
    period: PeriodKind.RECORD,
    params: [{ name: 'poolId', required: true, label: 'Commission pool' }],
    permissions: PAYROLL_VIEWERS,
    landscape: false,
  },
  {
    key: 'attendance-summary',
    title: 'Attendance & leave summary',
    group: 'HR & payroll',
    description: 'A unit’s month: each person’s days present, absent, on leave and unmarked, and their leave balances.',
    cadence: 'Weekly / monthly',
    audience: 'Accountant, branch managers',
    period: PeriodKind.MONTH,
    params: [{ name: 'month', required: true, label: 'Month' }, unit(true)],
    permissions: HR_VIEWERS,
    landscape: true,
    amounts: false,
  },
  {
    key: 'headcount',
    title: 'Headcount & payroll cost',
    group: 'HR & payroll',
    description: 'People on the books at month end by unit and designation, and the month’s finalised payroll cost.',
    cadence: 'Monthly',
    audience: 'Partners, accountant',
    period: PeriodKind.MONTH,
    params: [{ name: 'month', required: true, label: 'Month' }, unit()],
    permissions: PAYROLL_VIEWERS,
    landscape: false,
  },
  {
    key: 'disciplinary',
    title: 'Disciplinary / fine register',
    group: 'HR & payroll',
    description: 'Fines and warnings raised in a period, who raised and reviewed them, and the month a fine came off pay.',
    cadence: 'On demand',
    audience: 'Accountant, partners',
    period: PeriodKind.RANGE,
    params: [...range, unit(), { name: 'status', required: false, label: 'Status' }],
    permissions: HR_VIEWERS,
    landscape: true,
  },
  {
    key: 'settlement',
    title: 'Full & final settlement statement',
    group: 'HR & payroll',
    description: 'What a leaver is owed: salary to the exit date, leave encashment, less advances and fines.',
    cadence: 'Per exit',
    audience: 'Accountant, departing employee',
    period: PeriodKind.RECORD,
    params: [{ name: 'settlementId', required: true, label: 'Settlement' }],
    permissions: PAYROLL_VIEWERS,
    landscape: false,
  },
  // --- Operations --------------------------------------------------------------------------
  {
    key: 'utility-bill',
    title: 'Utility bill allocation sheet',
    group: 'Operations',
    description: 'A bill’s readings, rate, each sub-meter’s charge, the remainder split and what each unit bears.',
    cadence: 'Per billing cycle',
    audience: 'Accountant',
    period: PeriodKind.RECORD,
    params: [{ name: 'billId', required: true, label: 'Bill' }],
    permissions: [P.UTILITIES_MANAGE, P.PNL_VIEW_CONSOLIDATED],
    landscape: false,
  },
  {
    key: 'sales',
    title: 'Sales & ticketing report',
    group: 'Operations',
    description: 'The year’s day × month grid, year on year, sales by item — and a peak event (Eid) compared across years.',
    cadence: 'Daily / seasonal',
    audience: 'Partners',
    period: PeriodKind.YEAR,
    params: [{ name: 'year', required: true, label: 'Year' }, unit(), { name: 'eventId', required: false, label: 'Compare an event' }],
    permissions: [P.LEDGER_VIEW, P.PNL_VIEW_CONSOLIDATED],
    landscape: true,
  },
  {
    key: 'capex-register',
    title: 'Capex register',
    group: 'Operations',
    description: 'Every capital purchase with its payback, and investment by nature, unit and year.',
    cadence: 'On demand',
    audience: 'Partners',
    period: PeriodKind.NONE,
    params: [unit(), { name: 'status', required: false, label: 'Status' }],
    permissions: [P.CAPEX_MANAGE, P.PNL_VIEW_CONSOLIDATED],
    landscape: true,
  },
  {
    key: 'campaign',
    title: 'Campaign P&L',
    group: 'Operations',
    description: 'A campaign’s money raised and spent by category, its budget and every receipt and payment with the running balance.',
    cadence: 'On demand',
    audience: 'Partners',
    period: PeriodKind.RECORD,
    params: [{ name: 'campaignId', required: true, label: 'Campaign' }],
    permissions: [P.CAPEX_MANAGE, P.PNL_VIEW_CONSOLIDATED],
    landscape: false,
  },
];

export const REPORT_BY_KEY = new Map(REPORTS.map((r) => [r.key, r]));

/** Scheduled reports need a period that can be worked out on the day — not a particular record. */
export function isSchedulable(def: ReportDefinition): boolean {
  return def.period !== PeriodKind.RECORD;
}
