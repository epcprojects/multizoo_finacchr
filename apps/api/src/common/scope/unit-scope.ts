import { ForbiddenException } from '@nestjs/common';
import { Permission, SystemRoles } from '@multizoo/types';
import type { AuthenticatedUser } from '../../app/modules/users/users.service';

/**
 * Which business units a user can see and post to. Partners and the
 * Accountant hold `units.access_all`; everyone else is limited to the units
 * assigned to them in user_business_units — that assignment is what makes
 * the "own unit" in `transactions.create_own_unit` enforceable.
 */
export function hasAllUnitAccess(user: AuthenticatedUser): boolean {
  return (
    user.roles.includes(SystemRoles.SUPER_ADMIN) ||
    user.permissions.includes(Permission.UNITS_ACCESS_ALL)
  );
}

/** `null` means every unit; otherwise the explicit list (possibly empty). */
export function visibleUnitIds(user: AuthenticatedUser): string[] | null {
  return hasAllUnitAccess(user) ? null : user.businessUnitIds;
}

export function canAccessUnit(user: AuthenticatedUser, unitId: string): boolean {
  return hasAllUnitAccess(user) || user.businessUnitIds.includes(unitId);
}

export function assertUnitAccess(user: AuthenticatedUser, unitId: string): void {
  if (!canAccessUnit(user, unitId)) {
    throw new ForbiddenException(
      'You do not have access to this business unit',
    );
  }
}

export function hasPermission(
  user: AuthenticatedUser,
  permission: Permission,
): boolean {
  return (
    user.roles.includes(SystemRoles.SUPER_ADMIN) ||
    user.permissions.includes(permission)
  );
}
