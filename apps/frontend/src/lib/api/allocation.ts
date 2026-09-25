import { apiClient } from './client';

export type RuleStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | 'SUPERSEDED';
export type AllocationMethod = 'PERCENT' | 'PARTS';
export type TargetType = 'RESERVE' | 'PARTNER';
export type DayState = 'ALLOCATED' | 'PENDING' | 'CHANGED' | 'NO_RULE' | 'NO_INCOME';

export const RULE_STATUS_LABELS: Record<RuleStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Awaiting approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
  SUPERSEDED: 'Replaced before use',
};

export interface RuleLine {
  id: string;
  targetType: TargetType;
  accountId: string | null;
  partnerId: string | null;
  label: string;
  weight: string;
  percentOfIncome: string;
}

export interface RuleTranche {
  id: string;
  name: string;
  share: string;
  method: AllocationMethod;
  lines: RuleLine[];
}

export interface AllocationRuleRecord {
  id: string;
  businessUnitId: string;
  businessUnit: { id: string; code: string; name: string } | null;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  isCurrent: boolean;
  isUpcoming: boolean;
  status: RuleStatus;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
  createdByName: string | null;
  submittedAt: string | null;
  submittedByName: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  reviewNote: string | null;
  tranches: RuleTranche[];
}

/** What the editor sends — the same shape the API validates. */
export interface RuleTranchePayload {
  name: string;
  share: string;
  method: AllocationMethod;
  lines: { targetType: TargetType; accountId?: string; partnerId?: string; weight: string }[];
}

export interface RunBreakdownLine {
  tranche: string;
  trancheShare: string;
  label: string;
  targetType: string;
  accountId: string;
  percentOfIncome: string;
  amount: string;
}

export interface AllocationRunRecord {
  id: string;
  allocationDate: string;
  grossIncome: string;
  status: 'POSTED' | 'REVERSED';
  ruleId: string;
  ruleVersion: number | null;
  journalEntryId: string;
  entryNo: string | null;
  breakdown: RunBreakdownLine[];
  createdAt: string;
}

export interface OverviewUnit {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  isHolding: boolean;
  rule: {
    id: string;
    version: number;
    effectiveFrom: string;
    tranches: { name: string; share: string; lineCount: number }[];
  } | null;
  upcomingRule: { id: string; version: number; effectiveFrom: string } | null;
  today: { date: string; income: string; split: { key: string; label: string; amount: string }[] };
  pendingDays: number;
  changedDays: number;
  oldestOutstanding: string | null;
  moneyOnHand: string;
  earmarked: string;
  unearmarked: string;
}

export interface AllocationOverview {
  asOf: string;
  pendingApprovals: number;
  units: OverviewUnit[];
}

export interface AllocationDays {
  unit: { id: string; code: string; name: string };
  from: string;
  to: string;
  firstRuleDate: string | null;
  lastAllocatedDate: string | null;
  outstanding: { pending: number; changed: number; oldest: string | null; total: string };
  rows: {
    date: string;
    isToday: boolean;
    income: string;
    state: DayState;
    run: AllocationRunRecord | null;
  }[];
}

export interface UnitReserves {
  unit: { id: string; code: string; name: string };
  asOf: string;
  accounts: {
    id: string;
    code: string;
    name: string;
    kind: 'BUCKET' | 'PARTNER';
    partnerId: string | null;
    isActive: boolean;
    balance: string;
  }[];
  liquid: { id: string; code: string; name: string; balance: string }[];
  totals: { moneyOnHand: string; earmarked: string; unearmarked: string };
  openingReserves: { entryId: string; displayNo: string; entryDate: string } | null;
}

export interface RulePreview {
  problems: string[];
  sample: {
    gross: string;
    lines: { tranche: string; label: string; key: string; percentOfIncome: string; amount: string }[];
  } | null;
  history: {
    from: string;
    to: string;
    days: number;
    daysWithIncome: number;
    totalIncome: string;
    unruledIncome: string;
    targets: { key: string; label: string; current: string; proposed: string; difference: string }[];
  } | null;
}

export interface PartnerRecord {
  id: string;
  name: string;
  shortName: string;
  isActive: boolean;
  notes: string | null;
  userId: string | null;
  userName: string | null;
  /** Their Employee record, for a partner who also holds a salaried title. */
  employeeId: string | null;
  employee: { id: string; employeeCode: string; fullName: string; designation: string | null } | null;
  equityAccount: { id: string; code: string; name: string; balance: string } | null;
  profitReserves: {
    id: string;
    code: string;
    name: string;
    businessUnit: { id: string; code: string; name: string } | null;
    balance: string;
  }[];
  profitReservesTotal: string;
  shareIn: { unitCode: string; pending: boolean }[];
}

// --- engine -----------------------------------------------------------------

export async function getAllocationOverview() {
  const { data } = await apiClient.get<AllocationOverview>('/allocation/overview');
  return data;
}

export async function getAllocationDays(unitId: string, params: { from?: string; to?: string } = {}) {
  const { data } = await apiClient.get<AllocationDays>(`/allocation/units/${unitId}/days`, { params });
  return data;
}

export async function allocateDay(unitId: string, date: string) {
  const { data } = await apiClient.post<{ date: string; run: AllocationRunRecord | null }>(
    `/allocation/units/${unitId}/allocate`,
    { date },
  );
  return data;
}

export async function allocateOutstanding(unitId: string, upTo?: string) {
  const { data } = await apiClient.post<{
    allocated: number;
    days: { date: string; income: string; entryNo: string | null }[];
    stoppedAt: { date: string; reason: string } | null;
  }>(`/allocation/units/${unitId}/allocate-outstanding`, upTo ? { upTo } : {});
  return data;
}

export async function undoAllocationRun(runId: string, reason?: string) {
  const { data } = await apiClient.post(`/allocation/runs/${runId}/undo`, reason ? { reason } : {});
  return data;
}

export async function getUnitReserves(unitId: string) {
  const { data } = await apiClient.get<UnitReserves>(`/allocation/units/${unitId}/reserves`);
  return data;
}

export async function setOpeningReserves(
  unitId: string,
  payload: { asOfDate: string; amounts: { accountId: string; amount: string }[]; replaceExisting?: boolean; reason?: string },
) {
  const { data } = await apiClient.put<UnitReserves>(`/allocation/units/${unitId}/opening-reserves`, payload);
  return data;
}

// --- rules --------------------------------------------------------------------

export async function listAllocationRules(params: { businessUnitId?: string; status?: RuleStatus } = {}) {
  const { data } = await apiClient.get<AllocationRuleRecord[]>('/allocation-rules', { params });
  return data;
}

export async function createAllocationRule(payload: {
  businessUnitId: string;
  effectiveFrom: string;
  note?: string;
  tranches: RuleTranchePayload[];
  submit?: boolean;
  publish?: boolean;
}) {
  const { data } = await apiClient.post<AllocationRuleRecord>('/allocation-rules', payload);
  return data;
}

export async function updateAllocationRule(
  id: string,
  payload: { effectiveFrom?: string; note?: string; tranches?: RuleTranchePayload[] },
) {
  const { data } = await apiClient.patch<AllocationRuleRecord>(`/allocation-rules/${id}`, payload);
  return data;
}

export async function ruleAction(id: string, action: 'submit' | 'approve' | 'reject' | 'withdraw', note?: string) {
  const { data } = await apiClient.post<AllocationRuleRecord>(
    `/allocation-rules/${id}/${action}`,
    action === 'approve' || action === 'reject' ? { note: note || undefined } : {},
  );
  return data;
}

export async function previewAllocationRule(payload: {
  businessUnitId: string;
  tranches: RuleTranchePayload[];
  sampleAmount?: string;
  days?: number;
}) {
  const { data } = await apiClient.post<RulePreview>('/allocation-rules/preview', payload);
  return data;
}

// --- partners -----------------------------------------------------------------

export async function listPartners() {
  const { data } = await apiClient.get<PartnerRecord[]>('/partners');
  return data;
}

export async function createPartner(payload: { name: string; shortName: string; userId?: string; employeeId?: string; notes?: string }) {
  const { data } = await apiClient.post<PartnerRecord>('/partners', payload);
  return data;
}

export async function updatePartner(
  id: string,
  payload: Partial<{ name: string; shortName: string; userId: string | null; employeeId: string | null; notes: string; isActive: boolean }>,
) {
  const { data } = await apiClient.patch<PartnerRecord>(`/partners/${id}`, payload);
  return data;
}

/** A stored rule turned back into an editable payload. */
export function ruleToPayload(rule: Pick<AllocationRuleRecord, 'tranches'>): RuleTranchePayload[] {
  return rule.tranches.map((t) => ({
    name: t.name,
    share: t.share,
    method: t.method,
    lines: t.lines.map((l) => ({
      targetType: l.targetType,
      ...(l.accountId ? { accountId: l.accountId } : {}),
      ...(l.partnerId ? { partnerId: l.partnerId } : {}),
      weight: l.weight,
    })),
  }));
}
