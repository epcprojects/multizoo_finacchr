import { apiClient } from './client';

export type SalesPricing = 'PER_UNIT' | 'AMOUNT';
export type FootfallKind = 'NONE' | 'ADULT' | 'KID';
export type SalesDayStatus = 'DRAFT' | 'POSTED';

type UnitRef = { id: string; code: string; name: string };
type AccountRef = { id: string; code: string; name: string };
type EntryRef = { id: string; displayNo: string } | null;

export interface SalesItemRecord {
  id: string;
  businessUnit: UnitRef;
  name: string;
  category: string;
  incomeAccount: AccountRef | null;
  pricing: SalesPricing;
  defaultRate: string | null;
  footfall: FootfallKind;
  sortOrder: number;
  isActive: boolean;
}

export interface SalesDaySummary {
  id: string;
  businessUnit: UnitRef;
  salesDate: string;
  status: SalesDayStatus;
  total: string;
  lineCount: number;
  adults: number;
  kids: number;
  entry: EntryRef;
  postedAt: string | null;
}

export interface SalesLineRecord {
  id: string;
  lineNo: number;
  itemId: string;
  itemName: string;
  category: string;
  incomeAccount: AccountRef;
  footfall: FootfallKind;
  quantity: number | null;
  rate: string | null;
  amount: string;
  note: string | null;
}

export interface SalesDayDetail {
  id: string;
  businessUnit: UnitRef;
  salesDate: string;
  status: SalesDayStatus;
  total: string;
  received: string;
  note: string | null;
  lines: SalesLineRecord[];
  receipts: { account: AccountRef; amount: string }[];
  footfall: { adults: number; kids: number };
  byAccount: { account: AccountRef; amount: string }[];
  problems: string[];
  entry: EntryRef;
  previous: { id: string; salesDate: string } | null;
  next: { id: string; salesDate: string } | null;
  createdByName: string | null;
  postedByName: string | null;
  postedAt: string | null;
}

export interface SalesStats {
  today: string;
  month: string;
  year: string;
  yearToDate: { current: string; previous: string; pct: string | null } | null;
  drafts: number;
}

export interface SalesGrid {
  businessUnitId: string | null;
  year: number;
  months: { month: number; name: string; days: (string | null)[]; total: string; daysInMonth: number; averagePerDay: string; daysWithSales: number }[];
  total: string;
  daysWithSales: number;
  averagePerSalesDay: string | null;
}

export interface SalesBreakup {
  year: number;
  businessUnitId: string | null;
  items: { item: string; category: string | null; amount: string; quantity: number; months: Record<string, { amount: string; quantity: number }> }[];
  months: { month: string; amount: string; quantity: number }[];
  total: string;
  quantity: number;
}

export interface YearOverYear {
  year: number;
  months: { month: number; name: string; current: string; previous: string; change: string; pct: string | null }[];
  current: string;
  previous: string;
  change: string;
  pct: string | null;
  toDate: { current: string; previous: string; pct: string | null } | null;
}

export interface SalesEventRecord {
  id: string;
  name: string;
  days: number;
  occurrences: { year: number; startDate: string }[];
  notes: string | null;
  isActive: boolean;
}

export interface EventComparison {
  event: SalesEventRecord;
  businessUnitId: string | null;
  days: number;
  rows: { day: number; byYear: Record<string, { date: string; amount: string | null; adults: number | null; kids: number | null }> }[];
  totals: {
    year: number;
    startDate: string;
    amount: string;
    adults: number;
    kids: number;
    daysWithSales: number;
    averagePerDay: string | null;
    change: { amount: string; pct: string | null; adults: number; kids: number } | null;
  }[];
}

export interface SalesTotal {
  amount: string;
  quantity: number;
  days: number;
  categories: string[];
}

// Price list
export async function listSalesItems(params: { businessUnitId?: string; includeInactive?: boolean } = {}) {
  const { data } = await apiClient.get<SalesItemRecord[]>('/sales/items', { params });
  return data;
}

export type SalesItemPayload = {
  name: string;
  category: string;
  incomeAccountId: string;
  pricing: SalesPricing;
  defaultRate?: string | null;
  footfall?: FootfallKind;
  sortOrder?: number;
};

export async function createSalesItem(payload: SalesItemPayload & { businessUnitId: string }) {
  const { data } = await apiClient.post<SalesItemRecord>('/sales/items', payload);
  return data;
}

export async function updateSalesItem(id: string, payload: Partial<SalesItemPayload> & { isActive?: boolean }) {
  const { data } = await apiClient.patch<SalesItemRecord>(`/sales/items/${id}`, payload);
  return data;
}

// Days
export async function getSalesStats() {
  const { data } = await apiClient.get<SalesStats>('/sales/stats');
  return data;
}

export async function listSalesDays(params: { businessUnitId?: string; from?: string; to?: string; status?: SalesDayStatus } = {}) {
  const { data } = await apiClient.get<SalesDaySummary[]>('/sales/days', { params });
  return data;
}

export async function openSalesDay(businessUnitId: string, salesDate: string) {
  const { data } = await apiClient.post<SalesDayDetail>('/sales/days', { businessUnitId, salesDate });
  return data;
}

export async function getSalesDay(id: string) {
  const { data } = await apiClient.get<SalesDayDetail>(`/sales/days/${id}`);
  return data;
}

export async function saveSalesDay(
  id: string,
  payload: {
    lines: { itemId: string; quantity?: number | null; rate?: string | null; amount?: string | null; note?: string | null }[];
    receipts: { accountId: string; amount: string }[];
    note?: string | null;
  },
) {
  const { data } = await apiClient.patch<SalesDayDetail>(`/sales/days/${id}`, payload);
  return data;
}

export async function deleteSalesDay(id: string) {
  await apiClient.delete(`/sales/days/${id}`);
}

export async function postSalesDay(id: string) {
  const { data } = await apiClient.post<SalesDayDetail>(`/sales/days/${id}/post`);
  return data;
}

export async function unpostSalesDay(id: string, reason?: string) {
  const { data } = await apiClient.post<SalesDayDetail>(`/sales/days/${id}/unpost`, { reason });
  return data;
}

// Reports
export async function getSalesGrid(year: number, businessUnitId?: string) {
  const { data } = await apiClient.get<SalesGrid>('/sales/reports/grid', { params: { year, businessUnitId: businessUnitId || undefined } });
  return data;
}

export async function getSalesBreakup(year: number, businessUnitId?: string) {
  const { data } = await apiClient.get<SalesBreakup>('/sales/reports/breakup', { params: { year, businessUnitId: businessUnitId || undefined } });
  return data;
}

export async function getYearOverYear(year: number, businessUnitId?: string) {
  const { data } = await apiClient.get<YearOverYear>('/sales/reports/year-over-year', { params: { year, businessUnitId: businessUnitId || undefined } });
  return data;
}

export async function compareEvent(eventId: string, businessUnitId?: string) {
  const { data } = await apiClient.get<EventComparison>('/sales/reports/compare', { params: { eventId, businessUnitId: businessUnitId || undefined } });
  return data;
}

export async function getSalesTotal(params: { businessUnitId: string; from: string; to: string; category?: string }) {
  const { data } = await apiClient.get<SalesTotal>('/sales/reports/total', { params });
  return data;
}

// Events
export async function listSalesEvents() {
  const { data } = await apiClient.get<SalesEventRecord[]>('/sales/events');
  return data;
}

export type SalesEventPayload = { name: string; days: number; occurrences: { year: number; startDate: string }[]; notes?: string | null; isActive?: boolean };

export async function createSalesEvent(payload: SalesEventPayload) {
  const { data } = await apiClient.post<SalesEventRecord>('/sales/events', payload);
  return data;
}

export async function updateSalesEvent(id: string, payload: SalesEventPayload) {
  const { data } = await apiClient.patch<SalesEventRecord>(`/sales/events/${id}`, payload);
  return data;
}

/** "12.5" → "+12.5%", "-3.0" → "−3.0%", null → "—". */
export function formatPct(pct: string | null): string {
  if (pct === null) return '—';
  return pct.startsWith('-') ? `−${pct.slice(1)}%` : `+${pct}%`;
}
