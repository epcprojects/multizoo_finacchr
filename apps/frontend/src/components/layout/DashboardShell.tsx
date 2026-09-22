'use client';

import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useUser } from './UserProvider';

type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  anyPermissions?: string[];
};

const navigationItems: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: <DashboardIcon /> },
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

type HeaderConfig = { title: string; subtitle?: string; action?: ReactNode };
type HeaderContextValue = { setHeader: (config: HeaderConfig | null) => void };
const HeaderContext = createContext<HeaderContextValue | null>(null);

/** Called by a page to set the sticky header's title/subtitle/action. */
export function usePageHeader(config: HeaderConfig, deps: unknown[] = []) {
  const ctx = useContext(HeaderContext);
  if (!ctx) throw new Error('usePageHeader must be used within DashboardShell');
  // Set synchronously during render so the header never flashes empty.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useMemo(() => {
    ctx.setHeader(config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
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

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, hasAnyPermission, logout } = useUser();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [header, setHeader] = useState<HeaderConfig | null>(null);

  const visibleNavItems = useMemo(
    () =>
      navigationItems.filter(
        (item) => !item.anyPermissions || hasAnyPermission(item.anyPermissions),
      ),
    [hasAnyPermission],
  );

  if (loading || !user) {
    return (
      <div className="flex h-dvh items-center justify-center bg-surface-2 text-sm text-ink-soft">
        Loading…
      </div>
    );
  }

  return (
    <HeaderContext.Provider value={{ setHeader }}>
      <div className="flex h-dvh min-h-0 bg-surface-2 text-ink">
        {mobileOpen && (
          <button
            aria-label="Close navigation"
            className="fixed inset-0 z-30 bg-black/40 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}

        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-20 flex-col items-center gap-6 bg-surface-2 px-3 py-5 transition-transform duration-200 lg:translate-x-0 ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <button
            onClick={() => router.push('/dashboard')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-extrabold text-white"
            aria-label="Go to dashboard"
          >
            MZ
          </button>

          <nav className="flex flex-1 flex-col items-center gap-2 overflow-y-auto">
            {visibleNavItems.map((item) => {
              const isActive = pathname === item.href;
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
                        : 'bg-surface text-ink-soft hover:bg-accent-soft hover:text-accent'
                    }`}
                  >
                    {item.icon}
                  </span>
                  <span className="text-[11px] text-ink-soft">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <Menu as="div" className="relative">
            <MenuButton
              className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-sm font-semibold text-ink ring-1 ring-line"
              title={user.fullName}
            >
              {getInitials(user.fullName)}
            </MenuButton>
            <MenuItems
              anchor="top start"
              className="z-50 mb-3 w-56 origin-bottom-left rounded-xl bg-surface p-1 shadow-lg ring-1 ring-line outline-none"
            >
              <div className="px-3 py-2 text-xs text-ink-faint">
                <p className="truncate font-medium text-ink">{user.fullName}</p>
                <p className="truncate">{user.email}</p>
              </div>
              <div className="my-1 h-px bg-line" />
              <MenuItem>
                <button
                  onClick={logout}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-danger hover:bg-error-100"
                >
                  <LogoutIcon />
                  Sign out
                </button>
              </MenuItem>
            </MenuItems>
          </Menu>
        </aside>

        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden lg:pl-20">
          <header className="sticky top-0 z-20 border-b border-line bg-surface">
            <div className="flex items-center justify-between gap-4 px-4 py-4 sm:px-6">
              <div className="flex items-center gap-3">
                <button
                  aria-label="Open navigation"
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-line lg:hidden"
                  onClick={() => setMobileOpen(true)}
                >
                  <MenuIcon />
                </button>
                <div>
                  <h1 className="text-lg font-bold text-ink sm:text-xl">
                    {header?.title ?? ''}
                  </h1>
                  {header?.subtitle && (
                    <p className="text-xs text-ink-soft sm:text-sm">
                      {header.subtitle}
                    </p>
                  )}
                </div>
              </div>
              {header?.action}
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {children}
          </main>
        </div>
      </div>
    </HeaderContext.Provider>
  );
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function DashboardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13" y="3" width="8" height="5" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13" y="12" width="8" height="9" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="3" y="15" width="8" height="6" rx="2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="17" cy="8.5" r="2.4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M15 13.3c2.5.3 4.5 2.1 4.5 4.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function RolesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M12 3 4.5 6v6c0 4.5 3.2 7.7 7.5 9 4.3-1.3 7.5-4.5 7.5-9V6L12 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9 12.3l2.1 2.1L15.5 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M15.5 3.75H12A8.25 8.25 0 1 0 12 20.25h3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M10 12h11m0 0-3-3m3 3-3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
