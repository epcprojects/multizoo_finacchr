'use client';

import { useEffect, useState } from 'react';
import { useUser } from '../../../components/layout/UserProvider';
import StatCard from '../../../components/ui/StatCard';
import { listRoles, type RoleRecord } from '../../../lib/api/roles';
import { listUsers, type UserRecord } from '../../../lib/api/users';

function StatusPill({ user }: { user: UserRecord }) {
  if (!user.isInvitationAccepted) {
    return (
      <span className="whitespace-nowrap rounded-full bg-warning-100 px-2.5 py-0.5 text-xs font-medium text-warning-800">
        Invited
      </span>
    );
  }
  return user.isActive ? (
    <span className="whitespace-nowrap rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">
      Active
    </span>
  ) : (
    <span className="whitespace-nowrap rounded-full bg-error-100 px-2.5 py-0.5 text-xs font-medium text-danger">
      Inactive
    </span>
  );
}

export default function DashboardPage() {
  const { user, hasAnyPermission } = useUser();
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const canViewRoles = hasAnyPermission(['roles.manage', 'users.invite']);
  const canViewUsers = hasAnyPermission(['users.invite']);

  useEffect(() => {
    if (canViewRoles) void listRoles().then(setRoles).catch(() => undefined);
    if (canViewUsers) void listUsers().then(setUsers).catch(() => undefined);
  }, [canViewRoles, canViewUsers]);

  const activeUsers = users.filter((u) => u.isActive).length;
  const pendingInvites = users.filter((u) => !u.isInvitationAccepted).length;
  const inactiveUsers = users.filter(
    (u) => u.isInvitationAccepted && !u.isActive,
  ).length;

  const heroStats = [
    ...(canViewUsers
      ? [
          { key: 'total', label: 'Total users', count: users.length, color: '#A78BFA' },
          { key: 'active', label: 'Active users', count: activeUsers, color: '#34D399' },
          { key: 'pending', label: 'Pending invites', count: pendingInvites, color: '#F5A623' },
          { key: 'inactive', label: 'Inactive', count: inactiveUsers, color: '#F87171' },
        ]
      : []),
    ...(canViewRoles
      ? [{ key: 'roles', label: 'Roles', count: roles.length, color: '#818CF8' }]
      : []),
  ];

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:overflow-hidden xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <div className="shrink-0">
          <div
            className="flex w-full flex-col justify-between gap-2 rounded-[10px] xl:rounded-xl bg-[url('/dashboard-bg.jpg')] bg-cover bg-center bg-no-repeat p-4 sm:p-5 xl:gap-8.5 xl:p-7.5"
          >
            <div className="flex flex-col items-start gap-2 xl:flex-row xl:gap-6">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <p className="text-2xl text-white font-semibold sm:text-[32px]">
                  Good Day, {user?.fullName ?? ''} 👋
                </p>
                <p className="text-sm text-gray-100 sm:text-lg">
                  Here&apos;s the state of Identity &amp; Access across Multizoo
                  Ledger
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5 xl:grid-cols-3 2xl:grid-cols-5 xl:gap-5">
              {heroStats.map((stat) => (
                <StatCard key={stat.key} title={stat.label} count={stat.count} color={stat.color} />
              ))}
            </div>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
          {canViewRoles && (
            <div className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-white p-4 shadow-[0_0_35px_0_rgb(0_0_0/0.04)] md:p-5">
              <div className="mb-3 flex shrink-0 items-center gap-2.5">
                <p className="text-lg font-bold text-black">
                  Roles &amp; permission claims
                </p>
                <span className="flex min-h-7.5 min-w-7.5 items-center justify-center rounded-full bg-gray-100 px-2 py-1 text-sm text-gray-700">
                  {roles.length}
                </span>
              </div>
              <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-gray-200">
                <table className="w-full text-left">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2.5 text-xs font-semibold text-gray-900">
                        Role name
                      </th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-gray-900">
                        Description
                      </th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-900">
                        Permissions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {roles.length ? (
                      roles.map((role) => (
                        <tr key={role.id} className="border-b border-gray-200 last:border-0">
                          <td className="px-4 py-3 text-sm font-medium text-gray-800">
                            {role.name}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {role.description || '—'}
                          </td>
                          <td className="px-4 py-3 text-right text-sm text-gray-600">
                            {role.roleClaims.length}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={3} className="px-4 py-8 text-center text-sm text-gray-500">
                          No roles yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {canViewUsers && (
            <div className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-white p-4 shadow-[0_0_35px_0_rgb(0_0_0/0.04)] md:p-5">
              <p className="mb-3 shrink-0 text-lg font-bold text-black">
                Recent users
              </p>
              <ul className="min-h-0 flex-1 overflow-auto rounded-xl border border-gray-200">
                {users.length ? (
                  users.slice(0, 6).map((u) => (
                    <li
                      key={u.id}
                      className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 last:border-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-800">
                          {u.fullName}
                        </p>
                        <p className="truncate text-xs text-gray-600">{u.email}</p>
                      </div>
                      <StatusPill user={u} />
                    </li>
                  ))
                ) : (
                  <li className="px-4 py-8 text-center text-sm text-gray-500">
                    No users yet.
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
