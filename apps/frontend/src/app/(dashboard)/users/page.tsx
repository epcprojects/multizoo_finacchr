'use client';

import { useEffect, useMemo, useState } from 'react';
import { useUser } from '../../../components/layout/UserProvider';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import ConfirmModal from '../../../components/ui/ConfirmModal';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import PageBanner from '../../../components/ui/PageBanner';
import { PlusIcon, SearchIcon, EditIcon, TrashIcon } from '../../../components/ui/icons';
import {
  listUsers,
  inviteUser,
  updateUserRole,
  deleteUser,
  type UserRecord,
} from '../../../lib/api/users';
import { listRoles, type RoleRecord } from '../../../lib/api/roles';

type RoleTone = 'blue' | 'orange' | 'purple' | 'teal';

const TONE_CLASSES: Record<RoleTone, string> = {
  blue: 'border-[#B2DDFF] bg-[#F0F9FF] text-[#0BA5EC]',
  orange: 'border-[#FEC84B] bg-[#FFFAEB] text-[#F79009]',
  purple: 'border-[#E9D7FE] bg-[#F9F5FF] text-[#875BF7]',
  teal: 'border-[#99F6E4] bg-[#ECFDF3] text-[#14B8A6]',
};

/** Copied 1:1 from EPCCRM's users/page.tsx getRoleTone. */
function getRoleTone(roleName: string): RoleTone {
  const normalized = roleName.trim().toLowerCase();
  if (normalized.includes('admin')) return 'orange';
  if (normalized.includes('manager')) return 'blue';
  if (normalized.includes('staff')) return 'teal';
  return 'purple';
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

function AcceptedEmailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M1.5 4.5 8 8.75l6.5-4.25M2.5 3h11c.55 0 1 .45 1 1v8c0 .55-.45 1-1 1h-11c-.55 0-1-.45-1-1V4c0-.55.45-1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SentEmailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M2.5 3h11c.55 0 1 .45 1 1v8c0 .55-.45 1-1 1h-11c-.55 0-1-.45-1-1V4c0-.55.45-1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M2 4.5 8 9l6-4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UserCard({
  user,
  canManage,
  onEdit,
  onDelete,
}: {
  user: UserRecord;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const accentColor = ['#0BA5EC', '#F79009', '#875BF7', '#14B8A6'][
    user.fullName.length % 4
  ];

  return (
    <article className="min-w-0 flex flex-col rounded-2xl border border-gray-200 bg-gray-50">
      <div className="flex flex-1 flex-col gap-4 rounded-t-2xl bg-gray-50 p-2.5">
        <div className="flex flex-row gap-4">
          <span
            className="flex h-10.5 w-10.5 shrink-0 items-center justify-center rounded-full bg-white text-sm font-semibold drop-shadow-sm"
            style={{ color: accentColor }}
          >
            {getInitials(user.fullName)}
          </span>
          <div className="flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-0.5">
              <p className="text-sm text-gray-950">{user.fullName}</p>
              <p className="text-xs text-gray-600">{user.email}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {user.roles.length ? (
                user.roles.map((role) => (
                  <span
                    key={role}
                    className={`rounded-full border px-2 py-1 text-xs font-medium ${TONE_CLASSES[getRoleTone(role)]}`}
                  >
                    {role}
                  </span>
                ))
              ) : (
                <span className="text-xs text-gray-500">No role assigned</span>
              )}
            </div>
          </div>
        </div>
        {!user.isInvitationAccepted ? (
          <div className="flex items-center gap-1.5 text-xs font-semibold text-warning-600">
            <SentEmailIcon />
            Invite Sent
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs font-semibold text-green-500">
            <AcceptedEmailIcon />
            Invite Accepted
          </div>
        )}
      </div>

      {canManage && (
        <div className="rounded-b-2xl bg-white p-2.5">
          <div className="flex gap-2">
            {user.isInvitationAccepted ? (
              <Button
                type="button"
                variant="secondary"
                onClick={onEdit}
                className="w-full"
                icon={<EditIcon />}
              >
                Edit User
              </Button>
            ) : null}
            <button
              type="button"
              onClick={onDelete}
              className="flex items-center justify-center rounded-lg border border-error-200 bg-error-100 px-2.5 py-2 transition"
              aria-label={`Delete ${user.fullName}`}
            >
              <TrashIcon />
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

export default function UsersPage() {
  const { hasPermission } = useUser();
  const canInvite = hasPermission('users.invite');
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  const [inviteOpen, setInviteOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [roleId, setRoleId] = useState('');

  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [editRoleId, setEditRoleId] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deletingUser, setDeletingUser] = useState<UserRecord | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

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

  const activeUsers = users.filter((u) => u.isActive).length;
  const pendingInvites = users.filter((u) => !u.isInvitationAccepted).length;

  const assignableRoles = useMemo(
    () => roles.filter((r) => r.normalizedName !== 'SUPER_ADMIN'),
    [roles],
  );

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      const matchesQuery =
        !q || u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
      const matchesRole = !roleFilter || u.roles.includes(roleFilter);
      return matchesQuery && matchesRole;
    });
  }, [users, search, roleFilter]);

  const hasSearchOrFilters = Boolean(search || roleFilter);

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

  function openEdit(u: UserRecord) {
    setEditingUser(u);
    setEditError(null);
    const current = roles.find((r) => u.roles.includes(r.name));
    setEditRoleId(current?.id ?? '');
  }

  async function onSaveRole() {
    if (!editingUser || !editRoleId) return;
    setEditSubmitting(true);
    setEditError(null);
    try {
      await updateUserRole(editingUser.id, editRoleId);
      setEditingUser(null);
      await refresh();
    } catch (err) {
      setEditError(
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || 'Could not update the role.',
      );
    } finally {
      setEditSubmitting(false);
    }
  }

  async function onDelete() {
    if (!deletingUser) return;
    setDeleteSubmitting(true);
    try {
      await deleteUser(deletingUser.id);
      setDeletingUser(null);
      await refresh();
    } finally {
      setDeleteSubmitting(false);
    }
  }

  return (
    <div className="relative z-100 h-full xl:h-dvh overflow-hidden xl:py-5 px-4 xl:px-0 pt-2 pb-0 xl:pr-5">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain scrollbar-hide xl:overflow-hidden xl:rounded-2xl xl:border xl:border-white xl:bg-white/40 xl:p-3">
        <div className="shrink-0">
          <PageBanner
            imageSrc="/users-icon.svg"
            imageAlt="Users"
            title="Users"
            stats={[
              { title: 'Total Users', count: users.length, color: '#A78BFA' },
              { title: 'Active Users', count: activeUsers, color: '#34D399' },
              { title: 'Pending Invites', count: pendingInvites, color: '#F5A623' },
            ]}
          />
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

            <div className="flex flex-wrap items-center gap-3">
              <div className="w-full xl:w-55">
                <Select
                  placeholder="All Roles"
                  showSearch
                  value={roleFilter}
                  onChange={setRoleFilter}
                  options={assignableRoles.map((r) => ({ label: r.name, value: r.name }))}
                />
              </div>

              <Button
                variant="secondary"
                disabled={!hasSearchOrFilters}
                onClick={() => {
                  setSearch('');
                  setRoleFilter('');
                }}
              >
                Clear Filters
              </Button>

              {canInvite ? (
                <Button
                  className="shrink-0 rounded-full"
                  icon={<PlusIcon width="20" height="20" />}
                  onClick={() => setInviteOpen(true)}
                >
                  Add User
                </Button>
              ) : null}
            </div>
          </div>

          <div className="xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:overscroll-contain">
            {loading ? (
              <p className="px-1 py-8 text-center text-sm text-gray-500">Loading…</p>
            ) : filteredUsers.length ? (
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {filteredUsers.map((u) => (
                  <UserCard
                    key={u.id}
                    user={u}
                    canManage={canInvite}
                    onEdit={() => openEdit(u)}
                    onDelete={() => setDeletingUser(u)}
                  />
                ))}
              </div>
            ) : (
              <p className="px-1 py-8 text-center text-sm text-gray-500">
                No users found.
              </p>
            )}
          </div>
        </div>
      </div>

      <Modal
        isOpen={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Add User"
        subtitle="They'll receive an email with a 48-hour link to set their password."
        showFooter
        onConfirm={onInvite}
        confirmLabel={submitting ? 'Creating...' : 'Create User'}
        confirmDisabled={submitting}
      >
        <div className="flex flex-col gap-4">
          {formError && (
            <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">
              {formError}
            </p>
          )}
          <Input
            label="Full Name"
            required
            placeholder="Enter full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
          <Input
            label="Email"
            type="email"
            required
            placeholder="Enter email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Select
            label="Role"
            required
            showSearch
            placeholder="Choose a role"
            value={roleId}
            onChange={setRoleId}
            options={assignableRoles.map((r) => ({ label: r.name, value: r.id }))}
          />
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(editingUser)}
        onClose={() => setEditingUser(null)}
        title="Edit User"
        subtitle={editingUser?.fullName}
        showFooter
        onConfirm={onSaveRole}
        confirmLabel={editSubmitting ? 'Saving...' : 'Save Changes'}
        confirmDisabled={editSubmitting || !editRoleId}
      >
        <div className="flex flex-col gap-4">
          {editError && (
            <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">
              {editError}
            </p>
          )}
          <Select
            label="Role"
            required
            showSearch
            placeholder="Choose a role"
            value={editRoleId}
            onChange={setEditRoleId}
            options={assignableRoles.map((r) => ({ label: r.name, value: r.id }))}
          />
        </div>
      </Modal>

      <ConfirmModal
        isOpen={Boolean(deletingUser)}
        onClose={() => setDeletingUser(null)}
        onConfirm={onDelete}
        variant="danger"
        isSubmitting={deleteSubmitting}
        title="Delete Account?"
        message={
          <>
            Are you sure you want to Delete{' '}
            <span className="font-semibold">“{deletingUser?.fullName ?? 'this user'}”</span>? This
            action cannot be undone.
          </>
        }
        confirmLabel="Yes, Delete"
      />
    </div>
  );
}
