'use client';

import { useEffect, useState } from 'react';
import Modal, { ModalPosition } from '../ui/Modal';
import Input from '../ui/Input';
import { CheckedBoxIcon, UncheckedBoxIcon } from '../ui/icons';
import { PERMISSION_MODULES } from '../../lib/permission-catalog';

export type RoleFormValues = {
  name: string;
  description: string;
  permissions: string[];
};

type RoleFormModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (values: RoleFormValues) => Promise<void> | void;
  mode?: 'create' | 'edit';
  initialValues?: RoleFormValues;
  submitting?: boolean;
};

const EMPTY_VALUES: RoleFormValues = { name: '', description: '', permissions: [] };

/**
 * Copied 1:1 from EPCCRM's AddRoleModal — right-side slide-in panel with
 * permissions grouped into a collapsible-by-module checkbox tree, instead
 * of a flat multi-select dropdown.
 */
export default function RoleFormModal({
  isOpen,
  onClose,
  onConfirm,
  mode = 'create',
  initialValues,
  submitting = false,
}: RoleFormModalProps) {
  const [values, setValues] = useState<RoleFormValues>(initialValues ?? EMPTY_VALUES);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setValues(initialValues ?? EMPTY_VALUES);
      setError(null);
    }
  }, [isOpen, initialValues]);

  function toggleModule(modulePermissions: string[]) {
    const allSelected = modulePermissions.every((p) => values.permissions.includes(p));
    setValues((v) => ({
      ...v,
      permissions: allSelected
        ? v.permissions.filter((p) => !modulePermissions.includes(p))
        : Array.from(new Set([...v.permissions, ...modulePermissions])),
    }));
  }

  function togglePermission(permission: string) {
    setValues((v) => ({
      ...v,
      permissions: v.permissions.includes(permission)
        ? v.permissions.filter((p) => p !== permission)
        : [...v.permissions, permission],
    }));
  }

  async function handleConfirm() {
    setError(null);
    if (!values.name.trim()) {
      setError('Role name is required.');
      return;
    }
    if (!values.description.trim()) {
      setError('Description is required.');
      return;
    }
    if (values.permissions.length === 0) {
      setError('Select at least one permission.');
      return;
    }
    await onConfirm(values);
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mode === 'edit' ? 'Edit Role' : 'Add Role'}
      showFooter
      confirmLabel={
        submitting ? (mode === 'edit' ? 'Saving...' : 'Creating...') : mode === 'edit' ? 'Save Changes' : 'Create Role'
      }
      cancelLabel="Cancel"
      onConfirm={handleConfirm}
      confirmDisabled={submitting}
      outsideClickClose={false}
      position={ModalPosition.RIGHT}
      size="extraLarge"
    >
      <div className="space-y-4">
        {error && (
          <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}

        <Input
          label="Role Name"
          required
          placeholder="Enter role name"
          value={values.name}
          onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
        />

        <div>
          <label className="mb-1.5 block text-sm font-normal text-gray-800 md:text-base">
            Description <span className="text-red-500">*</span>
          </label>
          <textarea
            value={values.description}
            onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
            placeholder="Enter role description"
            rows={4}
            className="w-full rounded-lg border border-gray-200 bg-transparent px-3.5 py-2 text-sm font-medium text-gray-700 outline-none placeholder:text-gray-300 focus:border-gray-400 md:text-base"
          />
        </div>

        <div className="space-y-3">
          <p className="text-sm font-normal text-gray-800 md:text-base">
            Permissions <span className="text-red-500">*</span>
          </p>

          <div className="space-y-3">
            {PERMISSION_MODULES.map((catalogItem) => {
              const modulePermissionValues = catalogItem.permissions.map((p) => p.value);
              const selectedCount = modulePermissionValues.filter((p) =>
                values.permissions.includes(p),
              ).length;
              const someSelected = selectedCount > 0;

              return (
                <div key={catalogItem.module} className="overflow-hidden rounded-lg border border-gray-200">
                  <label className="flex cursor-pointer items-center gap-2 border-b border-b-gray-200 bg-gray-50 px-3.5 py-2">
                    <button
                      type="button"
                      onClick={() => toggleModule(modulePermissionValues)}
                      aria-label={`Toggle all ${catalogItem.label} permissions`}
                    >
                      {someSelected ? (
                        <CheckedBoxIcon width="18" height="18" />
                      ) : (
                        <UncheckedBoxIcon width="18" height="18" />
                      )}
                    </button>
                    <span className="select-none text-sm font-medium text-black">
                      {catalogItem.label}
                    </span>
                  </label>

                  <div className="flex flex-wrap gap-x-4 gap-y-3 bg-white px-3.5 py-3">
                    {catalogItem.permissions.map((permission) => (
                      <button
                        type="button"
                        key={permission.value}
                        onClick={() => togglePermission(permission.value)}
                        className="flex cursor-pointer items-center gap-2 text-sm text-black"
                      >
                        {values.permissions.includes(permission.value) ? (
                          <CheckedBoxIcon width="18" height="18" />
                        ) : (
                          <UncheckedBoxIcon width="18" height="18" />
                        )}
                        <span className="select-none">{permission.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}
