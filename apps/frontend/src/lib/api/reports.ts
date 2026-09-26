import { apiClient, getToken } from './client';

export type PeriodKind = 'DATE' | 'RANGE' | 'MONTH' | 'YEAR' | 'RECORD' | 'NONE';
export type ReportGroup = 'Finance' | 'HR & payroll' | 'Operations';
export type ScheduleCadence = 'DAILY' | 'WEEKLY' | 'MONTHLY';
export type RelativePeriod =
  | 'TODAY'
  | 'YESTERDAY'
  | 'PREVIOUS_WEEK'
  | 'LAST_7_DAYS'
  | 'MONTH_TO_DATE'
  | 'PREVIOUS_MONTH'
  | 'CURRENT_MONTH'
  | 'CURRENT_YEAR'
  | 'PREVIOUS_YEAR';

export type ReportParamName =
  | 'asOf'
  | 'from'
  | 'to'
  | 'month'
  | 'year'
  | 'businessUnitId'
  | 'partnerId'
  | 'runId'
  | 'employeeId'
  | 'poolId'
  | 'settlementId'
  | 'counterpartyId'
  | 'billId'
  | 'eventId'
  | 'campaignId'
  | 'costCentreId'
  | 'status';

export type ReportParams = Partial<Record<ReportParamName, string | number>>;

export interface ReportDefinition {
  key: string;
  title: string;
  group: ReportGroup;
  description: string;
  cadence: string;
  audience: string;
  period: PeriodKind;
  params: { name: ReportParamName; required: boolean; label: string }[];
  landscape: boolean;
  schedulable: boolean;
  relativePeriods: { value: RelativePeriod; label: string }[];
}

export interface ArchivedReport {
  id: string;
  reportKey: string;
  title: string;
  subtitle: string | null;
  params: ReportParams;
  /** Unit codes it covers; empty = the whole group. */
  units: string[];
  highlights: { label: string; value: string }[];
  periodFrom: string | null;
  periodTo: string | null;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  generatedByName: string | null;
  scheduleId: string | null;
}

export interface ArchivePage {
  items: ArchivedReport[];
  total: number;
  page: number;
  limit: number;
}

export interface ReportSchedule {
  id: string;
  name: string;
  reportKey: string;
  reportTitle: string;
  cadence: ScheduleCadence;
  runAt: string;
  weekday: number | null;
  dayOfMonth: number | null;
  period: RelativePeriod | null;
  periodLabel: string | null;
  params: ReportParams;
  isActive: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  lastStatus: 'OK' | 'FAILED' | null;
  lastError: string | null;
  lastArchiveId: string | null;
  createdByName: string | null;
  createdAt: string;
}

export type SchedulePayload = {
  name: string;
  reportKey?: string;
  cadence: ScheduleCadence;
  runAt: string;
  weekday?: number | null;
  dayOfMonth?: number | null;
  period?: RelativePeriod | null;
  params?: ReportParams;
  isActive?: boolean;
};

/** Who may open the Report centre at all ("Generate & download PDF reports", Part 10). */
export const REPORT_PERMISSIONS = ['reports.generate', 'reports.generate_own_unit'];

export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export async function getReportCatalogue() {
  return (await apiClient.get<ReportDefinition[]>('/reports/catalogue')).data;
}

let allowedKeys: Promise<Set<string>> | null = null;
let allowedFor: string | null = null;

/** The report keys this user can generate — fetched once per page load for the PDF buttons. */
export function allowedReportKeys(): Promise<Set<string>> {
  // A different sign-in in the same tab gets its own catalogue.
  if (allowedFor !== getToken()) {
    allowedFor = getToken();
    allowedKeys = null;
  }
  allowedKeys ??= getReportCatalogue().then(
    (list) => new Set(list.map((d) => d.key)),
    () => {
      allowedKeys = null;
      return new Set<string>();
    },
  );
  return allowedKeys;
}

export async function generateReport(reportKey: string, params: ReportParams) {
  // Only send what was filled in.
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null));
  return (await apiClient.post<ArchivedReport>('/reports/generate', { reportKey, params: clean })).data;
}

export async function listArchive(params: { reportKey?: string; businessUnitId?: string; from?: string; to?: string; search?: string; page?: number; limit?: number } = {}) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined));
  return (await apiClient.get<ArchivePage>('/reports/archive', { params: clean })).data;
}

async function fileBlob(id: string) {
  const res = await apiClient.get<Blob>(`/reports/archive/${id}/file`, { responseType: 'blob' });
  return URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
}

/**
 * Opens an archived PDF in a new tab. The tab is opened straight away (in
 * the click) so pop-up blockers allow it, then pointed at the PDF once it
 * has downloaded with the user's token.
 */
export async function openReport(report: Pick<ArchivedReport, 'id' | 'fileName'>, tab?: Window | null) {
  const target = tab === undefined ? window.open('', '_blank') : tab;
  try {
    const url = await fileBlob(report.id);
    if (target) target.location.href = url;
    else downloadUrl(url, report.fileName);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    target?.close();
    throw err;
  }
}

function downloadUrl(url: string, fileName: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function downloadReport(report: Pick<ArchivedReport, 'id' | 'fileName'>) {
  const url = await fileBlob(report.id);
  downloadUrl(url, report.fileName);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Generate a report and open it — for the PDF buttons on record pages. */
export async function generateAndOpen(reportKey: string, params: ReportParams) {
  const tab = window.open('', '_blank');
  try {
    const report = await generateReport(reportKey, params);
    await openReport(report, tab);
    return report;
  } catch (err) {
    tab?.close();
    throw err;
  }
}

export async function listSchedules() {
  return (await apiClient.get<ReportSchedule[]>('/reports/schedules')).data;
}

export async function createSchedule(payload: SchedulePayload & { reportKey: string }) {
  return (await apiClient.post<ReportSchedule>('/reports/schedules', payload)).data;
}

export async function updateSchedule(id: string, payload: Partial<SchedulePayload>) {
  return (await apiClient.patch<ReportSchedule>(`/reports/schedules/${id}`, payload)).data;
}

export async function deleteSchedule(id: string) {
  await apiClient.delete(`/reports/schedules/${id}`);
}

export async function runSchedule(id: string) {
  return (await apiClient.post<ReportSchedule>(`/reports/schedules/${id}/run`)).data;
}

// Pickers for record reports that have no list helper elsewhere.
export interface PayrollRunOption {
  id: string;
  month: string;
  status: 'DRAFT' | 'FINALIZED' | 'PAID';
  businessUnit: { id: string; code: string; name: string };
  headcount: number | null;
}

export async function listPayrollRuns() {
  return (await apiClient.get<PayrollRunOption[]>('/payroll/runs')).data;
}

export function formatBytes(n: number): string {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}
