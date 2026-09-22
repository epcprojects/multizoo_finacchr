'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
} from '@tanstack/react-table';
import { useUser } from '../../../components/layout/UserProvider';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import PageBanner from '../../../components/ui/PageBanner';
import { PlusIcon, EyeIcon, SearchIcon } from '../../../components/ui/icons';
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
  const [search, setSearch] = useState('');
  const [claimsRole, setClaimsRole] = useState<RoleRecord | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<string[]>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });

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

  const filteredRoles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return roles;
    return roles.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q),
    );
  }, [roles, search]);

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
      header: 'Role Name',
      cell: ({ row }) => (
        <span className="text-sm text-gray-800">{row.original.name}</span>
      ),
    },
    {
      accessorKey: 'description',
      header: 'Description',
      cell: ({ row }) => (
        <span className="text-sm text-gray-800">{row.original.description || '—'}</span>
      ),
    },
    {
      id: 'claims',
      header: 'Permissions',
      cell: ({ row }) => (
        <span className="text-sm text-gray-800">{row.original.roleClaims.length}</span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => (
        <div className="flex w-fit items-end justify-end gap-3">
          <button
            type="button"
            disabled={row.original.roleClaims.length === 0}
            onClick={() => setClaimsRole(row.original)}
            className="flex h-8.5 w-8.5 items-center justify-center rounded-lg border border-gray-200 text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={`View ${row.original.name} permissions`}
          >
            <EyeIcon />
          </button>
        </div>
      ),
    },
  ];

  const table = useReactTable({
    data: filteredRoles,
    columns,
    state: { pagination },
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const totalRows = filteredRoles.length;
  const startRow = totalRows === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1;
  const endRow = Math.min((pagination.pageIndex + 1) * pagination.pageSize, totalRows);

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:overflow-hidden xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <div className="shrink-0">
          <PageBanner imageSrc="/roles-icon.svg" imageAlt="Roles" title="Roles" />
        </div>

        <div className="flex h-auto min-h-0 flex-none flex-col gap-4 overflow-visible rounded-xl bg-white p-4 shadow-[0_0_35px_0_rgb(0_0_0/0.04)] md:p-5 xl:h-full xl:flex-1 xl:overflow-hidden">
          <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 md:max-w-100 md:min-w-80">
              <div className="flex items-center gap-2">
                <span className="shrink-0">
                  <SearchIcon fill="#374151" />
                </span>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search"
                  className="min-w-0 flex-1 bg-transparent text-base text-gray-900 outline-none placeholder:text-gray-400"
                />
              </div>
            </div>

            {canManage ? (
              <Button
                className="shrink-0 rounded-full"
                icon={<PlusIcon width="20" height="20" />}
                onClick={() => setCreateOpen(true)}
              >
                Add Role
              </Button>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-150 text-left">
                <thead className="bg-gray-50">
                  {table.getHeaderGroups().map((hg) => (
                    <tr key={hg.id}>
                      {hg.headers.map((header) => (
                        <th
                          key={header.id}
                          className="sticky top-0 z-10 border-b border-gray-200 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-900"
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
                      <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-gray-500">
                        Loading…
                      </td>
                    </tr>
                  ) : table.getRowModel().rows.length ? (
                    table.getRowModel().rows.map((row) => (
                      <tr key={row.id} className="border-b border-gray-200 last:border-0">
                        {row.getVisibleCells().map((cell) => (
                          <td key={cell.id} className="px-4 py-3">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-gray-500">
                        No roles found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-auto flex shrink-0 justify-between gap-3 border-t border-gray-200 bg-white px-4 py-3 sm:flex-col md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span className="hidden sm:inline-block">Showing per page</span>
                <select
                  value={pagination.pageSize}
                  onChange={(e) => table.setPageSize(Number(e.target.value))}
                  className="rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-gray-900 outline-none"
                >
                  {[10, 20, 30].map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>

              <span className="text-sm text-gray-600">
                {startRow}-{endRow} of {totalRows}
              </span>
            </div>
          </div>
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
            <li key={claim.id} className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-800">
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
            <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">
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
