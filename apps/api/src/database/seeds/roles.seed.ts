import { DataSource } from 'typeorm';
import { Permission, SeedRoleName } from '@multizoo/types';
import { Role } from '../../app/modules/roles/entities/role.entity';
import { RoleClaim } from '../../app/modules/roles/entities/role.claim.entity';

const P = Permission;

/**
 * Mirrors the Access & Roles table in the architecture plan (Part 10)
 * exactly. These are seed data, not a fixed enum — a Partner can create
 * additional roles at runtime through the Roles admin screen; this is only
 * what ships on day one.
 */
const ROLE_SEED: Record<SeedRoleName, { description: string; permissions: Permission[] }> = {
  [SeedRoleName.PARTNER]: {
    description:
      'Full financial visibility across all units; sole authority over allocation and profit-share rules and loan approvals.',
    permissions: [
      P.PNL_VIEW_CONSOLIDATED,
      P.PNL_VIEW_OWN_SHARE,
      P.RULES_EDIT_ALLOCATION,
      P.LOANS_APPROVE,
      P.REPORTS_GENERATE,
      P.USERS_INVITE,
      P.ROLES_MANAGE,
    ],
  },
  [SeedRoleName.ACCOUNTANT]: {
    description:
      'Day-to-day financial operations: ledger reconciliation, payroll, HR policy edits, and report generation across all units.',
    permissions: [
      P.PNL_VIEW_CONSOLIDATED,
      P.PNL_VIEW_OWN_SHARE,
      P.TRANSACTIONS_CREATE_OWN_UNIT,
      P.LEDGER_RECONCILE,
      P.DISCIPLINARY_APPROVE,
      P.EMPLOYEE_MANAGE,
      P.PAYROLL_RUN,
      P.RULES_EDIT_HR_POLICY,
      P.LOANS_INITIATE,
      P.REPORTS_GENERATE,
      P.USERS_INVITE,
    ],
  },
  [SeedRoleName.BRANCH_MANAGER]: {
    description:
      'Runs one business unit day to day: sales/expense entry, attendance, leave approval, and raising disciplinary fines for their own team.',
    permissions: [
      P.TRANSACTIONS_CREATE_OWN_UNIT,
      P.ATTENDANCE_MARK_OWN_UNIT,
      P.LEAVE_APPROVE_OWN_UNIT,
      P.DISCIPLINARY_RAISE_OWN_UNIT,
      P.REPORTS_GENERATE_OWN_UNIT,
    ],
  },
  [SeedRoleName.BRANCH_STAFF]: {
    description:
      'Cashier-level access: enters sales and expenses for their own unit only.',
    permissions: [P.TRANSACTIONS_CREATE_OWN_UNIT, P.REPORTS_GENERATE_OWN_UNIT],
  },
};

export async function seedRoles(dataSource: DataSource): Promise<void> {
  const roleRepo = dataSource.getRepository(Role);
  const claimRepo = dataSource.getRepository(RoleClaim);

  for (const [name, { description, permissions }] of Object.entries(
    ROLE_SEED,
  ) as [SeedRoleName, { description: string; permissions: Permission[] }][]) {
    let role = await roleRepo.findOne({
      where: { normalizedName: name.toUpperCase() },
    });

    if (!role) {
      role = await roleRepo.save(roleRepo.create({ name, description }));
      console.log(`Created role: ${name}`);
    } else {
      role.description = description;
      await roleRepo.save(role);
      console.log(`Role already exists, refreshed description: ${name}`);
    }

    await claimRepo.delete({ roleId: role.id });
    await claimRepo.save(
      permissions.map((permission) =>
        claimRepo.create({
          roleId: (role as Role).id,
          claimType: permission,
          claimValue: 'true',
        }),
      ),
    );
    console.log(`  -> ${permissions.length} permission claims set`);
  }
}
