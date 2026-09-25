import { apiClient } from './client';

export type AllocationMethod = 'SUB_METERED' | 'SHARED';
export type BillStatus = 'DRAFT' | 'POSTED';

type UnitRef = { id: string; code: string; name: string };
type EntryRef = { id: string; displayNo: string; entryDate: string } | null;

export const METHOD_LABELS: Record<AllocationMethod, { label: string; hint: string }> = {
  SUB_METERED: {
    label: 'Sub-metered',
    hint: 'Each department’s own meter is charged at the bill’s rate per unit; what the meters don’t cover is split by %.',
  },
  SHARED: {
    label: 'Shared by weights',
    hint: 'The bill is divided by fixed weights — e.g. offices owned: CEO Office ½ Z & Co, ½ Zoo.',
  },
};

export interface SubMeterRecord {
  id: string;
  name: string;
  businessUnit: UnitRef;
  installedOn: string | null;
  isActive: boolean;
}

export interface ShareLine {
  label: string;
  /** businessUnitId → weight. */
  weights: Record<string, string>;
}

export interface ConnectionRecord {
  id: string;
  name: string;
  utility: string;
  provider: string | null;
  reference: string | null;
  businessUnit: UnitRef;
  method: AllocationMethod;
  standardDays: number;
  expenseAccount: { id: string; code: string; name: string } | null;
  subMeters: SubMeterRecord[];
  remainderSplit: { businessUnitId: string; pct: string; businessUnit: UnitRef }[];
  shares: ShareLine[];
  notes: string | null;
  isActive: boolean;
  lastBill?: { connectionId: string; periodTo: string; billAmount: string; status: BillStatus } | null;
}

export interface BillRow {
  id: string;
  connection: { id: string; name: string; method: AllocationMethod; businessUnit: UnitRef };
  periodFrom: string;
  periodTo: string;
  billAmount: string;
  totalUnits: string | null;
  status: BillStatus;
  rate: string | null;
  recharged: string | null;
  postedAt: string | null;
}

export interface AllocationRow {
  key: string;
  label: string;
  unitKey: string;
  consumed: string | null;
  units: string;
  pct: string | null;
  charge: string;
  businessUnit: UnitRef;
}

export interface BillDetail {
  id: string;
  connection: ConnectionRecord;
  periodFrom: string;
  periodTo: string;
  days: number;
  billAmount: string;
  totalUnits: string | null;
  status: BillStatus;
  note: string | null;
  readings: {
    subMeterId: string;
    name: string;
    businessUnitId: string;
    businessUnit: UnitRef;
    start: string;
    end: string | null;
    daysCovered: number | null;
  }[];
  remainderSplit: { businessUnitId: string; pct: string; businessUnit: UnitRef }[];
  shares: ShareLine[];
  allocation: {
    rate: string | null;
    metered: AllocationRow[];
    remainderUnits: string | null;
    remainder: AllocationRow[];
    byUnit: { unitKey: string; units: string | null; charge: string; businessUnit: UnitRef; isPayer: boolean }[];
    total: string;
  } | null;
  errors: string[];
  warnings: string[];
  postings: { label: string; unit: UnitRef; entry: EntryRef; reversal: EntryRef }[];
  paidOn: string | null;
  previous: { id: string; periodTo: string } | null;
  next: { id: string; periodTo: string } | null;
  createdByName: string | null;
  postedByName: string | null;
  postedAt: string | null;
}

export type ConnectionPayload = {
  name: string;
  utility?: string;
  provider?: string | null;
  reference?: string | null;
  businessUnitId?: string;
  method?: AllocationMethod;
  standardDays?: number;
  expenseAccountId: string;
  subMeters: { id?: string; name: string; businessUnitId: string; installedOn?: string | null; isActive?: boolean }[];
  remainderSplit: { businessUnitId: string; pct: string }[];
  shares: ShareLine[];
  notes?: string | null;
};

export async function listConnections() {
  return (await apiClient.get<ConnectionRecord[]>('/utilities/connections')).data;
}

export async function createConnection(payload: ConnectionPayload & { businessUnitId: string; method: AllocationMethod }) {
  return (await apiClient.post<ConnectionRecord>('/utilities/connections', payload)).data;
}

export async function updateConnection(id: string, payload: Partial<ConnectionPayload> & { isActive?: boolean }) {
  return (await apiClient.patch<ConnectionRecord>(`/utilities/connections/${id}`, payload)).data;
}

export async function listBills(connectionId?: string) {
  return (await apiClient.get<BillRow[]>('/utilities/bills', { params: connectionId ? { connectionId } : {} })).data;
}

export async function getBill(id: string) {
  return (await apiClient.get<BillDetail>(`/utilities/bills/${id}`)).data;
}

export async function createBill(payload: { connectionId: string; periodFrom: string; periodTo: string; billAmount: string; totalUnits?: string }) {
  return (await apiClient.post<BillDetail>('/utilities/bills', payload)).data;
}

export async function updateBill(
  id: string,
  payload: Partial<{
    periodFrom: string;
    periodTo: string;
    billAmount: string;
    totalUnits: string | null;
    readings: { subMeterId: string; start: string; end: string | null; daysCovered: number | null }[];
    remainderSplit: { businessUnitId: string; pct: string }[];
    shares: ShareLine[];
    note: string | null;
  }>,
) {
  return (await apiClient.patch<BillDetail>(`/utilities/bills/${id}`, payload)).data;
}

export async function deleteBill(id: string) {
  await apiClient.delete(`/utilities/bills/${id}`);
}

export async function postBill(id: string, payload: { paidFromAccountId?: string; paidOn?: string; reserveAccountId?: string }) {
  return (await apiClient.post<BillDetail>(`/utilities/bills/${id}/post`, payload)).data;
}

export async function unpostBill(id: string, reason?: string) {
  return (await apiClient.post<BillDetail>(`/utilities/bills/${id}/unpost`, { reason })).data;
}
