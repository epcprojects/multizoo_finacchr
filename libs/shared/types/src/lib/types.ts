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
}

/** Where an entry came from — later modules add PAYROLL, … */
export enum JournalEntrySource {
  MANUAL = 'MANUAL',
  SYSTEM = 'SYSTEM',
  IMPORT = 'IMPORT',
  ALLOCATION = 'ALLOCATION',
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
