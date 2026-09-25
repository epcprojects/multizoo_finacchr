/**
 * System-level roles. SUPER_ADMIN is a build-time escape hatch (bypasses the
 * PermissionsGuard entirely) — it is not one of the four seeded business
 * roles below and should only ever be held by the dev/ops team.
 *
 * The four business roles are SEED DATA, not a fixed enum businesses must
 * live with — see Roles module. This union exists only so the guard can
 * special-case SUPER_ADMIN; everything else resolves through claims.
 */
export enum SystemRoles {
  SUPER_ADMIN = 'SUPER_ADMIN',
}

/** The default roles seeded on first run — see database/seeds/roles.seed.ts. */
export enum SeedRoleName {
  PARTNER = 'Partner',
  ACCOUNTANT = 'Accountant',
  BRANCH_MANAGER = 'Branch Manager',
  BRANCH_STAFF = 'Branch Staff',
}

/**
 * Permission claim keys. Each maps to one row of the Access & Roles table in
 * the architecture plan (Part 10). Stored as RoleClaim.claimType with
 * claimValue 'true' — see roles.seed.ts for which seeded role gets which.
 */
export enum Permission {
  PNL_VIEW_CONSOLIDATED = 'pnl.view_consolidated',
  PNL_VIEW_OWN_SHARE = 'pnl.view_own_share',
  TRANSACTIONS_CREATE_OWN_UNIT = 'transactions.create_own_unit',
  LEDGER_RECONCILE = 'ledger.reconcile',
  ATTENDANCE_MARK_OWN_UNIT = 'attendance.mark_own_unit',
  LEAVE_APPROVE_OWN_UNIT = 'leave.approve_own_unit',
  DISCIPLINARY_RAISE_OWN_UNIT = 'disciplinary.raise_own_unit',
  DISCIPLINARY_APPROVE = 'disciplinary.approve',
  EMPLOYEE_MANAGE = 'employee.manage',
  PAYROLL_RUN = 'payroll.run',
  RULES_EDIT_ALLOCATION = 'rules.edit_allocation',
  RULES_EDIT_HR_POLICY = 'rules.edit_hr_policy',
  LOANS_APPROVE = 'loans.approve',
  LOANS_INITIATE = 'loans.initiate',
  REPORTS_GENERATE = 'reports.generate',
  REPORTS_GENERATE_OWN_UNIT = 'reports.generate_own_unit',
  USERS_INVITE = 'users.invite',
  ROLES_MANAGE = 'roles.manage',
  // Module 2 — Ledger foundation
  LEDGER_VIEW = 'ledger.view',
  UNITS_ACCESS_ALL = 'units.access_all',
  BUSINESS_UNITS_MANAGE = 'business_units.manage',
  ACCOUNTS_MANAGE = 'accounts.manage',
  TRANSACTIONS_REVERSE = 'transactions.reverse',
  // Module 3 — Income allocation engine
  /** Draft and submit allocation / profit-share rule changes (they wait for approval). */
  RULES_PROPOSE_ALLOCATION = 'rules.propose_allocation',
  /** Post the day's allocation (the waterfall) for a unit. */
  ALLOCATION_RUN = 'allocation.run',
  // Module 4 — Employees, attendance & leave
  /** See the employee master, HR policy and registers without changing them (Partner: "view only"). */
  EMPLOYEE_VIEW = 'employee.view',
  // Module 6 — Loans, utilities & cost centres
  /** Set up utility connections, enter bills and post their allocation. */
  UTILITIES_MANAGE = 'utilities.manage',
}

// ---------------------------------------------------------------------------
// Ledger (Module 2)
// ---------------------------------------------------------------------------

/**
 * Keys of the business-unit types seeded on day one. Types are DATA (the
 * business_unit_types table) — a Partner or Accountant adds more from the
 * type dropdown — so nothing switches on these keys except the seed.
 */
export enum SystemBusinessUnitType {
  WILDLIFE_PARK = 'WILDLIFE_PARK',
  FOOD_BEVERAGE = 'FOOD_BEVERAGE',
  RETAIL = 'RETAIL',
  ENTERTAINMENT = 'ENTERTAINMENT',
  LIVESTOCK = 'LIVESTOCK',
  HOLDING = 'HOLDING',
}

/** The five buckets every account belongs to — see Follow the Rupee, Part 1. */
export enum AccountType {
  ASSET = 'ASSET',
  LIABILITY = 'LIABILITY',
  EQUITY = 'EQUITY',
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
}

/**
 * Keys of the account classes seeded on day one. Classes are DATA (the
 * account_classes table) — the Accountant can add more, rename these,
 * change their code ranges — so behaviour never switches on these keys;
 * it reads the class's flags (isLiquid, isReserve, …). The keys exist only
 * so seeds and the chart template can refer to a class.
 */
export enum SystemAccountClass {
  CASH = 'CASH',
  BANK = 'BANK',
  WALLET = 'WALLET',
  RESERVE = 'RESERVE',
  RECEIVABLE = 'RECEIVABLE',
  PAYABLE = 'PAYABLE',
  EQUITY = 'EQUITY',
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
}

/** Whether accounts of a class belong to a business unit or the whole group. */
export enum AccountClassUnitRule {
  /** Always owned by one unit (cash, bank, reserves). */
  UNIT_REQUIRED = 'UNIT_REQUIRED',
  /** Always group-wide; the unit is recorded on each journal line (income, expenses). */
  GROUP_ONLY = 'GROUP_ONLY',
  /** Chosen per account. */
  EITHER = 'EITHER',
}

/** Asset and expense balances grow with debits; the rest grow with credits. */
export const DEBIT_NORMAL_TYPES: readonly AccountType[] = [
  AccountType.ASSET,
  AccountType.EXPENSE,
];

export enum JournalEntryKind {
  MONEY_IN = 'MONEY_IN',
  MONEY_OUT = 'MONEY_OUT',
  TRANSFER = 'TRANSFER',
  OPENING_BALANCE = 'OPENING_BALANCE',
  GENERAL = 'GENERAL',
  REVERSAL = 'REVERSAL',
  /** The daily waterfall — posted only by the allocation engine. */
  ALLOCATION = 'ALLOCATION',
  /** Moving an earmark from one reserve to another (e.g. Capital → Utilities). */
  RESERVE_TRANSFER = 'RESERVE_TRANSFER',
  /** Cash a partner takes against their own equity. */
  PARTNER_DRAWING = 'PARTNER_DRAWING',
  /** A month's salaries owed (payroll run or settlement) — posted only by payroll. */
  PAYROLL = 'PAYROLL',
  /** A loan movement that isn't a plain cash in / out (paid on our behalf, set off, charged). */
  LOAN = 'LOAN',
}

/** Where an entry came from. */
export enum JournalEntrySource {
  MANUAL = 'MANUAL',
  SYSTEM = 'SYSTEM',
  IMPORT = 'IMPORT',
  ALLOCATION = 'ALLOCATION',
  /** Payroll runs, salary advances and settlements — undone from the Payroll screens only. */
  PAYROLL = 'PAYROLL',
  /** Loan and inter-unit movements — undone from the Loans screens only. */
  LOANS = 'LOANS',
  /** A utility bill's allocation — undone by unposting the bill. */
  UTILITIES = 'UTILITIES',
}

// ---------------------------------------------------------------------------
// Income allocation (Module 3)
// ---------------------------------------------------------------------------

/**
 * A rule version's life: drafted → submitted → approved (or rejected /
 * withdrawn). Approved versions are never edited; a change is a new version
 * with a later effective date. SUPERSEDED marks an approved version that was
 * replaced before it ever applied to a day (same effective date).
 */
export enum AllocationRuleStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  WITHDRAWN = 'WITHDRAWN',
  SUPERSEDED = 'SUPERSEDED',
}

/** How a tranche divides its money among its lines. */
export enum AllocationMethod {
  /** Each line is a % of the tranche; the lines total exactly 100%. */
  PERCENT = 'PERCENT',
  /** A ratio of parts (25∶40) — splits exactly, whatever the parts add up to. */
  PARTS = 'PARTS',
}

/** Where a waterfall line's money is earmarked. */
export enum AllocationTargetType {
  /** One of the unit's reserve buckets (Feed, Salary, …). */
  RESERVE = 'RESERVE',
  /** A partner's profit reserve in this unit. */
  PARTNER = 'PARTNER',
}

export enum AllocationRunStatus {
  POSTED = 'POSTED',
  REVERSED = 'REVERSED',
}

// ---------------------------------------------------------------------------
// Employees, attendance & leave (Module 4)
// ---------------------------------------------------------------------------

export enum EmploymentType {
  PERMANENT = 'PERMANENT',
  CONTRACT = 'CONTRACT',
  DAILY_WAGE = 'DAILY_WAGE',
  SEASONAL = 'SEASONAL',
}

/** How base salary is expressed: a monthly figure, or a daily rate (daily-wage staff). */
export enum PayBasis {
  MONTHLY = 'MONTHLY',
  DAILY = 'DAILY',
}

/** The Bonus Calculator's tiers — the commission pool is split by these (Module 5). */
export enum BonusTier {
  MANAGER = 'MANAGER',
  SUPERVISOR = 'SUPERVISOR',
  TICKETER = 'TICKETER',
  WORKER = 'WORKER',
  /** Not in the commission pool. */
  NONE = 'NONE',
}

export enum EmployeeStatus {
  ACTIVE = 'ACTIVE',
  /** An exit is recorded; they still appear on sheets up to their exit date. */
  EXITED = 'EXITED',
}

/**
 * One employee's day. On a working day: PRESENT / ABSENT / HALF_DAY /
 * LEAVE. On a rest day (their weekly off, or a holiday): OFF, or PRESENT /
 * HALF_DAY when they worked it — an extra day, which is what the salary
 * sheet's negative "Absent" figures are.
 */
export enum AttendanceStatus {
  PRESENT = 'PRESENT',
  ABSENT = 'ABSENT',
  HALF_DAY = 'HALF_DAY',
  LEAVE = 'LEAVE',
  OFF = 'OFF',
}

/** Where an attendance record came from — a device feed posts BIOMETRIC later. */
export enum AttendanceSource {
  MANUAL = 'MANUAL',
  BIOMETRIC = 'BIOMETRIC',
  /** Written by an approved leave request; changed only by cancelling it. */
  LEAVE_REQUEST = 'LEAVE_REQUEST',
}

export enum LeaveRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export enum DisciplinaryType {
  FINE = 'FINE',
  WARNING = 'WARNING',
}

export enum DisciplinaryStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  WITHDRAWN = 'WITHDRAWN',
}

/** An HR policy version is in force from its date, or was replaced before it started. */
export enum HrPolicyStatus {
  ACTIVE = 'ACTIVE',
  SUPERSEDED = 'SUPERSEDED',
}

// ---------------------------------------------------------------------------
// Payroll, incentives & settlement (Module 5)
// ---------------------------------------------------------------------------

/**
 * A unit's month of pay. A DRAFT is always recalculated from the live
 * records; FINALIZED freezes it (payslips snapshotted, cost posted to the
 * ledger, attendance locked); PAID once every payslip has been paid out.
 */
export enum PayrollRunStatus {
  DRAFT = 'DRAFT',
  FINALIZED = 'FINALIZED',
  PAID = 'PAID',
}

/** Something added to or taken off one person's pay for one run, by hand. */
export enum PayrollAdjustmentKind {
  /** Added to the sheet's "Bonus / Incentive" column — transport or food allowance, a one-off incentive. */
  ALLOWANCE = 'ALLOWANCE',
  /** The sheet's "Food Exp" column. */
  FOOD = 'FOOD',
  /** Any other deduction, with its reason. */
  DEDUCTION = 'DEDUCTION',
  /** Recover exactly this much of their advances this month (0 = skip a month). */
  ADVANCE_RECOVERY = 'ADVANCE_RECOVERY',
}

export enum SalaryAdvanceStatus {
  OUTSTANDING = 'OUTSTANDING',
  RECOVERED = 'RECOVERED',
  CANCELLED = 'CANCELLED',
  /** What a leaver's settlement couldn't cover, written off by a Partner (Module 6). */
  WRITTEN_OFF = 'WRITTEN_OFF',
}

/** How a bonus tier's share of the pool divides between the people in it. */
export enum BonusSplitMethod {
  /** Equally per head (the Bonus Calculator's ticketers: pool ÷ 3). */
  EQUAL = 'EQUAL',
  /** In proportion to a count per person — the supervisors' school trips. */
  BY_UNITS = 'BY_UNITS',
}

export enum BonusPoolStatus {
  DRAFT = 'DRAFT',
  APPROVED = 'APPROVED',
}

/** Full & final settlement: same life as a payroll run. */
export enum SettlementStatus {
  DRAFT = 'DRAFT',
  FINALIZED = 'FINALIZED',
  PAID = 'PAID',
}

/** A payroll policy version is in force from its date, or was replaced before it started. */
export enum PayrollPolicyStatus {
  ACTIVE = 'ACTIVE',
  SUPERSEDED = 'SUPERSEDED',
}

// ---------------------------------------------------------------------------
// Loans, utilities & cost centres (Module 6)
// ---------------------------------------------------------------------------

/** Who is on the other side of a loan account. */
export enum CounterpartyKind {
  PARTNER = 'PARTNER',
  EMPLOYEE = 'EMPLOYEE',
  /** Another business unit — inter-unit loans and recharges. */
  BUSINESS_UNIT = 'BUSINESS_UNIT',
  PERSON = 'PERSON',
  ORGANISATION = 'ORGANISATION',
}

/** Which way the money first went: we lent it (they owe us) or we borrowed it (we owe them). */
export enum LoanDirection {
  RECEIVABLE = 'RECEIVABLE',
  PAYABLE = 'PAYABLE',
}

/**
 * A loan account's life. A Partner approves a loan before anything posts
 * to it (roles table: "Approve loans & inter-unit transfers").
 */
export enum LoanStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  ACTIVE = 'ACTIVE',
  REJECTED = 'REJECTED',
  /** Settled to zero and closed; can be reopened. */
  CLOSED = 'CLOSED',
}

/** Whether a movement adds to what's owed, or pays some of it back. */
export enum LoanMovementEffect {
  INCREASE = 'INCREASE',
  DECREASE = 'DECREASE',
}

/** What the other side of a loan movement is. */
export enum LoanMovementMethod {
  /** Cash, bank or wallet of the unit. */
  CASH = 'CASH',
  /** No cash moves here: a bill they paid for us, or a charge to them (expense, asset or income account). */
  ON_ACCOUNT = 'ON_ACCOUNT',
  /** Set off against a partner's profit — debits their capital & current account. */
  PROFIT_SETOFF = 'PROFIT_SETOFF',
  /** A balance brought in from the workbooks at cutover. */
  OPENING = 'OPENING',
}

export enum LoanMovementStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  POSTED = 'POSTED',
  REJECTED = 'REJECTED',
  REVERSED = 'REVERSED',
}

/** How a utility bill is shared out. */
export enum UtilityAllocationMethod {
  /** The Zoo Green Meter: sub-meters charged by reading, the rest split by %. */
  SUB_METERED = 'SUB_METERED',
  /** The Admin Block bill: split by fixed weights (offices owned). */
  SHARED = 'SHARED',
}

export enum UtilityBillStatus {
  DRAFT = 'DRAFT',
  POSTED = 'POSTED',
}

/** Where spending tagged with a cost centre ends up. */
export enum CostCentreCharge {
  /** The paying unit's own P&L — the tag is for reporting. */
  UNIT = 'UNIT',
  /** A partner's capital & current account, out of their profit (the "342" media office). */
  PARTNER = 'PARTNER',
}
