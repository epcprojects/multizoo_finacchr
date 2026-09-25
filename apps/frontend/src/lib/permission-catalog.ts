/**
 * Human-readable labels for @multizoo/types' Permission enum. Kept as a
 * plain local list rather than importing the backend enum, to avoid the
 * frontend build depending on cross-package TS resolution for one dropdown.
 */
export const PERMISSION_CATALOG = [
  { label: 'View consolidated P&L', value: 'pnl.view_consolidated' },
  { label: 'View own profit share', value: 'pnl.view_own_share' },
  { label: 'Enter transactions (own unit)', value: 'transactions.create_own_unit' },
  { label: 'Reconcile ledgers', value: 'ledger.reconcile' },
  { label: 'Mark attendance (own unit)', value: 'attendance.mark_own_unit' },
  { label: 'Approve leave (own unit)', value: 'leave.approve_own_unit' },
  { label: 'Raise disciplinary fine (own unit)', value: 'disciplinary.raise_own_unit' },
  { label: 'Approve disciplinary fine', value: 'disciplinary.approve' },
  { label: 'Manage employee records', value: 'employee.manage' },
  { label: 'Run payroll', value: 'payroll.run' },
  { label: 'Approve allocation & profit-share rules', value: 'rules.edit_allocation' },
  { label: 'Edit HR policy rules', value: 'rules.edit_hr_policy' },
  { label: 'Approve loans', value: 'loans.approve' },
  { label: 'Initiate loans', value: 'loans.initiate' },
  { label: 'Generate reports (all units)', value: 'reports.generate' },
  { label: 'Generate reports (own unit)', value: 'reports.generate_own_unit' },
  { label: 'Invite users', value: 'users.invite' },
  { label: 'Manage roles', value: 'roles.manage' },
  { label: 'View ledgers & balances', value: 'ledger.view' },
  { label: 'Access all business units', value: 'units.access_all' },
  { label: 'Add & edit business units', value: 'business_units.manage' },
  { label: 'Edit chart of accounts', value: 'accounts.manage' },
  { label: 'Reverse posted entries', value: 'transactions.reverse' },
  { label: 'Propose allocation rule changes (need approval)', value: 'rules.propose_allocation' },
  { label: 'Run the daily income allocation', value: 'allocation.run' },
  { label: 'View employee records & HR policy', value: 'employee.view' },
  { label: 'Manage utility bills & allocation', value: 'utilities.manage' },
];

const MODULE_LABELS: Record<string, string> = {
  pnl: 'P&L',
  transactions: 'Transactions',
  ledger: 'Ledger',
  attendance: 'Attendance',
  leave: 'Leave',
  disciplinary: 'Disciplinary',
  employee: 'Employees',
  payroll: 'Payroll',
  rules: 'Rules',
  loans: 'Loans',
  reports: 'Reports',
  users: 'Users',
  roles: 'Roles',
  units: 'Business Units',
  business_units: 'Business Units',
  accounts: 'Chart of Accounts',
  allocation: 'Income Allocation',
  utilities: 'Utilities',
};

export type PermissionModule = {
  module: string;
  label: string;
  permissions: { label: string; value: string }[];
};

/**
 * Same shape as EPCCRM's permission catalog response (`{module, label,
 * permissions}[]`) — grouped by the module prefix so the Add Role modal can
 * render the same collapsible-by-module checkbox tree.
 */
export const PERMISSION_MODULES: PermissionModule[] = Object.entries(
  PERMISSION_CATALOG.reduce<Record<string, { label: string; value: string }[]>>(
    (groups, item) => {
      const module = item.value.split('.')[0];
      (groups[module] ??= []).push(item);
      return groups;
    },
    {},
  ),
).map(([module, permissions]) => ({
  module,
  label: MODULE_LABELS[module] ?? module,
  permissions,
}));
