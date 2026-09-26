import { apiClient } from './client';

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
export type UnitRule = 'UNIT_REQUIRED' | 'GROUP_ONLY' | 'EITHER';
export type EntryKind =
  | 'MONEY_IN'
  | 'MONEY_OUT'
  | 'TRANSFER'
  | 'OPENING_BALANCE'
  | 'GENERAL'
  | 'REVERSAL'
  | 'ALLOCATION'
  | 'RESERVE_TRANSFER'
  | 'PARTNER_DRAWING'
  | 'PAYROLL'
  | 'LOAN';

/** BUCKET (Feed…), PARTNER (a partner's profit reserve), OFFSET (Earmarked Funds). */
export type ReserveKind = 'BUCKET' | 'PARTNER' | 'OFFSET';

export const UNIT_RULE_LABELS: Record<UnitRule, string> = {
  UNIT_REQUIRED: 'Belongs to a business unit',
  GROUP_ONLY: 'Group-wide (unit recorded on each entry)',
  EITHER: 'Either — chosen per account',
};

export const ACCOUNT_TYPES: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];

/** A configurable "Type of business" — see the type dropdown's "Add new type". */
export interface BusinessUnitTypeRecord {
  id: string;
  key: string;
  name: string;
  description: string | null;
  /** Non-trading: new units default to a bank account and no reserves. */
  isHolding: boolean;
  sortOrder: number;
  isSystem: boolean;
  isActive: boolean;
  unitCount: number;
}

export async function listBusinessUnitTypes(includeInactive = false) {
  const { data } = await apiClient.get<BusinessUnitTypeRecord[]>('/business-unit-types', {
    params: includeInactive ? { includeInactive: true } : {},
  });
  return data;
}

export async function createBusinessUnitType(payload: {
  name: string;
  description?: string;
  isHolding?: boolean;
}) {
  const { data } = await apiClient.post<BusinessUnitTypeRecord>('/business-unit-types', payload);
  return data;
}

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

/** A configurable kind of account — see Accounts → Settings. */
export interface AccountClassRecord {
  id: string;
  key: string;
  name: string;
  type: AccountType;
  unitRule: UnitRule;
  codeStart: number;
  codeEnd: number;
  isLiquid: boolean;
  isReserve: boolean;
  isReconcilable: boolean;
  provisionForNewUnits: boolean;
  defaultAccountName: string | null;
  sortOrder: number;
  isSystem: boolean;
  isActive: boolean;
  description: string | null;
  accountCount: number;
}

/** The slice of a class every account carries with it. */
export type AccountClassRef = Pick<
  AccountClassRecord,
  'id' | 'key' | 'name' | 'unitRule' | 'isLiquid' | 'isReserve' | 'isReconcilable'
>;

export interface ChartSettingsRecord {
  unitCodePattern: string;
  groupCodePattern: string;
  codeStep: number;
  updatedAt: string | null;
  examples: { unit: string; group: string };
}

export const KIND_LABELS: Record<EntryKind, string> = {
  MONEY_IN: 'Money in',
  MONEY_OUT: 'Money out',
  TRANSFER: 'Transfer',
  OPENING_BALANCE: 'Opening balance',
  GENERAL: 'General journal',
  REVERSAL: 'Reversal',
  ALLOCATION: 'Allocation',
  RESERVE_TRANSFER: 'Reserve transfer',
  PARTNER_DRAWING: 'Partner drawing',
  PAYROLL: 'Payroll',
  LOAN: 'Loan',
};

export interface BusinessUnitRecord {
  id: string;
  code: string;
  name: string;
  typeId: string;
  typeName: string;
  isHolding: boolean;
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
  accountClass: AccountClassRef | null;
  isPostable: boolean;
  isSystem: boolean;
  systemKey: string | null;
  isActive: boolean;
  description: string | null;
  parentId: string | null;
  parentName: string | null;
  businessUnit: { id: string; code: string; name: string } | null;
  isDebitNormal: boolean;
  partnerId: string | null;
  reserveKind: ReserveKind | null;
  /** A loan's own account — posted from the Loans screens only. */
  loanId: string | null;
  /** A campaign's fund — posted from the Campaigns screens only. */
  campaignId?: string | null;
  balance: string;
}

export interface CostCentreRef {
  id: string;
  code: string;
  name: string;
}

export interface EntryLine {
  id: string;
  lineNo: number;
  accountId: string;
  accountCode: string;
  accountName: string;
  accountClassName: string | null;
  isLiquid: boolean;
  reserveKind: ReserveKind | null;
  debit: string;
  credit: string;
  memo: string | null;
  costCentre: CostCentreRef | null;
  /** Added by the ledger to route a cost centre's spending to a partner. */
  crossCharge: boolean;
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
  costCentre: CostCentreRef | null;
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
  typeId: string;
  isActive: boolean;
  accounts: { id: string; code: string; name: string; classId: string; isActive: boolean; balance: string }[];
  /** Balance per money-on-hand class id. */
  byClass: Record<string, string>;
  total: string;
  inflow: string;
  outflow: string;
}

export interface CashPosition {
  asOf: string;
  /** The money-on-hand classes — the report's columns, in order. */
  classes: { id: string; key: string; name: string; isActive: boolean }[];
  totals: { byClass: Record<string, string>; total: string; inflow: string; outflow: string };
  units: CashPositionUnit[];
}

export interface UnitTemplates {
  reserveCatalog: string[];
  provisionableClasses: {
    id: string;
    key: string;
    name: string;
    accountName: string;
    isLiquid: boolean;
    byDefault: boolean;
  }[];
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
  kind: Exclude<EntryKind, 'REVERSAL' | 'ALLOCATION' | 'PAYROLL' | 'LOAN'>;
  lines: { accountId: string; debit?: string; credit?: string; memo?: string }[];
  /** Money out only: the reserve this payment is paid out of. */
  reserveAccountId?: string;
  /** Spending only: the cost centre it's for. */
  costCentreId?: string;
}

// --- Business units ---------------------------------------------------------

export async function listBusinessUnits() {
  const { data } = await apiClient.get<BusinessUnitRecord[]>('/business-units');
  return data;
}

export async function getUnitTemplates() {
  const { data } = await apiClient.get<UnitTemplates>('/business-units/templates');
  return data;
}

export async function createBusinessUnit(payload: {
  code: string;
  name: string;
  typeId: string;
  description?: string;
  accountClassIds: string[];
  reserveBuckets: string[];
  openingBalances?: { asOfDate: string; amounts: { classId: string; amount: string }[] };
}) {
  const { data } = await apiClient.post<BusinessUnitRecord>('/business-units', payload);
  return data;
}

export async function updateBusinessUnit(
  id: string,
  payload: Partial<{
    name: string;
    code: string;
    relabelAccountCodes: boolean;
    typeId: string;
    description: string;
    isActive: boolean;
  }>,
) {
  const { data } = await apiClient.patch<BusinessUnitRecord>(`/business-units/${id}`, payload);
  return data;
}

export async function addUnitAccounts(id: string, payload: { accountClassIds?: string[]; reserveBuckets?: string[] }) {
  const { data } = await apiClient.post<{ created: { id: string; code: string; name: string }[] }>(
    `/business-units/${id}/accounts`,
    payload,
  );
  return data;
}

export interface UnitOpeningBalances {
  entries: { id: string; displayNo: string; entryDate: string; description: string }[];
  asOfDate: string | null;
  accounts: {
    id: string;
    code: string;
    name: string;
    type: AccountType;
    className: string;
    isLiquid: boolean;
    amount: string;
  }[];
}

export async function getUnitOpeningBalances(id: string) {
  const { data } = await apiClient.get<UnitOpeningBalances>(`/business-units/${id}/opening-balances`);
  return data;
}

export async function setUnitOpeningBalances(
  id: string,
  payload: {
    asOfDate: string;
    amounts: { accountId: string; amount: string }[];
    replaceExisting?: boolean;
    reason?: string;
  },
) {
  const { data } = await apiClient.put<UnitOpeningBalances>(`/business-units/${id}/opening-balances`, payload);
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
  classId: string;
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
  payload: Partial<{ name: string; code: string; classId: string; description: string; isActive: boolean }>,
) {
  const { data } = await apiClient.patch<AccountRecord>(`/accounts/${id}`, payload);
  return data;
}

// --- Account classes & numbering -------------------------------------------

export type AccountClassPayload = Omit<
  AccountClassRecord,
  'id' | 'key' | 'isSystem' | 'isActive' | 'accountCount' | 'defaultAccountName' | 'description'
> & { defaultAccountName?: string; description?: string };

export async function listAccountClasses(includeInactive = false) {
  const { data } = await apiClient.get<AccountClassRecord[]>('/account-classes', {
    params: includeInactive ? { includeInactive: true } : {},
  });
  return data;
}

export async function createAccountClass(payload: AccountClassPayload) {
  const { data } = await apiClient.post<AccountClassRecord>('/account-classes', payload);
  return data;
}

export async function updateAccountClass(id: string, payload: Partial<AccountClassPayload & { isActive: boolean }>) {
  const { data } = await apiClient.patch<AccountClassRecord>(`/account-classes/${id}`, payload);
  return data;
}

export async function getChartSettings() {
  const { data } = await apiClient.get<ChartSettingsRecord>('/chart-settings');
  return data;
}

export async function updateChartSettings(
  payload: Partial<Pick<ChartSettingsRecord, 'unitCodePattern' | 'groupCodePattern' | 'codeStep'>>,
) {
  const { data } = await apiClient.patch<ChartSettingsRecord>('/chart-settings', payload);
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
  costCentreId?: string;
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
