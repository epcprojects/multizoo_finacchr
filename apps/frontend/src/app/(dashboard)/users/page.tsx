'use client';

import { useEffect, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import { usePageHeader } from '../../../components/layout/DashboardShell';
import { useUser } from '../../../components/layout/UserProvider';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import { listUsers, inviteUser, type UserRecord } from '../../../lib/api/users';
import { listRoles, type RoleRecord } from '../../../lib/api/roles';

function StatusPill({ user }: { user: UserRecord }) {
  if (!user.isInvitationAccepted) {
    return (
      <span className="rounded-full bg-warning-100 px-2.5 py-0.5 text-xs font-medium text-warning-800">
        Invited
      </span>
    );
  }
  return user.isActive ? (
    <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-ink">
      Active
    </span>
  ) : (
    <span className="rounded-full bg-error-100 px-2.5 py-0.5 text-xs font-medium text-danger">
      Inactive
    </span>
  );
}

const columns: ColumnDef<UserRecord>[] = [
  {
    accessorKey: 'fullName',
    header: 'Name',
    cell: ({ row }) => (
      <span className="text-sm font-medium text-ink">{row.original.fullName}</span>
    ),
  },
  {
    accessorKey: 'email',
    header: 'Email',
    cell: ({ row }) => <span className="text-sm text-ink-soft">{row.original.email}</span>,
  },
  {
    accessorKey: 'roles',
    header: 'Role',
    cell: ({ row }) => (
      <span className="text-sm text-ink-soft">{row.original.roles.join(', ') || '—'}</span>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    cell: ({ row }) => <StatusPill user={row.original} />,
  },
];

export default function UsersPage() {
  const { hasPermission } = useUser();
  const canInvite = hasPermission('users.invite');
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [roleId, setRoleId] = useState('');

  async function refresh() {
    setLoading(true);
    try {
      const [u, r] = await Promise.all([listUsers(), listRoles()]);
      setUsers(u);
      setRoles(r);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  usePageHeader(
    {
      title: 'Users',
      subtitle: 'Invite-only accounts — everyone who can sign in, and what role they hold.',
      action: canInvite ? (
        <Button icon={<PlusIcon />} onClick={() => setInviteOpen(true)}>
          Invite user
        </Button>
      ) : undefined,
    },
    [canInvite],
  );

  async function onInvite() {
    setFormError(null);
    if (!email || !fullName || !roleId) {
      setFormError('Fill in every field.');
      return;
    }
    setSubmitting(true);
    try {
      await inviteUser({ email, fullName, roleId });
      setInviteOpen(false);
      setEmail('');
      setFullName('');
      setRoleId('');
      await refresh();
    } catch (err) {
      setFormError(
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || 'Could not send the invite.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const table = useReactTable({
    data: users,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface">
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-150 text-left">
            <thead className="bg-surface-2">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((header) => (
                    <th
                      key={header.id}
                      className="sticky top-0 border-b border-line bg-surface-2 px-4 py-3 text-xs font-semibold text-ink"
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-ink-faint">
                    Loading…
                  </td>
                </tr>
              ) : table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="border-b border-line last:border-0">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-3">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-ink-faint">
                    No users yet — invite the first one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        isOpen={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite a user"
        subtitle="They'll receive an email with a 48-hour link to set their password."
        showFooter
        onConfirm={onInvite}
        confirmLabel={submitting ? 'Sending…' : 'Send invite'}
        confirmDisabled={submitting}
      >
        <div className="flex flex-col gap-4">
          {formError && (
            <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
              {formError}
            </p>
          )}
          <Input
            label="Full name"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
          <Input
            label="Email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Select
            label="Role"
            required
            placeholder="Choose a role"
            value={roleId}
            onChange={setRoleId}
            options={roles.map((r) => ({ label: r.name, value: r.id }))}
          />
        </div>
      </Modal>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
      <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
