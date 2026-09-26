import { apiClient } from './client';

export type CapexFunding = 'PAID_HERE' | 'LINKED_ENTRY' | 'NOT_RECORDED';
export type CapexStatus = 'ACTIVE' | 'RETIRED';
export type PaybackState = 'PAID_BACK' | 'ON_TRACK' | 'BEHIND' | 'OVERDUE' | 'NO_TARGET' | 'NOT_TRACKED';
export type CampaignStatus = 'OPEN' | 'CLOSED';
export type CampaignEntryType = 'INCOME' | 'EXPENSE';

type UnitRef = { id: string; code: string; name: string };
type AccountRef = { id: string; code: string; name: string };
type EntryRef = { id: string; displayNo: string } | null;

export interface Payback {
  state: PaybackState;
  recovered: string | null;
  recoveredPct: string | null;
  remaining: string | null;
  expectedBy: string | null;
  paidBackOn: string | null;
  expectedSoFar: string | null;
}

export interface CapexRecord {
  id: string;
  businessUnit: UnitRef;
  purchaseDate: string;
  name: string;
  nature: string;
  amount: string;
  paybackMonths: number | null;
  funding: CapexFunding;
  accountId: string | null;
  entry: (NonNullable<EntryRef> & { reversed: boolean }) | null;
  earningItemIds: string[];
  status: CapexStatus;
  retiredOn: string | null;
  note: string | null;
  payback: Payback;
  /** Only on the detail. */
  earningsByMonth?: { month: string; amount: string }[];
}

export interface CapexRegister {
  items: CapexRecord[];
  summary: {
    total: string;
    count: number;
    byNature: { nature: string; amount: string; count: number }[];
    byUnit: { unit: string; amount: string; count: number }[];
    byYear: { year: string; amount: string; count: number }[];
  };
  natures: string[];
  defaultAccountId: string | null;
}

export async function listCapex(params: { businessUnitId?: string; status?: CapexStatus } = {}) {
  const { data } = await apiClient.get<CapexRegister>('/capex', { params });
  return data;
}

export async function getCapex(id: string) {
  const { data } = await apiClient.get<CapexRecord>(`/capex/${id}`);
  return data;
}

export async function createCapex(payload: {
  businessUnitId: string;
  purchaseDate: string;
  name: string;
  nature: string;
  amount: string;
  paybackMonths?: number | null;
  funding: CapexFunding;
  accountId?: string;
  paidFromAccountId?: string;
  reserveAccountId?: string | null;
  journalEntryId?: string;
  earningItemIds?: string[];
  note?: string | null;
}) {
  const { data } = await apiClient.post<CapexRecord>('/capex', payload);
  return data;
}

export async function updateCapex(
  id: string,
  payload: Partial<{ name: string; nature: string; purchaseDate: string; amount: string; paybackMonths: number | null; earningItemIds: string[]; note: string | null }>,
) {
  const { data } = await apiClient.patch<CapexRecord>(`/capex/${id}`, payload);
  return data;
}

export async function retireCapex(id: string, retiredOn: string, note?: string) {
  const { data } = await apiClient.post<CapexRecord>(`/capex/${id}/retire`, { retiredOn, note });
  return data;
}

export async function reinstateCapex(id: string) {
  const { data } = await apiClient.post<CapexRecord>(`/capex/${id}/reinstate`);
  return data;
}

export async function removeCapex(id: string, reason?: string) {
  await apiClient.delete(`/capex/${id}`, { data: { reason } });
}

// Campaigns

export interface CampaignStatement {
  income: string;
  expenses: string;
  balance: string;
  incomeByCategory: { category: string; amount: string }[];
  expensesByCategory: { category: string; amount: string }[];
  byDate: { date: string; income: string; expenses: string; balance: string }[];
  budget: { total: string; stillToRaise: string; left: string; spentPct: string | null } | null;
  overRaisedPct: string | null;
}

export interface CampaignSummary {
  id: string;
  name: string;
  businessUnit: UnitRef;
  startDate: string;
  endDate: string | null;
  status: CampaignStatus;
  budget: { label: string; amount: string }[];
  notes: string | null;
  closedOn: string | null;
  income: string;
  expenses: string;
  balance: string;
  budgetTotal: string | null;
  entryCount: number;
}

export interface CampaignDetail extends Omit<CampaignSummary, 'income' | 'expenses' | 'balance' | 'budgetTotal' | 'entryCount'> {
  fundAccount: AccountRef | null;
  closeAccount: AccountRef | null;
  closingEntry: EntryRef;
  closedByName: string | null;
  statement: CampaignStatement;
  entries: {
    id: string;
    entryDate: string;
    type: CampaignEntryType;
    category: string;
    description: string;
    amount: string;
    account: AccountRef | null;
    status: 'POSTED' | 'REVERSED';
    balance: string | null;
    entry: EntryRef;
    reversal: EntryRef;
    createdByName: string | null;
  }[];
  categories: string[];
}

export async function listCampaigns() {
  const { data } = await apiClient.get<CampaignSummary[]>('/campaigns');
  return data;
}

export async function getCampaign(id: string) {
  const { data } = await apiClient.get<CampaignDetail>(`/campaigns/${id}`);
  return data;
}

export type CampaignPayload = {
  name: string;
  startDate: string;
  endDate?: string | null;
  budget?: { label: string; amount: string }[];
  notes?: string | null;
};

export async function createCampaign(payload: CampaignPayload & { businessUnitId: string }) {
  const { data } = await apiClient.post<CampaignDetail>('/campaigns', payload);
  return data;
}

export async function updateCampaign(id: string, payload: Partial<CampaignPayload>) {
  const { data } = await apiClient.patch<CampaignDetail>(`/campaigns/${id}`, payload);
  return data;
}

export async function addCampaignEntry(
  id: string,
  payload: { type: CampaignEntryType; entryDate: string; category: string; description: string; amount: string; accountId: string },
) {
  const { data } = await apiClient.post<CampaignDetail>(`/campaigns/${id}/entries`, payload);
  return data;
}

export async function reverseCampaignEntry(id: string, entryId: string, reason?: string) {
  const { data } = await apiClient.post<CampaignDetail>(`/campaigns/${id}/entries/${entryId}/reverse`, { reason });
  return data;
}

export async function closeCampaign(id: string, payload: { accountId?: string; closedOn?: string }) {
  const { data } = await apiClient.post<CampaignDetail>(`/campaigns/${id}/close`, payload);
  return data;
}

export async function reopenCampaign(id: string) {
  const { data } = await apiClient.post<CampaignDetail>(`/campaigns/${id}/reopen`);
  return data;
}

export const PAYBACK_LABEL: Record<PaybackState, string> = {
  PAID_BACK: 'Paid back',
  ON_TRACK: 'On track',
  BEHIND: 'Behind',
  OVERDUE: 'Overdue',
  NO_TARGET: 'No target',
  NOT_TRACKED: 'Not tracked',
};
