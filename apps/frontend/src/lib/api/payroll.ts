import { apiClient } from './client';
import type { BonusTier, EmploymentType, PayBasis, UnitRef } from './hr';

export type PayrollRunStatus = 'DRAFT' | 'FINALIZED' | 'PAID';
export type AdjustmentKind = 'ALLOWANCE' | 'FOOD' | 'DEDUCTION' | 'ADVANCE_RECOVERY';
export type AdvanceStatus = 'OUTSTANDING' | 'RECOVERED' | 'CANCELLED';
export type BonusSplit = 'EQUAL' | 'BY_UNITS';
export type BonusPoolStatus = 'DRAFT' | 'APPROVED';
export type SettlementStatus = 'DRAFT' | 'FINALIZED' | 'PAID';

export const RUN_STATUS: Record<PayrollRunStatus, { label: string; tone: 'amber' | 'blue' | 'green' }> = {
  DRAFT: { label: 'Draft', tone: 'amber' },
  FINALIZED: { label: 'Finalised — to pay', tone: 'blue' },
  PAID: { label: 'Paid', tone: 'green' },
};

export const ADJUSTMENT_LABELS: Record<AdjustmentKind, string> = {
  ALLOWANCE: 'Allowance / incentive (adds to Bonus)',
  FOOD: 'Food expense (deducted)',
  DEDUCTION: 'Other deduction',
  ADVANCE_RECOVERY: 'Recover exactly this much of advances',
};

export const SPLIT_LABELS: Record<BonusSplit, string> = {
  EQUAL: 'Equally per person',
  BY_UNITS: 'By a count per person (e.g. trips)',
};

export interface EntryRef {
  id: string;
  displayNo: string | null;
}

// --- Runs ------------------------------------------------------------------------

export interface PayRowDetails {
  attendance: {
    employedDays: number;
    workingDays: number;
    present: number;
    halfDays: number;
    absent: number;
    paidLeave: number;
    unpaidLeave: number;
    extraDays: string;
    unmarked: number;
  };
  fines: { id: string; date: string; reason: string; amount: string }[];
  allowances: { description: string; amount: string }[];
  food: { description: string; amount: string }[];
  deductions: { description: string; amount: string }[];
  poolShares: { poolId: string; title: string; tier: string; amount: string }[];
  recoveries: { advanceId: string; issueDate: string; amount: string; outstandingAfter: string }[];
  paidDays: string | null;
}

export interface PayRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  designation: string | null;
  department: string | null;
  payBasis: PayBasis;
  absentDays: string;
  salary: string;
  earned: string;
  absenceDeduction: string;
  advance: string;
  gross: string;
  poolBonus: string;
  allowances: string;
  bonus: string;
  fines: string;
  food: string;
  otherDeductions: string;
  eobiEmployee: string;
  eobiEmployer: string;
  tax: string;
  pfEmployee: string;
  pfEmployer: string;
  net: string;
  cost: string;
  details: PayRowDetails;
  warnings: string[];
  errors: string[];
  payslipId: string | null;
  paidOn: string | null;
  paymentEntryId: string | null;
  paymentEntryNo: string | null;
}


export interface PayrollRunDetail {
  id: string;
  month: string;
  status: PayrollRunStatus;
  businessUnit: UnitRef;
  policy: { id: string; version: number; daysPerMonth: number; eobiEnabled: boolean; taxEnabled: boolean; pfEnabled: boolean } | null;
  finalizableFrom: string;
  canFinalize: boolean;
  rows: PayRow[];
  totals: Record<string, string>;
  unpaid: string;
  errors: string[];
  warnings: string[];
  adjustments: { id: string; employeeId: string; kind: AdjustmentKind; amount: string; description: string }[];
  accrualEntry: EntryRef | null;
  payments: { entryId: string; displayNo: string | null; date: string | null; count: number; amount: string }[];
  createdAt: string;
  createdByName: string | null;
  finalizedAt: string | null;
  finalizedByName: string | null;
  note: string | null;
}

export interface PayrollOverview {
  month: string;
  units: {
    unit: UnitRef;
    run: { id: string; status: PayrollRunStatus; net: string; cost: string; unpaid: string; issues: number } | null;
    headcount: number;
  }[];
}

export interface PayrollStats {
  unpaidNet: string;
  unpaidCount: number;
  lastMonth: { month: string; cost: string } | null;
  advancesOutstanding: string;
  advancesCount: number;
  draftRuns: number;
}

export interface PayslipView {
  run: { id: string; month: string; status: PayrollRunStatus; businessUnit: UnitRef; policy: PayrollRunDetail['policy'] };
  employee: { id: string; employeeCode: string; fullName: string; cnic: string | null; joinDate: string; employmentType: EmploymentType } | null;
  row: PayRow;
}

export interface EmployeePayslip {
  runId: string;
  month: string;
  businessUnit: UnitRef;
  salary: string;
  absentDays: string;
  gross: string;
  bonus: string;
  fines: string;
  net: string;
  paidOn: string | null;
}

export async function getPayrollStats() {
  const { data } = await apiClient.get<PayrollStats>('/payroll/stats');
  return data;
}

export async function getPayrollOverview(month: string) {
  const { data } = await apiClient.get<PayrollOverview>('/payroll/overview', { params: { month } });
  return data;
}

export async function createPayrollRun(businessUnitId: string, month: string) {
  const { data } = await apiClient.post<PayrollRunDetail>('/payroll/runs', { businessUnitId, month });
  return data;
}

export async function getPayrollRun(id: string) {
  const { data } = await apiClient.get<PayrollRunDetail>(`/payroll/runs/${id}`);
  return data;
}

export async function deletePayrollRun(id: string) {
  await apiClient.delete(`/payroll/runs/${id}`);
}

export async function addPayrollAdjustment(id: string, payload: { employeeId: string; kind: AdjustmentKind; amount: string; description: string }) {
  const { data } = await apiClient.post<PayrollRunDetail>(`/payroll/runs/${id}/adjustments`, payload);
  return data;
}

export async function removePayrollAdjustment(id: string, adjustmentId: string) {
  const { data } = await apiClient.delete<PayrollRunDetail>(`/payroll/runs/${id}/adjustments/${adjustmentId}`);
  return data;
}

export async function finalizePayrollRun(id: string, acknowledgeWarnings: boolean) {
  const { data } = await apiClient.post<PayrollRunDetail>(`/payroll/runs/${id}/finalize`, { acknowledgeWarnings });
  return data;
}

export async function reopenPayrollRun(id: string, reason?: string) {
  const { data } = await apiClient.post<PayrollRunDetail>(`/payroll/runs/${id}/reopen`, { reason });
  return data;
}

export interface PayPayload {
  paymentDate: string;
  accountId: string;
  reserveAccountId?: string;
  employeeIds?: string[];
}

export async function payPayrollRun(id: string, payload: PayPayload) {
  const { data } = await apiClient.post<PayrollRunDetail>(`/payroll/runs/${id}/pay`, payload);
  return data;
}

export async function getPayslip(runId: string, employeeId: string) {
  const { data } = await apiClient.get<PayslipView>(`/payroll/runs/${runId}/payslips/${employeeId}`);
  return data;
}

export async function listEmployeePayslips(employeeId: string) {
  const { data } = await apiClient.get<EmployeePayslip[]>(`/payroll/employees/${employeeId}/payslips`);
  return data;
}

// --- Advances ------------------------------------------------------------------------

export interface AdvanceRecord {
  id: string;
  employee: { id: string; employeeCode: string; fullName: string; designation: string | null };
  businessUnit: UnitRef;
  issueDate: string;
  amount: string;
  installment: string | null;
  reason: string;
  status: AdvanceStatus;
  recovered: string;
  outstanding: string;
  recoveries: { month: string; amount: string; source: 'PAYROLL' | 'SETTLEMENT' }[];
  entry: EntryRef | null;
  cancelReason: string | null;
  createdAt: string;
  createdByName: string | null;
}

export async function listAdvances(params: { businessUnitId?: string; employeeId?: string; status?: AdvanceStatus } = {}) {
  const { data } = await apiClient.get<AdvanceRecord[]>('/payroll/advances', { params });
  return data;
}

export async function createAdvance(payload: {
  employeeId: string;
  issueDate: string;
  amount: string;
  installment?: string;
  reason: string;
  accountId: string;
  reserveAccountId?: string;
}) {
  const { data } = await apiClient.post<AdvanceRecord>('/payroll/advances', payload);
  return data;
}

export async function cancelAdvance(id: string, reason?: string) {
  const { data } = await apiClient.post<AdvanceRecord>(`/payroll/advances/${id}/cancel`, { reason });
  return data;
}

// --- Commission pools ------------------------------------------------------------------

export interface BonusTierRule {
  tier: BonusTier;
  pct: string;
  split: BonusSplit;
  roundUp: boolean;
  unitLabel: string | null;
}

export interface BonusPoolRow {
  id: string;
  month: string;
  title: string;
  businessUnit: UnitRef;
  qualifyingSales: string;
  commissionPct: string;
  pool: string;
  distributed: string;
  undistributed: string;
  members: number;
  status: BonusPoolStatus;
}

export interface BonusPoolDetail {
  id: string;
  month: string;
  title: string;
  basis: string | null;
  businessUnit: UnitRef;
  qualifyingSales: string;
  commissionPct: string;
  policyVersion: number;
  status: BonusPoolStatus;
  pool: string;
  undistributed: string;
  tiers: (BonusTierRule & { amount: string; headcount: number; totalUnits: string; perUnit: string | null; distributed: string })[];
  members: { employeeId: string; employeeCode: string; fullName: string; designation: string | null; tier: BonusTier; units: string; amount: string }[];
  paidInPayslips: number;
  createdAt: string;
  createdByName: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
}

export async function listBonusPools(params: { businessUnitId?: string; month?: string; status?: BonusPoolStatus } = {}) {
  const { data } = await apiClient.get<BonusPoolRow[]>('/payroll/bonus-pools', { params });
  return data;
}

export async function createBonusPool(payload: {
  businessUnitId: string;
  month: string;
  title: string;
  basis?: string;
  qualifyingSales: string;
  addEveryone?: boolean;
}) {
  const { data } = await apiClient.post<BonusPoolDetail>('/payroll/bonus-pools', payload);
  return data;
}

export async function getBonusPool(id: string) {
  const { data } = await apiClient.get<BonusPoolDetail>(`/payroll/bonus-pools/${id}`);
  return data;
}

export async function updateBonusPool(id: string, payload: { title?: string; basis?: string; qualifyingSales?: string }) {
  const { data } = await apiClient.patch<BonusPoolDetail>(`/payroll/bonus-pools/${id}`, payload);
  return data;
}

export async function setBonusMembers(id: string, members: { employeeId: string; tier: BonusTier; units: string }[]) {
  const { data } = await apiClient.put<BonusPoolDetail>(`/payroll/bonus-pools/${id}/members`, { members });
  return data;
}

export async function reviewBonusPool(id: string, action: 'approve' | 'unapprove') {
  const { data } = await apiClient.post<BonusPoolDetail>(`/payroll/bonus-pools/${id}/${action}`);
  return data;
}

export async function deleteBonusPool(id: string) {
  await apiClient.delete(`/payroll/bonus-pools/${id}`);
}

// --- Policy -------------------------------------------------------------------------------

export interface PayrollPolicyRecord {
  id: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: 'ACTIVE' | 'SUPERSEDED';
  isCurrent: boolean;
  isUpcoming: boolean;
  note: string | null;
  daysPerMonth: number;
  eobiEnabled: boolean;
  eobiMinimumWage: string;
  eobiEmployeePct: string;
  eobiEmployerPct: string;
  eobiEmploymentTypes: EmploymentType[];
  taxEnabled: boolean;
  taxBands: { from: string; rate: string }[];
  pfEnabled: boolean;
  pfEmployeePct: string;
  pfEmployerPct: string;
  commissionPct: string;
  bonusTiers: BonusTierRule[];
  createdAt: string;
  createdByName: string | null;
}

export type PayrollPolicyPayload = Omit<
  PayrollPolicyRecord,
  'id' | 'version' | 'effectiveTo' | 'status' | 'isCurrent' | 'isUpcoming' | 'createdAt' | 'createdByName' | 'note' | 'bonusTiers'
> & { note?: string; bonusTiers: (Omit<BonusTierRule, 'unitLabel'> & { unitLabel?: string })[] };

export async function listPayrollPolicies() {
  const { data } = await apiClient.get<PayrollPolicyRecord[]>('/payroll/policies');
  return data;
}

export async function createPayrollPolicy(payload: PayrollPolicyPayload) {
  const { data } = await apiClient.post<{ id: string; version: number; replaced: number[] }>('/payroll/policies', payload);
  return data;
}

// --- Settlements ----------------------------------------------------------------------------

export interface SettlementSnapshot {
  months: {
    month: string;
    salary: string;
    absentDays: string;
    earned: string;
    absenceDeduction: string;
    salaryForDays: string;
    poolBonus: string;
    eobiEmployee: string;
    eobiEmployer: string;
    tax: string;
    pfEmployee: string;
    pfEmployer: string;
  }[];
  salaryForDays: string;
  poolBonus: string;
  encashment: { leaveTypeId: string; name: string; days: string; amount: string }[];
  leaveEncashment: string;
  additions: string;
  fines: { id: string; date: string; reason: string; amount: string }[];
  finesTotal: string;
  deductions: string;
  statutoryEmployee: string;
  statutoryEmployer: string;
  eobiEmployee: string;
  eobiEmployer: string;
  tax: string;
  pfEmployee: string;
  pfEmployer: string;
  advances: { advanceId: string; issueDate: string; outstanding: string; recovered: string }[];
  advanceRecovered: string;
  stillOwed: string;
  net: string;
  cost: string;
}

export interface SettlementAdjustment {
  kind: 'ALLOWANCE' | 'DEDUCTION';
  amount: string;
  description: string;
}

export interface SettlementDetail {
  id: string;
  status: SettlementStatus;
  employee: {
    id: string;
    employeeCode: string;
    fullName: string;
    fatherName: string | null;
    cnic: string | null;
    designation: string | null;
    department: string | null;
    businessUnit: UnitRef | null;
    joinDate: string;
    exitDate: string;
    exitReason: string | null;
    employmentType: EmploymentType;
  };
  fromMonth: string;
  snapshot: SettlementSnapshot;
  adjustments: SettlementAdjustment[];
  warnings: string[];
  errors: string[];
  canFinalize: boolean;
  finalizableFrom: string;
  accrualEntry: EntryRef | null;
  paymentEntry: EntryRef | null;
  paidOn: string | null;
  note: string | null;
  createdAt: string;
  createdByName: string | null;
  finalizedAt: string | null;
  finalizedByName: string | null;
}

export interface SettlementRow {
  id: string;
  status: SettlementStatus;
  employee: { id: string; employeeCode: string; fullName: string; designation: string | null; exitDate: string | null };
  businessUnit: UnitRef;
  exitDate: string | null;
  net: string | null;
  paidOn: string | null;
  createdAt: string;
}

export interface AwaitingSettlement {
  id: string;
  employeeCode: string;
  fullName: string;
  designation: string | null;
  businessUnit: UnitRef;
  exitDate: string | null;
  exitReason: string | null;
}

export async function listSettlements(params: { businessUnitId?: string; employeeId?: string; status?: SettlementStatus } = {}) {
  const { data } = await apiClient.get<SettlementRow[]>('/payroll/settlements', { params });
  return data;
}

export async function listAwaitingSettlement() {
  const { data } = await apiClient.get<AwaitingSettlement[]>('/payroll/settlements/awaiting');
  return data;
}

export async function createSettlement(employeeId: string) {
  const { data } = await apiClient.post<SettlementDetail>('/payroll/settlements', { employeeId });
  return data;
}

export async function getSettlement(id: string) {
  const { data } = await apiClient.get<SettlementDetail>(`/payroll/settlements/${id}`);
  return data;
}

export async function updateSettlement(id: string, payload: { adjustments?: SettlementAdjustment[]; note?: string }) {
  const { data } = await apiClient.patch<SettlementDetail>(`/payroll/settlements/${id}`, payload);
  return data;
}

export async function deleteSettlement(id: string) {
  await apiClient.delete(`/payroll/settlements/${id}`);
}

export async function settlementAction(id: string, action: 'finalize' | 'reopen', reason?: string) {
  const { data } = await apiClient.post<SettlementDetail>(`/payroll/settlements/${id}/${action}`, action === 'reopen' ? { reason } : {});
  return data;
}

export async function paySettlement(id: string, payload: Omit<PayPayload, 'employeeIds'>) {
  const { data } = await apiClient.post<SettlementDetail>(`/payroll/settlements/${id}/pay`, payload);
  return data;
}
