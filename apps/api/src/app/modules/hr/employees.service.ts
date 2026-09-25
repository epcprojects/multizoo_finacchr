import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, LessThan, MoreThan, Not } from 'typeorm';
import {
  AttendanceStatus,
  EmployeeStatus,
  LeaveRequestStatus,
  Permission,
} from '@multizoo/types';
import { businessDate } from '@multizoo/utils';
import type { AuthenticatedUser } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { BusinessUnit } from '../business-units/entities/business-unit.entity';
import { Partner } from '../allocation/entities/partner.entity';
import { assertUnitAccess, hasPermission, visibleUnitIds } from '../../../common/scope/unit-scope';
import { Employee, SalaryRevision } from './entities/employee.entity';
import { Department, Designation } from './entities/org.entity';
import { AttendanceRecord, DisciplinaryRecord } from './entities/attendance.entity';
import { LeaveRequest } from './entities/leave.entity';
import { canSeePay, loadEmployee, lockEmployees, userNames } from './hr-common';
import {
  CreateEmployeeDto,
  ListEmployeesQueryDto,
  RecordExitDto,
  SalaryRevisionDto,
  UpdateEmployeeDto,
} from './dto/hr.dto';

const NIL = '00000000-0000-0000-0000-000000000000';

/**
 * The employee master (architecture plan Part 07 §01, module M14): who is
 * employed, where, as what, on what pay — and when they leave. Salary is a
 * dated history, never overwritten.
 */
@Injectable()
export class EmployeesService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  private async present(m: EntityManager, employees: Employee[], user: AuthenticatedUser) {
    if (!employees.length) return [];
    const ids = employees.map((e) => e.id);
    const today = businessDate();
    const showPay = canSeePay(user);
    const revisions = showPay
      ? await m.find(SalaryRevision, { where: { employeeId: In(ids) }, order: { effectiveFrom: 'ASC' } })
      : [];
    const userIds = employees.map((e) => e.userId).filter(Boolean) as string[];
    const users = userIds.length ? await m.find(User, { where: { id: In(userIds) }, withDeleted: true }) : [];
    const partners = await m.find(Partner, { where: { employeeId: In(ids) } });

    return employees.map((e) => {
      const own = revisions.filter((r) => r.employeeId === e.id);
      const current = [...own].reverse().find((r) => r.effectiveFrom <= today) ?? own[0] ?? null;
      const upcoming = own.find((r) => r.effectiveFrom > today && r !== current) ?? null;
      const partner = partners.find((p) => p.employeeId === e.id);
      return {
        id: e.id,
        employeeCode: e.employeeCode,
        fullName: e.fullName,
        fatherName: e.fatherName,
        cnic: showPay ? e.cnic : null,
        phone: e.phone,
        address: e.address,
        businessUnit: { id: e.businessUnit.id, code: e.businessUnit.code, name: e.businessUnit.name },
        department: e.department ? { id: e.department.id, name: e.department.name } : null,
        designation: { id: e.designation.id, name: e.designation.name, bonusTier: e.designation.bonusTier },
        bonusTier: e.bonusTier,
        effectiveBonusTier: e.bonusTier ?? e.designation.bonusTier,
        employmentType: e.employmentType,
        joinDate: e.joinDate,
        weeklyOffDay: e.weeklyOffDay,
        status: e.status,
        exitDate: e.exitDate,
        exitReason: e.exitReason,
        isLeaving: e.status === EmployeeStatus.EXITED && Boolean(e.exitDate && e.exitDate >= today),
        userId: e.userId,
        userName: users.find((u) => u.id === e.userId)?.fullName ?? null,
        partner: partner ? { id: partner.id, name: partner.name, shortName: partner.shortName } : null,
        notes: e.notes,
        salary: current
          ? {
              baseSalary: current.baseSalary,
              payBasis: current.payBasis,
              effectiveFrom: current.effectiveFrom,
              upcoming: upcoming
                ? { baseSalary: upcoming.baseSalary, payBasis: upcoming.payBasis, effectiveFrom: upcoming.effectiveFrom }
                : null,
            }
          : null,
        createdAt: e.createdAt,
      };
    });
  }

  async list(query: ListEmployeesQueryDto, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const scope = visibleUnitIds(user);
    if (query.businessUnitId) assertUnitAccess(user, query.businessUnitId);
    const qb = m
      .createQueryBuilder(Employee, 'e')
      .leftJoinAndSelect('e.businessUnit', 'bu')
      .leftJoinAndSelect('e.department', 'dep')
      .leftJoinAndSelect('e.designation', 'des')
      .orderBy('bu.code')
      .addOrderBy('e.fullName');
    if (query.businessUnitId) qb.andWhere('e.businessUnitId = :u', { u: query.businessUnitId });
    if (query.status) qb.andWhere('e.status = :s', { s: query.status });
    if (query.departmentId) qb.andWhere('e.departmentId = :d', { d: query.departmentId });
    if (query.designationId) qb.andWhere('e.designationId = :g', { g: query.designationId });
    if (query.search?.trim()) {
      qb.andWhere('(e.fullName ILIKE :q OR e.employeeCode ILIKE :q OR e.cnic ILIKE :q OR e.phone ILIKE :q)', {
        q: `%${query.search.trim()}%`,
      });
    }
    if (scope) qb.andWhere('e.businessUnitId IN (:...scope)', { scope: scope.length ? scope : [NIL] });
    return this.present(m, await qb.getMany(), user);
  }

  async findOne(id: string, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const employee = await loadEmployee(m, id, user);
    const [row] = await this.present(m, [employee], user);
    const names = await userNames(m, [employee.createdBy, employee.updatedBy]);
    return {
      ...row,
      createdByName: employee.createdBy ? names.get(employee.createdBy) ?? null : null,
      updatedAt: employee.updatedAt,
    };
  }

  async salaryHistory(id: string, user: AuthenticatedUser) {
    if (!canSeePay(user)) throw new ForbiddenException('Salaries are visible to HR, payroll and the partners.');
    const m = this.dataSource.manager;
    await loadEmployee(m, id, user);
    const rows = await m.find(SalaryRevision, { where: { employeeId: id }, order: { effectiveFrom: 'DESC' } });
    const names = await userNames(m, rows.map((r) => r.createdBy));
    const today = businessDate();
    const current = rows.find((r) => r.effectiveFrom <= today);
    return rows.map((r) => ({
      id: r.id,
      effectiveFrom: r.effectiveFrom,
      baseSalary: r.baseSalary,
      payBasis: r.payBasis,
      reason: r.reason,
      isCurrent: r === current,
      isUpcoming: r.effectiveFrom > today,
      createdAt: r.createdAt,
      createdByName: r.createdBy ? names.get(r.createdBy) ?? null : null,
    }));
  }

  // --- Validation helpers -------------------------------------------------------

  private async unitFor(m: EntityManager, id: string, user: AuthenticatedUser) {
    assertUnitAccess(user, id);
    const unit = await m.findOne(BusinessUnit, { where: { id } });
    if (!unit || !unit.isActive) throw new BadRequestException('That business unit is not active.');
    return unit;
  }

  private async departmentFor(m: EntityManager, id: string | null | undefined, unitId: string) {
    if (!id) return null;
    const dept = await m.findOne(Department, { where: { id } });
    if (!dept || !dept.isActive) throw new BadRequestException('That department is not active.');
    if (dept.businessUnitId !== unitId) throw new BadRequestException(`${dept.name} belongs to a different unit.`);
    return dept;
  }

  private async designationFor(m: EntityManager, id: string) {
    const d = await m.findOne(Designation, { where: { id } });
    if (!d || !d.isActive) throw new BadRequestException('That designation is not active.');
    return d;
  }

  private async assertCnicFree(m: EntityManager, cnic: string, exceptId?: string) {
    const clash = await m.findOne(Employee, { where: { cnic, ...(exceptId ? { id: Not(exceptId) } : {}) } });
    if (clash) throw new ConflictException(`CNIC ${cnic} already belongs to ${clash.fullName} (${clash.employeeCode}).`);
  }

  private async assertUserFree(m: EntityManager, userId: string, user: AuthenticatedUser, exceptId?: string) {
    if (!hasPermission(user, Permission.USERS_INVITE)) {
      throw new ForbiddenException('Linking a login needs permission to invite users.');
    }
    const u = await m.findOne(User, { where: { id: userId } });
    if (!u) throw new BadRequestException('That user does not exist.');
    const taken = await m.findOne(Employee, { where: { userId, ...(exceptId ? { id: Not(exceptId) } : {}) } });
    if (taken) throw new ConflictException(`${u.fullName}'s login is already linked to ${taken.fullName}.`);
  }

  private async nextCode(m: EntityManager): Promise<string> {
    await m.query(`SELECT pg_advisory_xact_lock(hashtext('hr-employee-code'))`);
    const [{ max }] = await m.query(
      `SELECT MAX(CAST(SUBSTRING("employeeCode" FROM 3) AS INTEGER)) AS max FROM employees WHERE "employeeCode" ~ '^E-[0-9]+$'`,
    );
    return `E-${String((max ?? 0) + 1).padStart(4, '0')}`;
  }

  // --- Create & update ------------------------------------------------------------

  async create(dto: CreateEmployeeDto, user: AuthenticatedUser) {
    const id = await this.dataSource.transaction(async (m) => {
      const unit = await this.unitFor(m, dto.businessUnitId, user);
      const dept = await this.departmentFor(m, dto.departmentId, unit.id);
      const designation = await this.designationFor(m, dto.designationId);
      const cnic = dto.cnic?.trim() || null;
      if (cnic) await this.assertCnicFree(m, cnic);
      if (dto.userId) await this.assertUserFree(m, dto.userId, user);

      const employee = await m.save(
        m.create(Employee, {
          employeeCode: await this.nextCode(m),
          fullName: dto.fullName.trim(),
          fatherName: dto.fatherName?.trim() || null,
          cnic,
          phone: dto.phone?.trim() || null,
          address: dto.address?.trim() || null,
          businessUnitId: unit.id,
          departmentId: dept?.id ?? null,
          designationId: designation.id,
          bonusTier: dto.bonusTier ?? null,
          employmentType: dto.employmentType,
          joinDate: dto.joinDate,
          weeklyOffDay: dto.weeklyOffDay ?? null,
          status: EmployeeStatus.ACTIVE,
          userId: dto.userId ?? null,
          notes: dto.notes?.trim() || null,
          createdBy: user.id,
        }),
      );
      await m.save(
        m.create(SalaryRevision, {
          employeeId: employee.id,
          effectiveFrom: dto.joinDate,
          baseSalary: dto.baseSalary,
          payBasis: dto.payBasis,
          reason: 'Starting salary',
          createdBy: user.id,
        }),
      );
      return employee.id;
    });
    return this.findOne(id, user);
  }

  async update(id: string, dto: UpdateEmployeeDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const employee = await loadEmployee(m, id, user);
      await lockEmployees(m, [id]);

      const unitId = dto.businessUnitId ?? employee.businessUnitId;
      if (unitId !== employee.businessUnitId) await this.unitFor(m, unitId, user);
      let departmentId = employee.departmentId;
      if (dto.departmentId !== undefined && (dto.departmentId !== employee.departmentId || unitId !== employee.businessUnitId)) {
        departmentId = (await this.departmentFor(m, dto.departmentId, unitId))?.id ?? null;
      } else if (unitId !== employee.businessUnitId) {
        departmentId = null; // a transfer drops the old unit's department
      }
      if (dto.designationId && dto.designationId !== employee.designationId) await this.designationFor(m, dto.designationId);

      if (dto.cnic !== undefined) {
        const cnic = dto.cnic?.trim() || null;
        if (cnic && cnic !== employee.cnic) await this.assertCnicFree(m, cnic, id);
        employee.cnic = cnic;
      }
      if (dto.userId !== undefined && dto.userId !== employee.userId) {
        if (dto.userId) await this.assertUserFree(m, dto.userId, user, id);
        else if (!hasPermission(user, Permission.USERS_INVITE)) {
          throw new ForbiddenException('Unlinking a login needs permission to invite users.');
        }
        employee.userId = dto.userId;
      }

      if (dto.joinDate && dto.joinDate !== employee.joinDate) {
        await this.moveJoinDate(m, employee, dto.joinDate);
      }

      await m.update(Employee, { id }, {
        fullName: dto.fullName?.trim() ?? employee.fullName,
        fatherName: dto.fatherName !== undefined ? dto.fatherName.trim() || null : employee.fatherName,
        cnic: employee.cnic,
        phone: dto.phone !== undefined ? dto.phone.trim() || null : employee.phone,
        address: dto.address !== undefined ? dto.address.trim() || null : employee.address,
        businessUnitId: unitId,
        departmentId,
        designationId: dto.designationId ?? employee.designationId,
        bonusTier: dto.bonusTier !== undefined ? dto.bonusTier : employee.bonusTier,
        employmentType: dto.employmentType ?? employee.employmentType,
        joinDate: employee.joinDate,
        weeklyOffDay: dto.weeklyOffDay !== undefined ? dto.weeklyOffDay : employee.weeklyOffDay,
        userId: employee.userId,
        notes: dto.notes !== undefined ? dto.notes.trim() || null : employee.notes,
        updatedBy: user.id,
      });
    });
    return this.findOne(id, user);
  }

  /** Correcting a join date is only safe while nothing is recorded before it. */
  private async moveJoinDate(m: EntityManager, employee: Employee, joinDate: string) {
    if (employee.exitDate && joinDate > employee.exitDate) {
      throw new BadRequestException('The join date can’t be after the exit date.');
    }
    if (joinDate > employee.joinDate) {
      const earlier = await m.count(AttendanceRecord, {
        where: { employeeId: employee.id, date: LessThan(joinDate) },
      });
      if (earlier) throw new BadRequestException(`Attendance is already marked before ${joinDate}.`);
    }
    const revisions = await m.find(SalaryRevision, { where: { employeeId: employee.id }, order: { effectiveFrom: 'ASC' } });
    if (revisions.length > 1 && revisions[1].effectiveFrom <= joinDate) {
      throw new BadRequestException(`A salary revision already starts on ${revisions[1].effectiveFrom}.`);
    }
    if (revisions[0]) {
      revisions[0].effectiveFrom = joinDate;
      await m.save(revisions[0]);
    }
    employee.joinDate = joinDate;
  }


  /**
   * A raise (or correction) from a date. A date already in force can't be
   * overwritten — that would silently change a month already paid — but
   * one that hasn't started yet can be replaced.
   */
  async addSalaryRevision(id: string, dto: SalaryRevisionDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const employee = await loadEmployee(m, id, user);
      if (dto.effectiveFrom < employee.joinDate) {
        throw new BadRequestException(`${employee.fullName} joined on ${employee.joinDate}.`);
      }
      if (employee.exitDate && dto.effectiveFrom > employee.exitDate) {
        throw new BadRequestException(`${employee.fullName}'s last working day is ${employee.exitDate}.`);
      }
      const existing = await m.findOne(SalaryRevision, { where: { employeeId: id, effectiveFrom: dto.effectiveFrom } });
      if (existing) {
        if (existing.effectiveFrom <= businessDate()) {
          throw new ConflictException(
            `A salary from ${dto.effectiveFrom} is already in force — record the change from a later date.`,
          );
        }
        existing.baseSalary = dto.baseSalary;
        existing.payBasis = dto.payBasis;
        existing.reason = dto.reason.trim();
        existing.updatedBy = user.id;
        await m.save(existing);
        return;
      }
      await m.save(
        m.create(SalaryRevision, {
          employeeId: id,
          effectiveFrom: dto.effectiveFrom,
          baseSalary: dto.baseSalary,
          payBasis: dto.payBasis,
          reason: dto.reason.trim(),
          createdBy: user.id,
        }),
      );
    });
    return this.salaryHistory(id, user);
  }

  // --- Exit -------------------------------------------------------------------------

  /**
   * Record that someone is leaving (or has left). They stay on the sheets
   * up to their last working day. Settlement is Module 5.
   */
  async recordExit(id: string, dto: RecordExitDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const employee = await loadEmployee(m, id, user);
      await lockEmployees(m, [id]);
      if (dto.exitDate < employee.joinDate) {
        throw new BadRequestException(`${employee.fullName} joined on ${employee.joinDate}.`);
      }
      const after = await m.find(AttendanceRecord, {
        where: { employeeId: id, date: MoreThan(dto.exitDate), status: Not(AttendanceStatus.LEAVE) },
        order: { date: 'ASC' },
        take: 1,
      });
      if (after.length) {
        throw new BadRequestException(`Attendance is marked on ${after[0].date}, after that exit date.`);
      }
      const leave = await m.findOne(LeaveRequest, {
        where: {
          employeeId: id,
          status: In([LeaveRequestStatus.PENDING, LeaveRequestStatus.APPROVED]),
          endDate: MoreThan(dto.exitDate),
        },
      });
      if (leave) {
        throw new BadRequestException(
          `There is ${leave.status === LeaveRequestStatus.PENDING ? 'a pending' : 'approved'} leave request running to ${leave.endDate}. Cancel it first.`,
        );
      }
      const salaryAfter = await m.findOne(SalaryRevision, { where: { employeeId: id, effectiveFrom: MoreThan(dto.exitDate) } });
      if (salaryAfter) {
        throw new BadRequestException(`A salary revision starts on ${salaryAfter.effectiveFrom}, after that exit date.`);
      }
      // A partner's profit share is independent of their employment — nothing to do there.
      await m.update(Employee, { id }, {
        status: EmployeeStatus.EXITED,
        exitDate: dto.exitDate,
        exitReason: dto.reason.trim(),
        updatedBy: user.id,
      });
    });
    return this.findOne(id, user);
  }

  async reinstate(id: string, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const employee = await loadEmployee(m, id, user);
    if (employee.status !== EmployeeStatus.EXITED) throw new ConflictException(`${employee.fullName} hasn't left.`);
    await m.update(Employee, { id }, { status: EmployeeStatus.ACTIVE, exitDate: null, exitReason: null, updatedBy: user.id });
    return this.findOne(id, user);
  }

  /** Banner figures for the Employees screen. */
  async stats(user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const scope = visibleUnitIds(user);
    const today = businessDate();
    const monthStart = `${today.slice(0, 8)}01`;
    const where = scope ? `AND "businessUnitId" = ANY($2)` : '';
    const params: unknown[] = [today];
    if (scope) params.push(scope.length ? scope : [NIL]);
    const [row] = await m.query(
      `SELECT
         COUNT(*) FILTER (WHERE "joinDate" <= $1 AND ("exitDate" IS NULL OR "exitDate" >= $1)) AS active,
         COUNT(*) FILTER (WHERE "joinDate" >= '${monthStart}' AND "joinDate" <= $1) AS joined,
         COUNT(*) FILTER (WHERE status = 'EXITED' AND "exitDate" >= $1) AS leaving
       FROM employees WHERE "deletedAt" IS NULL ${where}`,
      params,
    );
    const fines = await m
      .createQueryBuilder(DisciplinaryRecord, 'd')
      .where('d.status = :s', { s: 'PENDING_APPROVAL' })
      .andWhere(scope ? 'd.businessUnitId IN (:...scope)' : '1=1', { scope: scope?.length ? scope : [NIL] })
      .getCount();
    return {
      active: Number(row.active),
      joinedThisMonth: Number(row.joined),
      leaving: Number(row.leaving),
      pendingDisciplinary: fines,
    };
  }
}
