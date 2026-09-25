import { apiClient } from './client';

export type CounterpartyKind = 'PARTNER' | 'EMPLOYEE' | 'BUSINESS_UNIT' | 'PERSON' | 'ORGANISATION';
export type LoanDirection = 'RECEIVABLE' | 'PAYABLE';
export type LoanStatus = 'PENDING_APPROVAL' | 'ACTIVE' | 'REJECTED' | 'CLOSED';
export type MovementEffect = 'INCREASE' | 'DECREASE';
export type MovementMethod = 'CASH' | 'ON_ACCOUNT' | 'PROFIT_SETOFF' | 'OPENING';
export type MovementStatus = 'PENDING_APPROVAL' | 'POSTED' | 'REJECTED' | 'REVERSED';

type UnitRef = { id: string; code: string; name: string };
type EntryRef = { id: string; displayNo: string; entryDate: string } | null;

export const KIND_LABELS: Record<CounterpartyKind, string> = {
  PARTNER: 'Partner',
  EMPLOYEE: 'Employee',
  BUSINESS_UNIT: 'Business unit',
  PERSON: 'Person',
  ORGANISATION: 'Company / organisation',
};

export const LOAN_STATUS: Record<LoanStatus, { label: string; tone: 'amber' | 'green' | 'red' | 'gray' }> = {
  PENDING_APPROVAL: { label: 'Awaiting approval', tone: 'amber' },
  ACTIVE: { label: 'Active', tone: 'green' },
  REJECTED: { label: 'Rejected', tone: 'red' },
  CLOSED: { label: 'Closed', tone: 'gray' },
};

export const MOVEMENT_STATUS: Record<MovementStatus, { label: string; tone: 'amber' | 'green' | 'red' | 'gray' }> = {
  PENDING_APPROVAL: { label: 'Awaiting approval', tone: 'amber' },
  POSTED: { label: 'Posted', tone: 'green' },
  REJECTED: { label: 'Rejected', tone: 'red' },
  REVERSED: { label: 'Reversed', tone: 'gray' },
};

/** "Lent to them" / "Borrowed from them", from the unit's point of view. */
export const DIRECTION_LABELS: Record<LoanDirection, string> = {
  RECEIVABLE: 'We lent — they owe us',
  PAYABLE: 'We borrowed — we owe them',
};

/**
 * The plain-language verbs a movement is recorded with. Each maps to an
 * effect (adds to / pays back what's owed) and a method (what the other side
 * of the entry is).
 */
export type MovementVerb = {
  key: string;
  label: string;
  hint: string;
  effect: MovementEffect;
  method: MovementMethod;
  /** Which kind of account to choose on the other side. */
  pick: 'CASH' | 'EXPENSE' | 'INCOME_OR_ASSET' | 'WRITE_OFF' | 'NONE';
  partnerOnly?: boolean;
};

export function movementVerbs(direction: LoanDirection, isPartner: boolean): MovementVerb[] {
  const lent = direction === 'RECEIVABLE';
  const verbs: MovementVerb[] = lent
    ? [
        { key: 'lend', label: 'Lent more', hint: 'Cash, bank or wallet paid out to them.', effect: 'INCREASE', method: 'CASH', pick: 'CASH' },
        { key: 'repaid', label: 'They repaid', hint: 'Money received back into cash, bank or wallet.', effect: 'DECREASE', method: 'CASH', pick: 'CASH' },
        {
          key: 'charged',
          label: 'Charged to them',
          hint: 'Something of ours they took or used — e.g. cafe bills charged to their account. No cash moves.',
          effect: 'INCREASE',
          method: 'ON_ACCOUNT',
          pick: 'INCOME_OR_ASSET',
        },
        {
          key: 'spent',
          label: 'They spent it for us',
          hint: 'An officer paid a company bill out of the float they hold — the expense is ours, their balance goes down.',
          effect: 'DECREASE',
          method: 'ON_ACCOUNT',
          pick: 'EXPENSE',
        },
        {
          key: 'setoff',
          label: 'Set off against their profit',
          hint: 'Repaid out of the partner’s profit share: debits their capital & current account and releases their profit reserve in this unit.',
          effect: 'DECREASE',
          method: 'PROFIT_SETOFF',
          pick: 'NONE',
          partnerOnly: true,
        },
        { key: 'writeoff', label: 'Write off', hint: 'What can’t be recovered — a Partner approves it.', effect: 'DECREASE', method: 'ON_ACCOUNT', pick: 'WRITE_OFF' },
      ]
    : [
        { key: 'borrow', label: 'Borrowed more', hint: 'Money they gave us, into cash, bank or wallet.', effect: 'INCREASE', method: 'CASH', pick: 'CASH' },
        {
          key: 'paidforus',
          label: 'They paid a bill for us',
          hint: 'They paid a supplier or an expense on our behalf — e.g. MQK paying for the boxing machine. No cash moves here.',
          effect: 'INCREASE',
          method: 'ON_ACCOUNT',
          pick: 'EXPENSE',
        },
        { key: 'repay', label: 'We repaid', hint: 'Cash, bank or wallet paid back to them.', effect: 'DECREASE', method: 'CASH', pick: 'CASH' },
        {
          key: 'leftprofit',
          label: 'Left their profit with us',
          hint: 'The partner leaves profit in the business as a loan: debits their capital & current account and releases their profit reserve here.',
          effect: 'INCREASE',
          method: 'PROFIT_SETOFF',
          pick: 'NONE',
          partnerOnly: true,
        },
        {
          key: 'charged',
          label: 'Charged against it',
          hint: 'Something of ours they took, set against what we owe them. No cash moves.',
          effect: 'DECREASE',
          method: 'ON_ACCOUNT',
          pick: 'INCOME_OR_ASSET',
        },
      ];
  verbs.push({
    key: 'opening',
    label: 'Opening balance',
    hint: 'A balance brought in from the workbooks at cutover.',
    effect: 'INCREASE',
    method: 'OPENING',
    pick: 'NONE',
  });
  return verbs.filter((v) => !v.partnerOnly || isPartner);
}

export interface CounterpartyRecord {
  id: string;
  name: string;
  kind: CounterpartyKind;
  partner: { id: string; shortName: string } | null;
  employee: { id: string; employeeCode: string; unit: string | null; designation: string | null; status: string } | null;
  businessUnit: UnitRef | null;
  phone: string | null;
  notes: string | null;
  isActive: boolean;
  loanCount: number;
  /** Positive: they owe us. Negative: we owe them. */
  net: string;
  staffAdvances: string;
}

export interface LoanRecord {
  id: string;
  loanNo: string;
  counterparty: { id: string; name: string; kind: CounterpartyKind } | null;
  businessUnit: UnitRef | null;
  direction: LoanDirection;
  purpose: string;
  limit: string | null;
  headroom: string | null;
  status: LoanStatus;
  principal: string;
  repaid: string;
  outstanding: string;
  pending: number;
  isInterUnit: boolean;
  account: { id: string; code: string; name: string } | null;
  createdAt: string;
  closedAt: string | null;
}

export interface LoanMovementRecord {
  id: string;
  movementDate: string;
  effect: MovementEffect;
  method: MovementMethod;
  amount: string;
  description: string;
  otherAccount: { id: string; code: string; name: string };
  status: MovementStatus;
  balance: string | null;
  entry: EntryRef;
  reversalEntry: EntryRef;
  fromUtilityBill: string | null;
  isInterUnit: boolean;
  createdByName: string | null;
  createdAt: string;
  reviewedByName: string | null;
  reviewNote: string | null;
}

export interface LoanDetail extends LoanRecord {
  createdBy: string | null;
  createdByName: string | null;
  reviewedByName: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  mirror: { id: string; loanNo: string; businessUnit: UnitRef } | null;
  movements: LoanMovementRecord[];
}

export interface LoanStats {
  owedToUs: string;
  weOwe: string;
  interUnitOpen: string;
  staffAdvances: string;
  pendingApprovals: number;
}

export interface Approvals {
  loans: (LoanRecord & {
    opening: { movementDate: string; effect: MovementEffect; method: MovementMethod; amount: string; description: string }[];
    createdByName: string | null;
  })[];
  movements: {
    id: string;
    loan: LoanRecord;
    movementDate: string;
    effect: MovementEffect;
    method: MovementMethod;
    amount: string;
    description: string;
    otherAccount: { id: string; code: string; name: string };
    interUnit: { from: string; to: string } | null;
    reason: string;
    createdByName: string | null;
    createdAt: string;
  }[];
}

export interface InterUnitPair {
  id: string;
  mirrorLoanId: string;
  units: [UnitRef, UnitRef];
  balance: string;
  debtor: UnitRef | null;
  creditor: UnitRef | null;
  pending: number;
}

export type StaffAdvanceStatus = 'OUTSTANDING' | 'RECOVERED' | 'CANCELLED' | 'WRITTEN_OFF';

export interface StaffAdvanceRow {
  id: string;
  issueDate: string;
  businessUnit: UnitRef | null;
  amount: string;
  reason: string;
  status: StaffAdvanceStatus;
  recovered: string;
  outstanding: string;
  writtenOff: string | null;
  writeOffReason: string | null;
  employee: { id: string; employeeCode: string; fullName: string; designation: string | null; status: string; exitDate: string | null };
  counterpartyId: string | null;
  settlement: { id: string; status: string } | null;
  canWriteOff: boolean;
  writeOffEntry: EntryRef;
}

export interface CounterpartyStatement {
  counterparty: Omit<CounterpartyRecord, 'loanCount' | 'net' | 'staffAdvances'>;
  loans: (Pick<LoanRecord, 'id' | 'loanNo' | 'direction' | 'purpose' | 'status' | 'limit' | 'principal' | 'repaid' | 'outstanding'> & {
    businessUnit: UnitRef;
    account: { id: string; code: string; name: string } | null;
  })[];
  movements: {
    id: string;
    date: string;
    loan: { id: string; loanNo: string; direction: LoanDirection; unit: string };
    description: string;
    effect: MovementEffect;
    method: MovementMethod;
    amount: string;
    net: string;
    entry: EntryRef;
  }[];
  staffAdvances: Omit<StaffAdvanceRow, 'employee' | 'counterpartyId' | 'settlement' | 'canWriteOff' | 'writeOffEntry'>[];
  totals: { loansNet: string; staffAdvances: string; net: string };
}

export type MovementPayload = {
  movementDate: string;
  effect: MovementEffect;
  method: MovementMethod;
  amount: string;
  description: string;
  otherAccountId?: string;
  reserveAccountId?: string;
};

// --- Calls -------------------------------------------------------------------------

export async function getLoanStats() {
  return (await apiClient.get<LoanStats>('/loans/stats')).data;
}

export async function listLoans(params: { businessUnitId?: string; counterpartyId?: string; status?: LoanStatus; interUnit?: 'true' | 'false' } = {}) {
  return (await apiClient.get<LoanRecord[]>('/loans', { params })).data;
}

export async function getLoan(id: string) {
  return (await apiClient.get<LoanDetail>(`/loans/${id}`)).data;
}

export async function createLoan(payload: {
  counterpartyId: string;
  businessUnitId: string;
  direction: LoanDirection;
  purpose: string;
  limit?: string;
  opening?: MovementPayload;
}) {
  return (await apiClient.post<LoanDetail>('/loans', payload)).data;
}

export async function updateLoan(id: string, payload: { purpose?: string; limit?: string | null }) {
  return (await apiClient.patch<LoanDetail>(`/loans/${id}`, payload)).data;
}

export async function reviewLoan(id: string, action: 'approve' | 'reject', note?: string) {
  return (await apiClient.post<LoanDetail>(`/loans/${id}/${action}`, { note })).data;
}

export async function closeLoan(id: string, action: 'close' | 'reopen') {
  return (await apiClient.post<LoanDetail>(`/loans/${id}/${action}`)).data;
}

export async function addMovement(loanId: string, payload: MovementPayload) {
  return (await apiClient.post<{ status: MovementStatus; loan: LoanDetail }>(`/loans/${loanId}/movements`, payload)).data;
}

export async function actOnMovement(id: string, action: 'approve' | 'reject' | 'withdraw' | 'reverse', note?: string) {
  return (await apiClient.post<LoanDetail>(`/loans/movements/${id}/${action}`, action === 'withdraw' ? undefined : { note })).data;
}

export async function getApprovals() {
  return (await apiClient.get<Approvals>('/loans/approvals')).data;
}

export async function listCounterparties() {
  return (await apiClient.get<CounterpartyRecord[]>('/loans/counterparties')).data;
}

export async function createCounterparty(payload: { kind: CounterpartyKind; name?: string; employeeId?: string; phone?: string; notes?: string }) {
  return (await apiClient.post<CounterpartyRecord>('/loans/counterparties', payload)).data;
}

export async function updateCounterparty(id: string, payload: { name?: string; phone?: string | null; notes?: string | null; isActive?: boolean }) {
  return (await apiClient.patch<CounterpartyRecord>(`/loans/counterparties/${id}`, payload)).data;
}

export async function getCounterpartyStatement(id: string) {
  return (await apiClient.get<CounterpartyStatement>(`/loans/counterparties/${id}`)).data;
}

export async function listInterUnit() {
  return (await apiClient.get<InterUnitPair[]>('/loans/inter-unit')).data;
}

export async function interUnitTransfer(payload: {
  fromUnitId: string;
  toUnitId: string;
  transferDate: string;
  amount: string;
  fromAccountId: string;
  toAccountId: string;
  reserveAccountId?: string;
  description: string;
}) {
  return (await apiClient.post<{ status: MovementStatus; loan: LoanDetail }>('/loans/inter-unit/transfers', payload)).data;
}

export async function listStaffAdvances(status?: StaffAdvanceStatus) {
  return (await apiClient.get<StaffAdvanceRow[]>('/loans/staff-advances', { params: status ? { status } : {} })).data;
}

export async function writeOffAdvance(id: string, reason: string) {
  return (await apiClient.post<StaffAdvanceRow>(`/loans/staff-advances/${id}/write-off`, { reason })).data;
}

export async function undoWriteOff(id: string) {
  return (await apiClient.post<StaffAdvanceRow>(`/loans/staff-advances/${id}/undo-write-off`)).data;
}

/** Positive → "they owe us", negative → "we owe them", from the unit's side. */
export function owedLabel(direction: LoanDirection, outstanding: string): { text: string; tone: 'owed' | 'owe' | 'clear' } {
  const negative = outstanding.startsWith('-');
  const zero = /^-?0(\.0+)?$/.test(outstanding);
  if (zero) return { text: 'Settled', tone: 'clear' };
  const theyOwe = (direction === 'RECEIVABLE') !== negative;
  return theyOwe ? { text: 'They owe us', tone: 'owed' } : { text: 'We owe them', tone: 'owe' };
}
