'use client';

import { useEffect, useState } from 'react';
import { useUser } from '../../../components/layout/UserProvider';
import { usePageHeader } from '../../../components/layout/DashboardShell';
import SummaryBanner from '../../../components/ui/SummaryBanner';
import StatCard from '../../../components/ui/StatCard';
import { listRoles, type RoleRecord } from '../../../lib/api/roles';
import { listUsers, type UserRecord } from '../../../lib/api/users';

const ROLE_COLORS: Record<string, string> = {
  Partner: '#54B08A',
  Accountant: '#8FD3B2',
  'Branch Manager': '#D4AE55',
  'Branch Staff': '#E8C0BA',
  SUPER_ADMIN: '#E38F82',
};

export default function DashboardPage() {
  const { user, hasAnyPermission } = useUser();
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const canViewRoles = hasAnyPermission(['roles.manage', 'users.invite']);
  const canViewUsers = hasAnyPermission(['users.invite']);

  usePageHeader({
    title: `Good day, ${user?.fullName ?? ''} 👋`,
    subtitle: "Here's the state of Identity & Access — Module 1.",
  });

  useEffect(() => {
    if (canViewRoles) void listRoles().then(setRoles).catch(() => undefined);
    if (canViewUsers) void listUsers().then(setUsers).catch(() => undefined);
  }, [canViewRoles, canViewUsers]);

  const activeUsers = users.filter((u) => u.isActive).length;
  const pendingInvites = users.filter((u) => !u.isInvitationAccepted).length;

  return (
    <div className="flex flex-col gap-6">
      <SummaryBanner
        title="Multizoo Ledger — Identity & Access"
        subtitle="Roles and permissions are dynamic — create a new one any time from the Roles page."
        stats={
          canViewUsers
            ? [
                { title: 'Active users', count: activeUsers, color: '#54B08A' },
                { title: 'Pending invites', count: pendingInvites, color: '#D4AE55' },
              ]
            : undefined
        }
      />

      {canViewRoles && roles.length > 0 && (
        <div>
          <p className="mb-3 text-sm font-semibold text-ink">
            Roles &amp; permission claims
          </p>
          <div
            className="rounded-2xl p-4 sm:p-5"
            style={{
              backgroundImage:
                'linear-gradient(115deg, #0F4A37 0%, #1B6E52 55%, #16201B 100%)',
            }}
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
              {roles.map((role) => (
                <StatCard
                  key={role.id}
                  title={role.name}
                  count={role.roleClaims.length}
                  color={ROLE_COLORS[role.name] ?? '#54B08A'}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
