'use client';

import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import { usePathname, useRouter } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
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
} from '../ui/icons';

type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  anyPermissions?: string[];
};

const navigationItems: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: <DashboardIcon /> },
  {
    href: '/transactions',
    label: 'Entries',
    icon: <TransactionsIcon />,
    anyPermissions: ['ledger.view', 'transactions.create_own_unit'],
  },
  {
    href: '/accounts',
    label: 'Accounts',
    icon: <AccountsIcon />,
    anyPermissions: ['ledger.view'],
  },
  {
    href: '/allocation',
    label: 'Allocation',
    icon: <AllocationIcon />,
    anyPermissions: ['ledger.view'],
  },
  {
    href: '/business-units',
    label: 'Units',
    icon: <UnitsIcon />,
    anyPermissions: ['ledger.view', 'business_units.manage'],
  },
  {
    href: '/users',
    label: 'Users',
    icon: <UsersIcon />,
    anyPermissions: ['users.invite'],
  },
  {
    href: '/roles',
    label: 'Roles',
    icon: <RolesIcon />,
    anyPermissions: ['roles.manage', 'users.invite'],
  },
];

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

  const visibleNavItems = useMemo(
    () =>
      navigationItems.filter(
        (item) => !item.anyPermissions || hasAnyPermission(item.anyPermissions),
      ),
    [hasAnyPermission],
  );

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

        <nav className="flex flex-1 flex-col items-center gap-2 overflow-y-auto">
          {visibleNavItems.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <button
                key={item.href}
                onClick={() => {
                  setMobileOpen(false);
                  router.push(item.href);
                }}
                className="flex flex-col items-center gap-1"
              >
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-full transition [&>svg]:h-5 [&>svg]:w-5 ${
                    isActive
                      ? 'bg-accent text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-100 hover:text-accent'
                  }`}
                >
                  {item.icon}
                </span>
                <span className="text-[11px] text-gray-900">{item.label}</span>
              </button>
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
