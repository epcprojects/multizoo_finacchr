import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { Permission, SystemRoles } from '@multizoo/types';
import { Role } from '../../app/modules/roles/entities/role.entity';
import { RoleClaim } from '../../app/modules/roles/entities/role.claim.entity';
import { User } from '../../app/modules/users/entities/user.entity';
import { UserRole } from '../../app/modules/users/entities/user.roles.entity';

/**
 * The build-time escape hatch documented on SystemRoles.SUPER_ADMIN — and
 * the answer to the bootstrap problem every invite-only auth system has:
 * the very first user can't be invited, because nobody with USERS_INVITE
 * exists yet. Without this, standing up a fresh environment means reaching
 * for raw SQL (which is exactly what Module 1's own verification had to do
 * before this existed).
 *
 * PermissionsGuard already short-circuits on `roles.includes('SUPER_ADMIN')`
 * — the role name has to be that exact string for the bypass to fire. This
 * role is ALSO given every Permission claim explicitly, so it stays fully
 * capable even if the bypass is ever removed from the guard in favour of
 * pure claims-checking.
 */
export async function seedSuperAdmin(dataSource: DataSource): Promise<void> {
  const roleRepo = dataSource.getRepository(Role);
  const claimRepo = dataSource.getRepository(RoleClaim);
  const userRepo = dataSource.getRepository(User);
  const userRoleRepo = dataSource.getRepository(UserRole);

  // --- Role: SUPER_ADMIN, every permission ---
  let role = await roleRepo.findOne({
    where: { normalizedName: SystemRoles.SUPER_ADMIN },
  });

  if (!role) {
    role = await roleRepo.save(
      roleRepo.create({
        name: SystemRoles.SUPER_ADMIN,
        description:
          'Build-time escape hatch for the dev/ops team — bypasses PermissionsGuard entirely (see SystemRoles doc comment). Not a business role; do not hand this out to a partner or accountant.',
      }),
    );
    console.log(`Created role: ${SystemRoles.SUPER_ADMIN}`);
  }

  const allPermissions = Object.values(Permission);
  await claimRepo.delete({ roleId: role.id });
  await claimRepo.save(
    allPermissions.map((permission) =>
      claimRepo.create({
        roleId: (role as Role).id,
        claimType: permission,
        claimValue: 'true',
      }),
    ),
  );
  console.log(`  -> ${allPermissions.length} permission claims set (all of them)`);

  // --- User: the default system account ---
  const email = process.env.SUPER_ADMIN_EMAIL || 'superadmin@multizoo.local';
  const existing = await userRepo.findOne({
    where: { normalizedEmail: email.toUpperCase() },
  });

  if (existing) {
    // Self-healing: make sure the role is (still) attached, but never touch
    // an existing password — re-running the seed must not lock anyone out
    // or silently rotate a credential someone is already relying on.
    const hasRole = await userRoleRepo.findOne({
      where: { userId: existing.id, roleId: role.id },
    });
    if (!hasRole) {
      await userRoleRepo.save(
        userRoleRepo.create({ userId: existing.id, roleId: role.id }),
      );
      console.log(`Re-attached ${SystemRoles.SUPER_ADMIN} role to existing user: ${email}`);
    } else {
      console.log(`Super admin user already exists and is correctly configured: ${email}`);
    }
    return;
  }

  const isProduction = process.env.NODE_ENV === 'production';
  let password = process.env.SUPER_ADMIN_PASSWORD;
  let generated = false;

  if (!password) {
    if (isProduction) {
      throw new Error(
        'SUPER_ADMIN_PASSWORD must be set explicitly before seeding a production environment — refusing to auto-generate one there.',
      );
    }
    password = randomBytes(12).toString('base64url');
    generated = true;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await userRepo.save(
    userRepo.create({
      email,
      fullName: 'Super Admin',
      passwordHash,
      isActive: true,
      isInvitationAccepted: true, // bootstrap account — skips the invite flow entirely
    }),
  );

  await userRoleRepo.save(userRoleRepo.create({ userId: user.id, roleId: role.id }));

  console.log(`Created super admin user: ${email}`);
  if (generated) {
    console.log('');
    console.log('  ==========================================================');
    console.log('  SUPER ADMIN CREDENTIALS — shown once, not stored anywhere:');
    console.log(`    email:    ${email}`);
    console.log(`    password: ${password}`);
    console.log('  Log in once, then use this account only to invite the');
    console.log('  first real Partner — it should not be used day to day.');
    console.log('  ==========================================================');
    console.log('');
  } else {
    console.log('  (password taken from SUPER_ADMIN_PASSWORD)');
  }
}
