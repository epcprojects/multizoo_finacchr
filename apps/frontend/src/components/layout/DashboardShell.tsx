'use client';

import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useUser } from './UserProvider';
import Logo from '../ui/Logo';
import {
  DashboardIcon,
  UsersIcon,
  RolesIcon,
  LogoutIcon,
  MenuIcon,
  TransactionsIcon,
  AccountsIcon,
  UnitsIcon,
  AllocationIcon,
  EmployeesIcon,
  AttendanceIcon,
  LeaveIcon,
  PayrollIcon,
  LoansIcon,
  UtilitiesIcon,
  CostCentreIcon,
  SalesIcon,
  CapexIcon,
  CampaignIcon,
  FinanceIcon,
  HrIcon,
  SettingsIcon,
  ChevronIcon,
} from '../ui/icons';

type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  anyPermissions?: string[];
};

type NavGroup = {
  key: string;
  label: string;
  icon: ReactNode;
  items: NavItem[];
};

type NavEntry = NavItem | NavGroup;

const isGroup = (e: NavEntry): e is NavGroup => 'items' in e;

/** Anyone with an HR duty sees the HR screens (their own units only). */
const HR_VIEWERS = [
  'employee.manage',
  'employee.view',
  'attendance.mark_own_unit',
  'leave.approve_own_unit',
  'disciplinary.raise_own_unit',
  'disciplinary.approve',
  'rules.edit_hr_policy',
  'payroll.run',
];

const navigation: NavEntry[] = [
  { href: '/dashboard', label: 'Dashboard', icon: <DashboardIcon /> },
  {
    key: 'finance',
    label: 'Finance',
    icon: <FinanceIcon />,
    items: [
      { href: '/transactions', label: 'Entries', icon: <TransactionsIcon />, anyPermissions: ['ledger.view', 'transactions.create_own_unit'] },
      {
        href: '/sales',
        label: 'Sales',
        icon: <SalesIcon />,
        anyPermissions: ['transactions.create_own_unit', 'ledger.view', 'pnl.view_consolidated', 'sales.manage'],
      },
      { href: '/accounts', label: 'Accounts', icon: <AccountsIcon />, anyPermissions: ['ledger.view'] },
      { href: '/allocation', label: 'Allocation', icon: <AllocationIcon />, anyPermissions: ['ledger.view'] },
      { href: '/loans', label: 'Loans', icon: <LoansIcon />, anyPermissions: ['loans.initiate', 'loans.approve'] },
      { href: '/utilities', label: 'Utilities', icon: <UtilitiesIcon />, anyPermissions: ['utilities.manage', 'pnl.view_consolidated'] },
      {
        href: '/cost-centres',
        label: 'Cost centres',
        icon: <CostCentreIcon />,
        anyPermissions: ['ledger.view', 'accounts.manage', 'rules.edit_allocation'],
      },
      { href: '/capex', label: 'Capex', icon: <CapexIcon />, anyPermissions: ['capex.manage', 'pnl.view_consolidated'] },
      { href: '/campaigns', label: 'Campaigns', icon: <CampaignIcon />, anyPermissions: ['capex.manage', 'pnl.view_consolidated'] },
    ],
  },
  {
    key: 'hr',
    label: 'HR',
    icon: <HrIcon />,
    items: [
      { href: '/employees', label: 'Employees', icon: <EmployeesIcon />, anyPermissions: HR_VIEWERS },
      { href: '/attendance', label: 'Attendance', icon: <AttendanceIcon />, anyPermissions: HR_VIEWERS },
      { href: '/leave', label: 'Leave', icon: <LeaveIcon />, anyPermissions: HR_VIEWERS },
      { href: '/payroll', label: 'Payroll', icon: <PayrollIcon />, anyPermissions: ['payroll.run', 'employee.view'] },
    ],
  },
  {
    key: 'settings',
    label: 'Settings',
    icon: <SettingsIcon />,
    items: [
      { href: '/business-units', label: 'Units', icon: <UnitsIcon />, anyPermissions: ['ledger.view', 'business_units.manage'] },
      { href: '/accounts/settings', label: 'Chart', icon: <AccountsIcon />, anyPermissions: ['accounts.manage'] },
      {
        href: '/employees/settings',
        label: 'HR setup',
        icon: <HrIcon />,
        anyPermissions: ['employee.manage', 'employee.view', 'rules.edit_hr_policy'],
      },
      {
        href: '/payroll/settings',
        label: 'Payroll setup',
        icon: <PayrollIcon />,
        anyPermissions: ['payroll.run', 'employee.view', 'rules.edit_hr_policy'],
      },
      { href: '/users', label: 'Users', icon: <UsersIcon />, anyPermissions: ['users.invite'] },
      { href: '/roles', label: 'Roles', icon: <RolesIcon />, anyPermissions: ['roles.manage', 'users.invite'] },
    ],
  },
];

/**
 * The nav item for a path: the longest matching href wins, so
 * /accounts/settings lights up "Chart", not "Accounts".
 */
function activeHref(pathname: string, items: NavItem[]): string | null {
  let best: string | null = null;
  for (const { href } of items) {
    if ((pathname === href || pathname.startsWith(`${href}/`)) && (!best || href.length > best.length)) best = href;
  }
  return best;
}

function getInitials(name: string) {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || 'U'
  );
}

/**
 * Copied 1:1 from EPCCRM's dashboard-shell.tsx — a floating icon rail on a
 * gray-200 shell (sidebar and page background share the same color), no
 * separate title header at all. Each page owns its own banner at the top
 * of its own content instead.
 */
export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, hasAnyPermission, logout } = useUser();
  const [mobileOpen, setMobileOpen] = useState(false);

  // A group with only one item the user can see collapses to that item — no one-item folders.
  const entries = useMemo<NavEntry[]>(() => {
    const allowed = (item: NavItem) => !item.anyPermissions || hasAnyPermission(item.anyPermissions);
    return navigation.flatMap((e): NavEntry[] => {
      if (!isGroup(e)) return allowed(e) ? [e] : [];
      const items = e.items.filter(allowed);
      if (!items.length) return [];
      return items.length === 1 ? [items[0]] : [{ ...e, items }];
    });
  }, [hasAnyPermission]);

  const current = useMemo(
    () => activeHref(pathname, entries.flatMap((e) => (isGroup(e) ? e.items : [e]))),
    [pathname, entries],
  );
  const currentGroupKey =
    entries.find((e): e is NavGroup => isGroup(e) && e.items.some((i) => i.href === current))?.key ?? null;

  // One group open at a time; navigating opens the group that holds the page.
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  useEffect(() => {
    if (currentGroupKey) setOpenGroup(currentGroupKey);
  }, [currentGroupKey]);

  function go(href: string) {
    setMobileOpen(false);
    router.push(href);
  }

  if (loading || !user) {
    return (
      <div className="flex h-dvh items-center justify-center bg-bg text-sm text-ink-soft">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-dvh min-h-0 bg-bg text-ink">
      {mobileOpen && (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-20 flex-col items-center gap-6 bg-bg px-3 py-5 transition-transform duration-200 lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <button
          onClick={() => router.push('/dashboard')}
          className="shrink-0 rounded-full bg-white"
          aria-label="Go to dashboard"
        >
          <Logo size={44} />
        </button>

        <nav className="flex w-full flex-1 flex-col items-center gap-2 overflow-y-auto scrollbar-hide">
          {entries.map((entry) => {
            if (!isGroup(entry)) {
              return <RailButton key={entry.href} item={entry} active={current === entry.href} onClick={() => go(entry.href)} />;
            }
            const open = openGroup === entry.key;
            const holdsActive = currentGroupKey === entry.key;
            return (
              <div key={entry.key} className="flex w-full flex-col items-center gap-1">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenGroup(open ? null : entry.key)}
                  className="flex flex-col items-center gap-1"
                >
                  <span
                    className={`flex h-10 w-10 items-center justify-center rounded-full transition [&>svg]:h-5 [&>svg]:w-5 ${
                      holdsActive && !open
                        ? 'bg-accent text-white'
                        : holdsActive
                          ? 'bg-white text-accent ring-2 ring-accent/40'
                          : 'bg-white text-gray-700 hover:bg-gray-100 hover:text-accent'
                    }`}
                  >
                    {entry.icon}
                  </span>
                  <span className="flex items-center gap-0.5 text-[11px] text-gray-900">
                    {entry.label}
                    <ChevronIcon open={open} />
                  </span>
                </button>
                {open && (
                  <div className="flex w-full flex-col items-center gap-1.5 rounded-2xl bg-white/70 py-2 ring-1 ring-gray-200/70">
                    {entry.items.map((item) => (
                      <RailButton key={item.href} item={item} active={current === item.href} small onClick={() => go(item.href)} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <Menu as="div" className="relative">
          <MenuButton
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-left outline-none ring-1 ring-gray-200 transition hover:bg-gray-50"
            title={user.fullName}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-linear-to-br from-slate-700 to-slate-950 text-sm font-semibold text-white">
              {getInitials(user.fullName)}
            </span>
          </MenuButton>
          <MenuItems
            anchor="top start"
            className="z-50 mb-3 w-56 origin-bottom-left rounded-xl bg-white p-1 ring-1 ring-gray-200 outline-none"
          >
            <div className="px-3 py-2 text-xs text-gray-500">
              <p className="truncate font-medium text-gray-900">{user.fullName}</p>
              <p className="truncate">{user.email}</p>
            </div>
            <div className="my-1 h-px bg-gray-200" />
            <MenuItem>
              <button
                onClick={logout}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-red-500 hover:bg-red-50"
              >
                <LogoutIcon />
                Sign out
              </button>
            </MenuItem>
          </MenuItems>
        </Menu>
      </aside>

      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden lg:pl-20">
        <button
          aria-label="Open navigation"
          className="m-4 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white lg:hidden"
          onClick={() => setMobileOpen(true)}
        >
          <MenuIcon />
        </button>

        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

function RailButton({ item, active, small, onClick }: { item: NavItem; active: boolean; small?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined} className="flex flex-col items-center gap-1">
      <span
        className={`flex items-center justify-center rounded-full transition ${
          small ? 'h-8 w-8 [&>svg]:h-4 [&>svg]:w-4' : 'h-10 w-10 [&>svg]:h-5 [&>svg]:w-5'
        } ${active ? 'bg-accent text-white' : 'bg-white text-gray-700 hover:bg-gray-100 hover:text-accent'}`}
      >
        {item.icon}
      </span>
      <span className={`${small ? 'text-[10px]' : 'text-[11px]'} ${active ? 'font-semibold text-accent' : 'text-gray-900'}`}>
        {item.label}
      </span>
    </button>
  );
}
