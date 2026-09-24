'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { getMyself } from '../../lib/api/auth';
import { clearToken, getToken } from '../../lib/api/client';

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  isInvitationAccepted: boolean;
  roles: string[];
  permissions: string[];
  businessUnitIds: string[];
}

type UserContextValue = {
  user: CurrentUser | null;
  loading: boolean;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
  logout: () => void;
  refetch: () => Promise<void>;
};

const UserContext = createContext<UserContextValue | null>(null);

/**
 * Lighter-weight than EPCCRM's Redux store, same job: resolve the current
 * user once, make roles/permissions available anywhere in the tree without
 * re-fetching. Module 1 doesn't need a full state-management library yet —
 * this is that decision made explicit, not an oversight.
 */
export function UserProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      router.replace('/login');
      return;
    }
    try {
      const me = await getMyself();
      setUser(me);
    } catch {
      clearToken();
      setUser(null);
      router.replace('/login');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, []);

  function logout() {
    clearToken();
    setUser(null);
    router.replace('/login');
  }

  function hasPermission(permission: string) {
    return Boolean(user?.permissions.includes(permission));
  }

  function hasAnyPermission(permissions: string[]) {
    if (!permissions.length) return true;
    return permissions.some((p) => user?.permissions.includes(p));
  }

  return (
    <UserContext.Provider
      value={{ user, loading, hasPermission, hasAnyPermission, logout, refetch: load }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error('useUser must be used within UserProvider');
  return ctx;
}
