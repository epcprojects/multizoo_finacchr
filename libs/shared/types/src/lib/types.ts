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
}
