import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SystemRoles } from '@multizoo/types';
import {
  PERMISSION_KEY,
  PermissionMetadata,
} from '../decorators/permissions.decorator';

/**
 * Checks a route's @RequirePermission() metadata against the resolved
 * user's roles[]/permissions[] (attached by UsersService.findById via the
 * user_roles → role_claims join). SUPER_ADMIN bypasses everything — see the
 * enum's doc comment for why that's a build-time escape hatch, not a
 * business role.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionMetadata>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) return false;

    if (user.roles?.includes(SystemRoles.SUPER_ADMIN)) return true;

    const userPermissions: string[] = user.permissions || [];
    const userRoles: string[] = user.roles || [];

    if (required.roles?.length) {
      const hasRole = required.roles.some((role) => userRoles.includes(role));
      if (!hasRole) throw new ForbiddenException('Insufficient role');
    }

    if (required.permissions?.length) {
      const hasPermission = required.permissions.some((permission) =>
        userPermissions.includes(permission),
      );
      if (!hasPermission) {
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    return true;
  }
}
