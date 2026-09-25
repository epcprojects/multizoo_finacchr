import { apiClient } from './client';

export type EmploymentType = 'PERMANENT' | 'CONTRACT' | 'DAILY_WAGE' | 'SEASONAL';
export type PayBasis = 'MONTHLY' | 'DAILY';
export type BonusTier = 'MANAGER' | 'SUPERVISOR' | 'TICKETER' | 'WORKER' | 'NONE';
export type EmployeeStatus = 'ACTIVE' | 'EXITED';
export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'LEAVE' | 'OFF';
export type LeaveRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type DisciplinaryType = 'FINE' | 'WARNING';
export type DisciplinaryStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
export type DayKind =
  | 'NOT_EMPLOYED'
  | 'UNMARKED'
  | 'FUTURE'
  | 'PRESENT'
  | 'ABSENT'
  | 'HALF_DAY'
  | 'LEAVE_PAID'
  | 'LEAVE_UNPAID'
  | 'OFF'
  | 'EXTRA'
  | 'EXTRA_HALF';

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  PERMANENT: 'Permanent',
  CONTRACT: 'Contract',
  DAILY_WAGE: 'Daily wage',
  SEASONAL: 'Seasonal',
};
export const EMPLOYMENT_TYPES = Object.keys(EMPLOYMENT_TYPE_LABELS) as EmploymentType[];

export const BONUS_TIER_LABELS: Record<BonusTier, string> = {
  MANAGER: 'Manager',
  SUPERVISOR: 'Supervisor',
  TICKETER: 'Ticketer',
  WORKER: 'Worker',
  NONE: 'Not in the pool',
};
export const BONUS_TIERS = Object.keys(BONUS_TIER_LABELS) as BonusTier[];

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const LEAVE_STATUS_LABELS: Record<LeaveRequestStatus, string> = {
  PENDING: 'Awaiting approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

export const DISCIPLINARY_STATUS_LABELS: Record<DisciplinaryStatus, string> = {
  PENDING_APPROVAL: 'Awaiting approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
};

/** One vocabulary for every attendance cell and legend. */
export const DAY_KIND: Record<DayKind, { short: string; label: string; tone: string }> = {
  PRESENT: { short: 'P', label: 'Present', tone: 'bg-green-50 text-green-700 border-green-200' },
  ABSENT: { short: 'A', label: 'Absent', tone: 'bg-red-50 text-red-700 border-red-200' },
  HALF_DAY: { short: '½', label: 'Half day', tone: 'bg-warning-25 text-warning-800 border-warning-200' },
  LEAVE_PAID: { short: 'L', label: 'Leave (paid)', tone: 'bg-sky-50 text-sky-700 border-sky-200' },
  LEAVE_UNPAID: { short: 'L', label: 'Leave (not covered)', tone: 'bg-red-50 text-red-700 border-red-200 underline decoration-dotted' },
  OFF: { short: '·', label: 'Rest day', tone: 'bg-gray-50 text-gray-400 border-gray-100' },
  EXTRA: { short: 'X', label: 'Worked a rest day', tone: 'bg-violet-50 text-violet-700 border-violet-200' },
  EXTRA_HALF: { short: 'x', label: 'Half of a rest day', tone: 'bg-violet-50 text-violet-700 border-violet-200' },
  UNMARKED: { short: '?', label: 'Not marked', tone: 'bg-white text-warning-800 border-warning-200 border-dashed' },
  FUTURE: { short: '', label: 'Upcoming', tone: 'bg-white text-gray-300 border-gray-100' },
  NOT_EMPLOYED: { short: '', label: 'Not employed', tone: 'bg-gray-100 text-gray-300 border-gray-100' },
};

// --- Records -----------------------------------------------------------------

export interface UnitRef {
  id: string;
  code: string;
  name: string;
}

export interface EmployeeRecord {
  id: string;
  employeeCode: string;
  fullName: string;
  fatherName: string | null;
  cnic: string | null;
  phone: string | null;
  address: string | null;
  businessUnit: UnitRef;
  department: { id: string; name: string } | null;
  designation: { id: string; name: string; bonusTier: BonusTier };
  bonusTier: BonusTier | null;
  effectiveBonusTier: BonusTier;
  employmentType: EmploymentType;
  joinDate: string;
  weeklyOffDay: number | null;
  status: EmployeeStatus;
  exitDate: string | null;
  exitReason: string | null;
  isLeaving: boolean;
  userId: string | null;
  userName: string | null;
  partner: { id: string; name: string; shortName: string } | null;
  notes: string | null;
  /** null when the viewer can't see pay. */
  salary: {
    baseSalary: string;
    payBasis: PayBasis;
    effectiveFrom: string;
    upcoming: { baseSalary: string; payBasis: PayBasis; effectiveFrom: string } | null;
  } | null;
  createdAt: string;
  createdByName?: string | null;
}

export interface EmployeeStats {
  active: number;
  joinedThisMonth: number;
  leaving: number;
  pendingDisciplinary: number;
}

export interface SalaryRevisionRecord {
  id: string;
  effectiveFrom: string;
  baseSalary: string;
  payBasis: PayBasis;
  reason: string | null;
  isCurrent: boolean;
  isUpcoming: boolean;
  createdAt: string;
  createdByName: string | null;
}

export interface DepartmentRecord {
  id: string;
  name: string;
  isActive: boolean;
  businessUnit: UnitRef;
  headcount: number;
}

export interface DesignationRecord {
  id: string;
  name: string;
  bonusTier: BonusTier;
  description: string | null;
  isActive: boolean;
  headcount: number;
}

export interface HolidayRecord {
  id: string;
  date: string;
  name: string;
  businessUnit: UnitRef | null;
}

export interface LeaveTypeRecord {
  id: string;
  code: string;
  name: string;
  isPaid: boolean;
  isActive: boolean;
  sortOrder: number;
  description: string | null;
}

export interface PolicyLeaveRule {
  leaveTypeId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  daysPerYear: string;
  availableAfterMonths: number;
  maxConsecutiveDays: number | null;
  carryForward: boolean;
  maxBalance: string | null;
  encashable: boolean;
  employmentTypes: EmploymentType[];
}

export interface HrPolicyRecord {
  id: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: 'ACTIVE' | 'SUPERSEDED';
  isCurrent: boolean;
  isUpcoming: boolean;
  note: string | null;
  attendanceBackdateDays: number;
  createdAt: string;
  createdByName: string | null;
  leaveRules: PolicyLeaveRule[];
}

export type PolicyLeaveRulePayload = Omit<PolicyLeaveRule, 'leaveTypeCode' | 'leaveTypeName'>;

export interface SheetRow {
  id: string;
  employeeCode: string;
  fullName: string;
  designation: string | null;
  department: string | null;
  weeklyOffDay: number | null;
  restDay: boolean;
  restReason: 'WEEKLY_OFF' | 'HOLIDAY' | null;
  transferred: boolean;
  employed: boolean;
  /** That month's pay is finalised for them — the day can't change. */
  payLocked: boolean;
  record: {
    status: AttendanceStatus;
    leaveTypeId: string | null;
    leaveTypeName: string | null;
    source: 'MANUAL' | 'BIOMETRIC' | 'LEAVE_REQUEST';
    leaveRequestId: string | null;
    note: string | null;
    checkIn: string | null;
    checkOut: string | null;
    markedByName: string | null;
    markedAt: string;
  } | null;
}

export interface AttendanceSheet {
  unit: UnitRef;
  date: string;
  weekday: number;
  holiday: string | null;
  canEdit: boolean;
  lockedReason: string | null;
  backdateDays: number;
  canMarkLeave: boolean;
  counts: {
    expected: number;
    marked: number;
    present: number;
    absent: number;
    halfDay: number;
    leave: number;
    restDayWorked: number;
  };
  employees: SheetRow[];
}

export interface MonthSummary {
  employedDays: number;
  workingDays: number;
  restDays: number;
  present: number;
  halfDays: number;
  absent: number;
  paidLeave: number;
  unpaidLeave: number;
  off: number;
  extraDays: string;
  unmarked: number;
  payrollAbsentDays: string;
}

export interface AttendanceRegister {
  unit: UnitRef;
  month: string;
  from: string;
  to: string;
  calendar: { date: string; weekday: number; holiday: string | null; future: boolean }[];
  employees: {
    id: string;
    employeeCode: string;
    fullName: string;
    designation: string | null;
    department: string | null;
    weeklyOffDay: number | null;
    days: { date: string; kind: DayKind; leaveType: string | null }[];
    summary: MonthSummary;
  }[];
}

export interface EmployeeMonth {
  month: string;
  employee: { id: string; fullName: string; weeklyOffDay: number | null };
  summary: MonthSummary;
  days: {
    date: string;
    weekday: number;
    kind: DayKind;
    restReason: 'WEEKLY_OFF' | 'HOLIDAY' | null;
    holiday: string | null;
    leaveType: string | null;
    source: string | null;
    note: string | null;
    unitCode: string | null;
    markedByName: string | null;
  }[];
}

export interface TodayOverview {
  date: string;
  units: (UnitRef & { headcount: number; expected: number; marked: number; present: number; absent: number; onLeave: number })[];
}

export interface LeaveRequestRecord {
  id: string;
  employee: { id: string; employeeCode: string; fullName: string; designation: string | null; userId: string | null };
  businessUnit: UnitRef;
  leaveType: { id: string; code: string; name: string; isPaid: boolean };
  startDate: string;
  endDate: string;
  days: string;
  reason: string | null;
  status: LeaveRequestStatus;
  createdAt: string;
  createdBy: string | null;
  requestedByName: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  reviewNote: string | null;
  cancelledAt: string | null;
  cancelledByName: string | null;
  cancelReason: string | null;
}

export interface LeavePreview {
  employee: { id: string; fullName: string };
  leaveType: { id: string; name: string; isPaid: boolean } | null;
  dates: string[];
  days: string;
  errors: string[];
  warnings: string[];
  balance: { isPaid: boolean; entitled: boolean; available: string; after: string; uncoveredDays: number } | null;
}

export interface LeaveBalance {
  leaveTypeId: string;
  code: string;
  name: string;
  isPaid: boolean;
  inPolicy: boolean;
  eligibleFrom: string;
  carriedIn: string;
  entitlement: string;
  adjustments: string;
  taken: string;
  uncovered: number;
  pending: string;
  balance: string;
  available: string;
}

export interface LeaveBalances {
  year: number;
  leaveTypes: { id: string; code: string; name: string; isPaid: boolean }[];
  employees: {
    id: string;
    employeeCode: string;
    fullName: string;
    designation: string;
    employmentType: EmploymentType;
    businessUnit: UnitRef;
    status: EmployeeStatus;
    balances: LeaveBalance[];
  }[];
}

export interface EmployeeLeave {
  year: number;
  employee: { id: string; fullName: string; joinDate: string };
  balances: LeaveBalance[];
  days: { date: string; leaveTypeId: string | null; leaveTypeName: string; covered: boolean; leaveRequestId: string | null }[];
  requests: LeaveRequestRecord[];
  adjustments: { id: string; leaveYear: number; leaveTypeName: string; days: string; reason: string; createdAt: string; createdByName: string | null }[];
}

export interface DisciplinaryRecordRow {
  id: string;
  employee: { id: string; employeeCode: string; fullName: string; designation: string | null; userId: string | null };
  businessUnit: UnitRef;
  type: DisciplinaryType;
  incidentDate: string;
  reason: string;
  amount: string | null;
  status: DisciplinaryStatus;
  createdAt: string;
  createdBy: string | null;
  raisedByName: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  reviewNote: string | null;
  /** The month whose pay it came off; null until a payroll or settlement collects it. */
  deductedMonth: string | null;
}

/** Warnings travel with a result: "saved, but 1 of 2 days isn't covered". */
export interface WithWarnings<T> {
  request: T;
  warnings: string[];
}

// --- Employees ---------------------------------------------------------------

export async function listEmployees(params: {
  businessUnitId?: string;
  status?: EmployeeStatus;
  departmentId?: string;
  designationId?: string;
  search?: string;
} = {}) {
  const { data } = await apiClient.get<EmployeeRecord[]>('/employees', { params });
  return data;
}

export async function getEmployeeStats() {
  const { data } = await apiClient.get<EmployeeStats>('/employees/stats');
  return data;
}

export async function getEmployee(id: string) {
  const { data } = await apiClient.get<EmployeeRecord>(`/employees/${id}`);
  return data;
}

export interface EmployeePayload {
  fullName?: string;
  fatherName?: string;
  cnic?: string | null;
  phone?: string;
  address?: string;
  businessUnitId?: string;
  departmentId?: string | null;
  designationId?: string;
  bonusTier?: BonusTier | null;
  employmentType?: EmploymentType;
  joinDate?: string;
  weeklyOffDay?: number | null;
  userId?: string | null;
  notes?: string;
  baseSalary?: string;
  payBasis?: PayBasis;
}

export async function createEmployee(payload: EmployeePayload) {
  const { data } = await apiClient.post<EmployeeRecord>('/employees', payload);
  return data;
}

export async function updateEmployee(id: string, payload: EmployeePayload) {
  const { data } = await apiClient.patch<EmployeeRecord>(`/employees/${id}`, payload);
  return data;
}

export async function getSalaryHistory(id: string) {
  const { data } = await apiClient.get<SalaryRevisionRecord[]>(`/employees/${id}/salary`);
  return data;
}

export async function addSalaryRevision(
  id: string,
  payload: { effectiveFrom: string; baseSalary: string; payBasis: PayBasis; reason: string },
) {
  const { data } = await apiClient.post<SalaryRevisionRecord[]>(`/employees/${id}/salary`, payload);
  return data;
}

export async function recordExit(id: string, payload: { exitDate: string; reason: string }) {
  const { data } = await apiClient.post<EmployeeRecord>(`/employees/${id}/exit`, payload);
  return data;
}

export async function reinstateEmployee(id: string) {
  const { data } = await apiClient.post<EmployeeRecord>(`/employees/${id}/reinstate`);
  return data;
}

export async function getEmployeeMonth(id: string, month: string) {
  const { data } = await apiClient.get<EmployeeMonth>(`/employees/${id}/attendance`, { params: { month } });
  return data;
}

export async function getEmployeeLeave(id: string, year?: number) {
  const { data } = await apiClient.get<EmployeeLeave>(`/employees/${id}/leave`, { params: { year } });
  return data;
}

// --- Org structure & policy ----------------------------------------------------------

export async function listDepartments(businessUnitId?: string) {
  const { data } = await apiClient.get<DepartmentRecord[]>('/hr/departments', { params: { businessUnitId } });
  return data;
}

export async function createDepartment(payload: { businessUnitId: string; name: string }) {
  const { data } = await apiClient.post<DepartmentRecord>('/hr/departments', payload);
  return data;
}

export async function updateDepartment(id: string, payload: { name?: string; isActive?: boolean }) {
  const { data } = await apiClient.patch<DepartmentRecord>(`/hr/departments/${id}`, payload);
  return data;
}

export async function listDesignations() {
  const { data } = await apiClient.get<DesignationRecord[]>('/hr/designations');
  return data;
}

export async function createDesignation(payload: { name: string; bonusTier: BonusTier; description?: string }) {
  const { data } = await apiClient.post<DesignationRecord>('/hr/designations', payload);
  return data;
}

export async function updateDesignation(
  id: string,
  payload: { name?: string; bonusTier?: BonusTier; description?: string; isActive?: boolean },
) {
  const { data } = await apiClient.patch<DesignationRecord>(`/hr/designations/${id}`, payload);
  return data;
}

export async function listHolidays(year?: number) {
  const { data } = await apiClient.get<HolidayRecord[]>('/hr/holidays', { params: { year } });
  return data;
}

export async function createHoliday(payload: { date: string; name: string; businessUnitId?: string }) {
  const { data } = await apiClient.post<HolidayRecord[]>('/hr/holidays', payload);
  return data;
}

export async function deleteHoliday(id: string) {
  const { data } = await apiClient.delete<HolidayRecord[]>(`/hr/holidays/${id}`);
  return data;
}

export async function listLeaveTypes() {
  const { data } = await apiClient.get<LeaveTypeRecord[]>('/hr/leave-types');
  return data;
}

export async function createLeaveType(payload: { code: string; name: string; isPaid: boolean; description?: string }) {
  const { data } = await apiClient.post<LeaveTypeRecord[]>('/hr/leave-types', payload);
  return data;
}

export async function updateLeaveType(id: string, payload: { name?: string; description?: string; isActive?: boolean }) {
  const { data } = await apiClient.patch<{ leaveTypes: LeaveTypeRecord[]; warnings: string[] }>(`/hr/leave-types/${id}`, payload);
  return data;
}

export async function listPolicies() {
  const { data } = await apiClient.get<HrPolicyRecord[]>('/hr/policies');
  return data;
}

export async function createPolicy(payload: {
  effectiveFrom: string;
  note?: string;
  attendanceBackdateDays: number;
  leaveRules: PolicyLeaveRulePayload[];
}) {
  const { data } = await apiClient.post<{ id: string; version: number; replaced: number[] }>('/hr/policies', payload);
  return data;
}

// --- Attendance ----------------------------------------------------------------------

export async function getAttendanceToday() {
  const { data } = await apiClient.get<TodayOverview>('/attendance/today');
  return data;
}

export async function getAttendanceSheet(businessUnitId: string, date: string) {
  const { data } = await apiClient.get<AttendanceSheet>('/attendance/sheet', { params: { businessUnitId, date } });
  return data;
}

export async function saveAttendanceSheet(payload: {
  businessUnitId: string;
  date: string;
  entries: { employeeId: string; status: AttendanceStatus | null; leaveTypeId?: string; note?: string }[];
}) {
  const { data } = await apiClient.put<AttendanceSheet>('/attendance/sheet', payload);
  return data;
}

export async function getAttendanceRegister(businessUnitId: string, month: string) {
  const { data } = await apiClient.get<AttendanceRegister>('/attendance/register', { params: { businessUnitId, month } });
  return data;
}

// --- Leave ---------------------------------------------------------------------------

export async function listLeaveRequests(params: {
  businessUnitId?: string;
  employeeId?: string;
  status?: LeaveRequestStatus;
  from?: string;
  to?: string;
} = {}) {
  const { data } = await apiClient.get<LeaveRequestRecord[]>('/leave/requests', { params });
  return data;
}

export interface LeaveRequestPayload {
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  reason?: string;
}

export async function previewLeaveRequest(payload: LeaveRequestPayload) {
  const { data } = await apiClient.post<LeavePreview>('/leave/requests/preview', payload);
  return data;
}

export async function createLeaveRequest(payload: LeaveRequestPayload & { approve?: boolean }) {
  const { data } = await apiClient.post<WithWarnings<LeaveRequestRecord>>('/leave/requests', payload);
  return data;
}

export async function reviewLeaveRequest(id: string, action: 'approve' | 'reject' | 'cancel', note?: string) {
  const { data } = await apiClient.post<WithWarnings<LeaveRequestRecord>>(`/leave/requests/${id}/${action}`, { note });
  return data;
}

export async function getLeaveBalances(params: { businessUnitId?: string; year?: number } = {}) {
  const { data } = await apiClient.get<LeaveBalances>('/leave/balances', { params });
  return data;
}

export async function createLeaveAdjustment(payload: {
  employeeId: string;
  leaveTypeId: string;
  leaveYear: number;
  days: string;
  reason: string;
}) {
  const { data } = await apiClient.post<EmployeeLeave>('/leave/adjustments', payload);
  return data;
}

// --- Fines & warnings ----------------------------------------------------------------

export async function listDisciplinary(params: { businessUnitId?: string; employeeId?: string; status?: DisciplinaryStatus } = {}) {
  const { data } = await apiClient.get<DisciplinaryRecordRow[]>('/disciplinary', { params });
  return data;
}

export async function createDisciplinary(payload: {
  employeeId: string;
  type: DisciplinaryType;
  incidentDate: string;
  reason: string;
  amount?: string;
  approve?: boolean;
}) {
  const { data } = await apiClient.post<DisciplinaryRecordRow>('/disciplinary', payload);
  return data;
}

export async function reviewDisciplinary(id: string, action: 'approve' | 'reject' | 'withdraw', note?: string) {
  const { data } = await apiClient.post<DisciplinaryRecordRow>(`/disciplinary/${id}/${action}`, { note });
  return data;
}

// --- Helpers -------------------------------------------------------------------------

export function currentMonth(todayIso: string) {
  return todayIso.slice(0, 7);
}

export function shiftMonth(month: string, n: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export function formatMonth(month: string) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** "1.5" → "1½", "-1" → "−1". */
export function formatDays(days: string) {
  const negative = days.startsWith('-');
  const [whole, fraction] = days.replace('-', '').split('.');
  const text = fraction === '5' ? (whole === '0' ? '½' : `${whole}½`) : whole;
  return `${negative ? '−' : ''}${text}`;
}
