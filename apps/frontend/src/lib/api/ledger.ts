import { apiClient } from './client';

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
export type AccountSubtype =
  | 'CASH'
  | 'BANK'
  | 'WALLET'
  | 'RESERVE'
  | 'RECEIVABLE'
  | 'PAYABLE'
  | 'EQUITY'
  | 'INCOME'
  | 'EXPENSE';
export type BusinessUnitType =
  | 'WILDLIFE_PARK'
  | 'FOOD_BEVERAGE'
  | 'RETAIL'
  | 'ENTERTAINMENT'
  | 'LIVESTOCK'
  | 'HOLDING';
export type EntryKind =
  | 'MONEY_IN'
  | 'MONEY_OUT'
  | 'TRANSFER'
  | 'OPENING_BALANCE'
  | 'GENERAL'
  | 'REVERSAL';

export const LIQUID: AccountSubtype[] = ['CASH', 'BANK', 'WALLET'];

export const UNIT_TYPE_LABELS: Record<BusinessUnitType, string> = {
  WILDLIFE_PARK: 'Wildlife park',
  FOOD_BEVERAGE: 'Food & beverage',
  RETAIL: 'Retail',
  ENTERTAINMENT: 'Entertainment',
  LIVESTOCK: 'Livestock',
  HOLDING: 'Holding company',
};

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  ASSET: 'Assets',
  LIABILITY: 'Liabilities',
  EQUITY: 'Equity',
  INCOME: 'Income',
  EXPENSE: 'Expenses',
};

/** Follow the Rupee, Part 1 — the one-line meaning of each bucket. */
export const ACCOUNT_TYPE_HINTS: Record<AccountType, string> = {
  ASSET: 'What the business owns or is owed',
  LIABILITY: 'What the business owes to someone else',
  EQUITY: 'What actually belongs to the partners',
  INCOME: 'Money earned',
  EXPENSE: 'Money spent to run the business',
};

export const SUBTYPE_LABELS: Record<AccountSubtype, string> = {
  CASH: 'Cash',
  BANK: 'Bank',
  WALLET: 'Mobile wallet',
  RESERVE: 'Reserve',
  RECEIVABLE: 'Receivable',
  PAYABLE: 'Payable',
  EQUITY: 'Equity',
  INCOME: 'Income',
  EXPENSE: 'Expense',
};

export const KIND_LABELS: Record<EntryKind, string> = {
  MONEY_IN: 'Money in',
  MONEY_OUT: 'Money out',
  TRANSFER: 'Transfer',
  OPENING_BALANCE: 'Opening balance',
  GENERAL: 'General journal',
  REVERSAL: 'Reversal',
};

export interface BusinessUnitRecord {
  id: string;
  code: string;
  name: string;
  type: BusinessUnitType;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  accountCount: number;
  reserveBuckets: string[];
}

export interface AccountRecord {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: AccountSubtype;
  isPostable: boolean;
  isSystem: boolean;
  isActive: boolean;
  description: string | null;
  parentId: string | null;
  parentName: string | null;
  businessUnit: { id: string; code: string; name: string } | null;
  isDebitNormal: boolean;
  balance: string;
}

export interface EntryLine {
  id: string;
  lineNo: number;
  accountId: string;
  accountCode: string;
  accountName: string;
  accountSubtype: AccountSubtype;
  debit: string;
  credit: string;
  memo: string | null;
}

export interface JournalEntryRecord {
  id: string;
  entryNo: number;
  displayNo: string;
  entryDate: string;
  description: string;
  reference: string | null;
  kind: EntryKind;
  source: string;
  businessUnit: { id: string; code: string; name: string } | null;
  amount: string;
  reversalOfId: string | null;
  reversedById: string | null;
  reversalOfNo?: string | null;
  reversedByNo?: string | null;
  createdAt: string;
  createdByName: string | null;
  lines: EntryLine[];
}

export interface LedgerRow {
  entryId: string;
  displayNo: string;
  entryDate: string;
  description: string;
  reference: string | null;
  kind: EntryKind;
  memo: string | null;
  against: string[];
  debit: string;
  credit: string;
  balance: string;
  isReversed: boolean;
  isReversal: boolean;
}

export interface AccountLedger {
  account: Omit<AccountRecord, 'balance'>;
  from: string | null;
  to: string | null;
  openingBalance: string;
  closingBalance: string;
  totalDebit: string;
  totalCredit: string;
  rows: LedgerRow[];
}

export interface CashPositionUnit {
  id: string;
  code: string;
  name: string;
  type: BusinessUnitType;
  isActive: boolean;
  accounts: { id: string; code: string; name: string; subtype: AccountSubtype; isActive: boolean; balance: string }[];
  cash: string;
  bank: string;
  wallet: string;
  total: string;
  inflow: string;
  outflow: string;
}

export interface CashPosition {
  asOf: string;
  totals: { cash: string; bank: string; wallet: string; total: string; inflow: string; outflow: string };
  units: CashPositionUnit[];
}

export interface Reconciliation {
  id: string;
  asOfDate: string;
  systemBalance: string;
  countedBalance: string;
  variance: string;
  note: string | null;
  createdAt: string;
  createdByName: string | null;
}

export interface NewEntryPayload {
  entryDate: string;
  businessUnitId: string;
  description: string;
  reference?: string;
  kind: Exclude<EntryKind, 'REVERSAL'>;
  lines: { accountId: string; debit?: string; credit?: string; memo?: string }[];
}

// --- Business units ---------------------------------------------------------

export async function listBusinessUnits() {
  const { data } = await apiClient.get<BusinessUnitRecord[]>('/business-units');
  return data;
}

export async function getUnitTemplates() {
  const { data } = await apiClient.get<{ reserveCatalog: string[] }>('/business-units/templates');
  return data;
}

export async function createBusinessUnit(payload: {
  code: string;
  name: string;
  type: BusinessUnitType;
  description?: string;
  reserveBuckets: string[];
  openingBalances?: { asOfDate: string; cash?: string; bank?: string; wallet?: string };
}) {
  const { data } = await apiClient.post<BusinessUnitRecord>('/business-units', payload);
  return data;
}

export async function updateBusinessUnit(
  id: string,
  payload: Partial<{ name: string; type: BusinessUnitType; description: string; isActive: boolean }>,
) {
  const { data } = await apiClient.patch<BusinessUnitRecord>(`/business-units/${id}`, payload);
  return data;
}

// --- Accounts ---------------------------------------------------------------

export async function listAccounts(params: {
  businessUnitId?: string;
  type?: AccountType;
  search?: string;
  includeInactive?: boolean;
} = {}) {
  const { data } = await apiClient.get<AccountRecord[]>('/accounts', { params });
  return data;
}

export async function getAccount(id: string) {
  const { data } = await apiClient.get<AccountRecord>(`/accounts/${id}`);
  return data;
}

export async function createAccount(payload: {
  name: string;
  subtype: AccountSubtype;
  businessUnitId?: string;
  parentId?: string;
  code?: string;
  isPostable?: boolean;
  description?: string;
}) {
  const { data } = await apiClient.post<AccountRecord>('/accounts', payload);
  return data;
}

export async function updateAccount(
  id: string,
  payload: Partial<{ name: string; description: string; isActive: boolean }>,
) {
  const { data } = await apiClient.patch<AccountRecord>(`/accounts/${id}`, payload);
  return data;
}

export async function getAccountLedger(id: string, params: { from?: string; to?: string }) {
  const { data } = await apiClient.get<AccountLedger>(`/accounts/${id}/ledger`, { params });
  return data;
}

export async function listReconciliations(accountId: string) {
  const { data } = await apiClient.get<Reconciliation[]>(`/accounts/${accountId}/reconciliations`);
  return data;
}

export async function createReconciliation(
  accountId: string,
  payload: { asOfDate: string; countedBalance: string; note?: string },
) {
  const { data } = await apiClient.post<Reconciliation>(`/accounts/${accountId}/reconciliations`, payload);
  return data;
}

// --- Journal ----------------------------------------------------------------

export async function listJournalEntries(params: {
  businessUnitId?: string;
  accountId?: string;
  from?: string;
  to?: string;
  kind?: EntryKind;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const { data } = await apiClient.get<{
    items: JournalEntryRecord[];
    total: number;
    page: number;
    limit: number;
  }>('/journal-entries', { params });
  return data;
}

export async function getJournalEntry(id: string) {
  const { data } = await apiClient.get<JournalEntryRecord>(`/journal-entries/${id}`);
  return data;
}

export async function postJournalEntry(payload: NewEntryPayload) {
  const { data } = await apiClient.post<JournalEntryRecord>('/journal-entries', payload);
  return data;
}

export async function reverseJournalEntry(id: string, payload: { reason?: string; entryDate?: string }) {
  const { data } = await apiClient.post<JournalEntryRecord>(`/journal-entries/${id}/reverse`, payload);
  return data;
}

// --- Reports ----------------------------------------------------------------

export async function getCashPosition(asOf?: string) {
  const { data } = await apiClient.get<CashPosition>('/ledger/cash-position', {
    params: asOf ? { asOf } : {},
  });
  return data;
}
