'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMyself } from '../lib/api/auth';
import { clearToken, getToken } from '../lib/api/client';

interface Me {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  permissions: string[];
}

export default function HomePage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      router.push('/login');
      return;
    }
    getMyself()
      .then(setMe)
      .catch(() => {
        clearToken();
        router.push('/login');
      })
      .finally(() => setLoading(false));
  }, [router]);

  function signOut() {
    clearToken();
    router.push('/login');
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-ink-soft text-sm">
        Loading…
      </div>
    );
  }

  if (!me) return null;

  return (
    <div className="min-h-screen bg-bg px-6 py-10">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <span className="text-xl font-extrabold text-ink">
            Multizoo Ledger
          </span>
          <button
            onClick={signOut}
            className="text-sm text-ink-soft hover:text-ink underline"
          >
            Sign out
          </button>
        </div>

        <div className="bg-surface border border-line rounded-xl shadow-sm p-6">
          <p className="text-[11px] font-bold uppercase tracking-wide text-accent mb-3">
            Module 1 — Identity &amp; Access
          </p>
          <h1 className="text-2xl font-extrabold text-ink mb-1">
            {me.fullName}
          </h1>
          <p className="text-sm text-ink-soft mb-6">{me.email}</p>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-ink-faint mb-2">
                Roles
              </p>
              <ul className="flex flex-col gap-1">
                {me.roles.map((role) => (
                  <li
                    key={role}
                    className="text-sm bg-accent-soft text-accent-ink rounded-md px-2.5 py-1 w-fit"
                  >
                    {role}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-ink-faint mb-2">
                Permissions ({me.permissions.length})
              </p>
              <ul className="flex flex-col gap-1">
                {me.permissions.map((p) => (
                  <li key={p} className="text-xs text-ink-soft">
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <p className="text-xs text-ink-faint mt-6">
          This is the Module 1 proof-of-life screen — the real dashboard
          arrives with Module 2 (Ledger foundation). What matters here is
          that login, JWT, role assignment, and claims-based permissions are
          resolving correctly end to end.
        </p>
      </div>
    </div>
  );
}
