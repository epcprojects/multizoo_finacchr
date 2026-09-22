import { SetMetadata } from '@nestjs/common';
import { Permission } from '@multizoo/types';

export const PERMISSION_KEY = 'permission';

export interface PermissionMetadata {
  permissions?: Permission[];
  roles?: string[];
}

/** Guard a route by permission claim and/or role name — see PermissionsGuard. */
export const RequirePermission = (options: PermissionMetadata) =>
  SetMetadata(PERMISSION_KEY, options);
