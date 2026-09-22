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
import { listRoles, createRole, type RoleRecord } from '../../../lib/api/roles';
import { PERMISSION_CATALOG } from '../../../lib/permission-catalog';

function labelFor(value: string) {
  return PERMISSION_CATALOG.find((p) => p.value === value)?.label ?? value;
}

export default function RolesPage() {
  const { hasPermission } = useUser();
  const canManage = hasPermission('roles.manage');
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [claimsRole, setClaimsRole] = useState<RoleRecord | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<string[]>([]);

  async function refresh() {
    setLoading(true);
    try {
      setRoles(await listRoles());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  usePageHeader(
    {
      title: 'Roles',
      subtitle: 'Dynamic roles with claims-based permissions — create a new one any time.',
      action: canManage ? (
        <Button icon={<PlusIcon />} onClick={() => setCreateOpen(true)}>
          Add role
        </Button>
      ) : undefined,
    },
    [canManage],
  );

  async function onCreate() {
    setFormError(null);
    if (!name || permissions.length === 0) {
      setFormError('Give the role a name and at least one permission.');
      return;
    }
    setSubmitting(true);
    try {
      await createRole({ name, description: description || undefined, permissions });
      setCreateOpen(false);
      setName('');
      setDescription('');
      setPermissions([]);
      await refresh();
    } catch (err) {
      setFormError(
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || 'Could not create the role.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const columns: ColumnDef<RoleRecord>[] = [
    {
      accessorKey: 'name',
      header: 'Role name',
      cell: ({ row }) => (
        <span className="text-sm font-medium text-ink">{row.original.name}</span>
      ),
    },
    {
      accessorKey: 'description',
      header: 'Description',
      cell: ({ row }) => (
        <span className="text-sm text-ink-soft">{row.original.description || '—'}</span>
      ),
    },
    {
      id: 'claims',
      header: 'Permissions',
      cell: ({ row }) => (
        <span className="text-sm text-ink-soft">{row.original.roleClaims.length}</span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => (
        <button
          type="button"
          disabled={row.original.roleClaims.length === 0}
          onClick={() => setClaimsRole(row.original)}
          className="flex h-8.5 w-8.5 items-center justify-center rounded-lg border border-line text-ink-soft transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={`View ${row.original.name} permissions`}
        >
          <EyeIcon />
        </button>
      ),
    },
  ];

  const table = useReactTable({
    data: roles,
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
                    No roles yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        isOpen={Boolean(claimsRole)}
        onClose={() => setClaimsRole(null)}
        title={`${claimsRole?.name ?? ''} — permissions`}
        subtitle={`${claimsRole?.roleClaims.length ?? 0} claims`}
      >
        <ul className="flex flex-col gap-1.5">
          {claimsRole?.roleClaims.map((claim) => (
            <li
              key={claim.id}
              className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink"
            >
              {labelFor(claim.claimType)}
            </li>
          ))}
        </ul>
      </Modal>

      <Modal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add role"
        subtitle="Dynamic — this creates a real role with its own permission claims."
        showFooter
        onConfirm={onCreate}
        confirmLabel={submitting ? 'Creating…' : 'Create role'}
        confirmDisabled={submitting}
      >
        <div className="flex flex-col gap-4">
          {formError && (
            <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
              {formError}
            </p>
          )}
          <Input label="Role name" required value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Select
            label="Permissions"
            required
            isMulti
            showSearch
            placeholder="Choose permissions"
            value={permissions}
            onChange={setPermissions}
            options={PERMISSION_CATALOG}
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

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
      <path
        d="M1 10s3-6 9-6 9 6 9 6-3 6-9 6-9-6-9-6Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
