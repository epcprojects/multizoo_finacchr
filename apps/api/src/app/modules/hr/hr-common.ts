import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Brackets, EntityManager, In } from 'typeorm';
import { HrPolicyStatus, Permission } from '@multizoo/types';
import type { AuthenticatedUser } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { assertUnitAccess, hasPermission } from '../../../common/scope/unit-scope';
import { Employee } from './entities/employee.entity';
import { Holiday } from './entities/org.entity';
import { HrPolicy } from './entities/leave.entity';
import type { IsoDate, RestCalendar } from './hr-math';

/**
 * Everyone with any HR duty can read the HR screens — for their own units
 * only, unless they hold units.access_all.
 */
export const HR_VIEWERS = [
  Permission.EMPLOYEE_MANAGE,
  Permission.EMPLOYEE_VIEW,
  Permission.ATTENDANCE_MARK_OWN_UNIT,
  Permission.LEAVE_APPROVE_OWN_UNIT,
  Permission.DISCIPLINARY_RAISE_OWN_UNIT,
  Permission.DISCIPLINARY_APPROVE,
  Permission.RULES_EDIT_HR_POLICY,
  Permission.PAYROLL_RUN,
];

/** Salaries and national ID numbers: HR, payroll and the partners — not Branch Managers. */
export function canSeePay(user: AuthenticatedUser): boolean {
  return [Permission.EMPLOYEE_MANAGE, Permission.EMPLOYEE_VIEW, Permission.PAYROLL_RUN].some((p) =>
    hasPermission(user, p),
  );
}

export async function loadEmployee(m: EntityManager, id: string, user: AuthenticatedUser): Promise<Employee> {
  const employee = await m.findOne(Employee, {
    where: { id },
    relations: { businessUnit: true, department: true, designation: true },
  });
  if (!employee) throw new NotFoundException('Employee not found');
  assertUnitAccess(user, employee.businessUnitId);
  return employee;
}

/** Nobody approves their own leave or their own fine. */
export function assertNotSelf(employee: Employee, user: AuthenticatedUser, what: string): void {
  if (employee.userId && employee.userId === user.id) {
    throw new ForbiddenException(`You can't approve ${what} for yourself — another approver has to.`);
  }
}

export function isEmployedOn(employee: Pick<Employee, 'joinDate' | 'exitDate'>, date: IsoDate): boolean {
  return employee.joinDate <= date && (!employee.exitDate || date <= employee.exitDate);
}

/** Holidays that apply to a unit (its own, plus group-wide) between two dates. */
export async function holidaysFor(
  m: EntityManager,
  unitIds: string[],
  from: IsoDate,
  to: IsoDate,
): Promise<Map<string, Set<IsoDate>>> {
  const rows = await m
    .createQueryBuilder(Holiday, 'h')
    .where('h.date BETWEEN :from AND :to', { from, to })
    .andWhere(
      new Brackets((qb) => {
        qb.where('h.businessUnitId IS NULL');
        if (unitIds.length) qb.orWhere('h.businessUnitId IN (:...unitIds)', { unitIds });
      }),
    )
    .getMany();
  const byUnit = new Map<string, Set<IsoDate>>();
  for (const unitId of unitIds) {
    byUnit.set(
      unitId,
      new Set(rows.filter((h) => !h.businessUnitId || h.businessUnitId === unitId).map((h) => h.date)),
    );
  }
  return byUnit;
}

export async function holidayNames(m: EntityManager, unitId: string, from: IsoDate, to: IsoDate) {
  const rows = await m
    .createQueryBuilder(Holiday, 'h')
    .where('h.date BETWEEN :from AND :to', { from, to })
    .andWhere('(h.businessUnitId IS NULL OR h.businessUnitId = :unitId)', { unitId })
    .getMany();
  return new Map(rows.map((h) => [h.date, h.name]));
}

export function calendarFor(employee: Pick<Employee, 'weeklyOffDay'>, holidays: ReadonlySet<IsoDate>): RestCalendar {
  return { weeklyOffDay: employee.weeklyOffDay, holidays };
}

/** Policy versions in force, oldest first. */
export async function activePolicies(m: EntityManager): Promise<HrPolicy[]> {
  return m.find(HrPolicy, {
    where: { status: HrPolicyStatus.ACTIVE },
    relations: { leaveRules: true },
    order: { effectiveFrom: 'ASC', version: 'ASC' },
  });
}

export function policyOn(policies: HrPolicy[], date: IsoDate): HrPolicy | null {
  let found: HrPolicy | null = null;
  for (const p of policies) if (p.effectiveFrom <= date) found = p;
  return found;
}

export async function userNames(m: EntityManager, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean) as string[])];
  if (!unique.length) return new Map();
  const users = await m.find(User, { where: { id: In(unique) }, withDeleted: true });
  return new Map(users.map((u) => [u.id, u.fullName]));
}

/** Serialises changes to one employee's days (attendance, leave) across requests. */
export async function lockEmployees(m: EntityManager, employeeIds: string[]): Promise<void> {
  for (const id of [...new Set(employeeIds)].sort()) {
    await m.query(`SELECT pg_advisory_xact_lock(hashtext('hr-employee:' || $1))`, [id]);
  }
}
