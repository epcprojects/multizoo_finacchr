import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { EmployeeStatus, EmploymentType, HrPolicyStatus, LeaveRequestStatus } from '@multizoo/types';
import { businessDate } from '@multizoo/utils';
import type { AuthenticatedUser } from '../users/users.service';
import { BusinessUnit } from '../business-units/entities/business-unit.entity';
import { visibleUnitIds } from '../../../common/scope/unit-scope';
import { Department, Designation, Holiday } from './entities/org.entity';
import { Employee } from './entities/employee.entity';
import { HrPolicy, HrPolicyLeaveRule, LeaveRequest, LeaveType } from './entities/leave.entity';
import { activePolicies, policyOn, userNames } from './hr-common';
import { addDays, fromHalves, toHalves } from './hr-math';
import {
  CreateDepartmentDto,
  CreateDesignationDto,
  CreateHolidayDto,
  CreateHrPolicyDto,
  CreateLeaveTypeDto,
  UpdateDepartmentDto,
  UpdateDesignationDto,
  UpdateLeaveTypeDto,
} from './dto/hr.dto';

/** Days are stored NUMERIC(5,1): "14.0" → "14". */
export function days(value: string | null): string | null {
  return value === null ? null : fromHalves(toHalves(value));
}

/**
 * The HR building blocks the Accountant sets up once and adjusts rarely:
 * departments, job titles (with their bonus tier), holidays, leave types,
 * and the versioned leave & attendance policy.
 */
@Injectable()
export class OrgService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // --- Departments ----------------------------------------------------------

  async listDepartments(user: AuthenticatedUser, businessUnitId?: string) {
    const scope = visibleUnitIds(user);
    const qb = this.dataSource.manager
      .createQueryBuilder(Department, 'd')
      .leftJoinAndSelect('d.businessUnit', 'bu')
      .orderBy('bu.code')
      .addOrderBy('d.name');
    if (businessUnitId) qb.andWhere('d.businessUnitId = :businessUnitId', { businessUnitId });
    if (scope) qb.andWhere('d.businessUnitId IN (:...scope)', { scope: scope.length ? scope : ['00000000-0000-0000-0000-000000000000'] });
    const rows = await qb.getMany();
    const counts = await this.headcounts('departmentId');
    return rows.map((d) => ({
      id: d.id,
      name: d.name,
      isActive: d.isActive,
      businessUnit: { id: d.businessUnit.id, code: d.businessUnit.code, name: d.businessUnit.name },
      headcount: counts.get(d.id) ?? 0,
    }));
  }

  private async headcounts(column: 'departmentId' | 'designationId'): Promise<Map<string, number>> {
    const rows: { id: string; n: string }[] = await this.dataSource.query(
      `SELECT "${column}" AS id, COUNT(*) AS n FROM employees
        WHERE "deletedAt" IS NULL AND status = $1 AND "${column}" IS NOT NULL GROUP BY "${column}"`,
      [EmployeeStatus.ACTIVE],
    );
    return new Map(rows.map((r) => [r.id, Number(r.n)]));
  }

  async createDepartment(dto: CreateDepartmentDto, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const unit = await m.findOne(BusinessUnit, { where: { id: dto.businessUnitId } });
    if (!unit) throw new BadRequestException('That business unit does not exist.');
    const name = dto.name.trim();
    await this.assertDepartmentFree(unit.id, name);
    const saved = await m.save(m.create(Department, { businessUnitId: unit.id, name, createdBy: user.id }));
    return (await this.listDepartments(user, unit.id)).find((d) => d.id === saved.id);
  }

  private async assertDepartmentFree(businessUnitId: string, name: string, exceptId?: string) {
    const clash = await this.dataSource.manager
      .createQueryBuilder(Department, 'd')
      .where('d.businessUnitId = :businessUnitId', { businessUnitId })
      .andWhere('UPPER(d.name) = UPPER(:name)', { name })
      .andWhere(exceptId ? 'd.id != :exceptId' : '1=1', { exceptId })
      .getOne();
    if (clash) throw new ConflictException(`This unit already has a department called ${clash.name}.`);
  }

  async updateDepartment(id: string, dto: UpdateDepartmentDto, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const dept = await m.findOne(Department, { where: { id } });
    if (!dept) throw new NotFoundException('Department not found');
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (name !== dept.name) await this.assertDepartmentFree(dept.businessUnitId, name, id);
      dept.name = name;
    }
    if (dto.isActive === false && dept.isActive) {
      const inUse = await m.count(Employee, { where: { departmentId: id, status: EmployeeStatus.ACTIVE } });
      if (inUse) throw new BadRequestException(`${inUse} active employee(s) are in ${dept.name}. Move them first.`);
    }
    if (dto.isActive !== undefined) dept.isActive = dto.isActive;
    dept.updatedBy = user.id;
    await m.save(dept);
    return (await this.listDepartments(user, dept.businessUnitId)).find((d) => d.id === id);
  }

  // --- Designations ---------------------------------------------------------

  async listDesignations() {
    const rows = await this.dataSource.manager.find(Designation, { order: { name: 'ASC' } });
    const counts = await this.headcounts('designationId');
    return rows.map((d) => ({
      id: d.id,
      name: d.name,
      bonusTier: d.bonusTier,
      description: d.description,
      isActive: d.isActive,
      headcount: counts.get(d.id) ?? 0,
    }));
  }

  private async assertDesignationFree(name: string, exceptId?: string) {
    const clash = await this.dataSource.manager
      .createQueryBuilder(Designation, 'd')
      .where('UPPER(d.name) = UPPER(:name)', { name })
      .andWhere(exceptId ? 'd.id != :exceptId' : '1=1', { exceptId })
      .getOne();
    if (clash) throw new ConflictException(`A designation called ${clash.name} already exists.`);
  }

  async createDesignation(dto: CreateDesignationDto, user: AuthenticatedUser) {
    const name = dto.name.trim();
    await this.assertDesignationFree(name);
    const m = this.dataSource.manager;
    const saved = await m.save(
      m.create(Designation, {
        name,
        bonusTier: dto.bonusTier,
        description: dto.description?.trim() || null,
        createdBy: user.id,
      }),
    );
    return (await this.listDesignations()).find((d) => d.id === saved.id);
  }

  async updateDesignation(id: string, dto: UpdateDesignationDto, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const d = await m.findOne(Designation, { where: { id } });
    if (!d) throw new NotFoundException('Designation not found');
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (name !== d.name) await this.assertDesignationFree(name, id);
      d.name = name;
    }
    if (dto.bonusTier !== undefined) d.bonusTier = dto.bonusTier;
    if (dto.description !== undefined) d.description = dto.description.trim() || null;
    if (dto.isActive === false && d.isActive) {
      const inUse = await m.count(Employee, { where: { designationId: id, status: EmployeeStatus.ACTIVE } });
      if (inUse) throw new BadRequestException(`${inUse} active employee(s) hold ${d.name}. Change theirs first.`);
    }
    if (dto.isActive !== undefined) d.isActive = dto.isActive;
    d.updatedBy = user.id;
    await m.save(d);
    return (await this.listDesignations()).find((x) => x.id === id);
  }

  // --- Holidays ---------------------------------------------------------------

  async listHolidays(user: AuthenticatedUser, year?: number) {
    const y = year ?? Number(businessDate().slice(0, 4));
    const scope = visibleUnitIds(user);
    const rows = await this.dataSource.manager
      .createQueryBuilder(Holiday, 'h')
      .leftJoinAndSelect('h.businessUnit', 'bu')
      .where('h.date BETWEEN :from AND :to', { from: `${y}-01-01`, to: `${y}-12-31` })
      .orderBy('h.date')
      .getMany();
    return rows
      .filter((h) => !h.businessUnitId || !scope || scope.includes(h.businessUnitId))
      .map((h) => ({
        id: h.id,
        date: h.date,
        name: h.name,
        businessUnit: h.businessUnit ? { id: h.businessUnit.id, code: h.businessUnit.code, name: h.businessUnit.name } : null,
      }));
  }

  async createHoliday(dto: CreateHolidayDto, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    if (dto.businessUnitId && !(await m.findOne(BusinessUnit, { where: { id: dto.businessUnitId } }))) {
      throw new BadRequestException('That business unit does not exist.');
    }
    // A group-wide holiday clashes with any on that date; a unit's with the group's or its own.
    const clash = (await m.find(Holiday, { where: { date: dto.date } })).find(
      (h) => !dto.businessUnitId || !h.businessUnitId || h.businessUnitId === dto.businessUnitId,
    );
    if (clash) throw new ConflictException(`${dto.date} is already a holiday (${clash.name}).`);
    await m.save(
      m.create(Holiday, {
        date: dto.date,
        name: dto.name.trim(),
        businessUnitId: dto.businessUnitId ?? null,
        createdBy: user.id,
      }),
    );
    return this.listHolidays(user, Number(dto.date.slice(0, 4)));
  }

  /**
   * Removing a holiday only changes days not yet marked — a marked day
   * keeps the rest-day snapshot it was recorded with.
   */
  async deleteHoliday(id: string, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const h = await m.findOne(Holiday, { where: { id } });
    if (!h) throw new NotFoundException('Holiday not found');
    await m.delete(Holiday, { id });
    return this.listHolidays(user, Number(h.date.slice(0, 4)));
  }

  // --- Leave types ------------------------------------------------------------

  async listLeaveTypes() {
    const rows = await this.dataSource.manager.find(LeaveType, { order: { sortOrder: 'ASC', name: 'ASC' } });
    return rows.map((t) => ({
      id: t.id,
      code: t.code,
      name: t.name,
      isPaid: t.isPaid,
      isActive: t.isActive,
      sortOrder: t.sortOrder,
      description: t.description,
    }));
  }

  async createLeaveType(dto: CreateLeaveTypeDto, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const code = dto.code.trim().toUpperCase();
    const name = dto.name.trim();
    const clash = await m
      .createQueryBuilder(LeaveType, 't')
      .withDeleted()
      .where('t.code = :code OR UPPER(t.name) = UPPER(:name)', { code, name })
      .getOne();
    if (clash) throw new ConflictException(`A leave type ${clash.name} (${clash.code}) already exists.`);
    const max = await m.createQueryBuilder(LeaveType, 't').select('MAX(t.sortOrder)', 'max').getRawOne<{ max: number | null }>();
    await m.save(
      m.create(LeaveType, {
        code,
        name,
        isPaid: dto.isPaid,
        description: dto.description?.trim() || null,
        sortOrder: (max?.max ?? 0) + 10,
        createdBy: user.id,
      }),
    );
    return this.listLeaveTypes();
  }

  async updateLeaveType(id: string, dto: UpdateLeaveTypeDto, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const t = await m.findOne(LeaveType, { where: { id } });
    if (!t) throw new NotFoundException('Leave type not found');
    if (dto.name !== undefined) t.name = dto.name.trim();
    if (dto.description !== undefined) t.description = dto.description.trim() || null;
    if (dto.sortOrder !== undefined) t.sortOrder = dto.sortOrder;

    const warnings: string[] = [];
    if (dto.isActive === false && t.isActive) {
      // A waiting request could never be approved once its type is retired.
      const pending = await m.count(LeaveRequest, { where: { leaveTypeId: id, status: LeaveRequestStatus.PENDING } });
      if (pending) {
        throw new BadRequestException(
          `${pending} ${t.name.toLowerCase()} request${pending === 1 ? ' is' : 's are'} still waiting for approval. Approve, reject or withdraw ${pending === 1 ? 'it' : 'them'} first.`,
        );
      }
      // Retiring doesn't stop the policy crediting it — say so rather than block, since a new
      // version can't start in the past and this year's entitlement is already running.
      const today = businessDate();
      const active = await activePolicies(m);
      const inForce = policyOn(active, today);
      const giving = [inForce, ...active.filter((p) => p.effectiveFrom > today)].filter(
        (p): p is HrPolicy => Boolean(p?.leaveRules.some((r) => r.leaveTypeId === id)),
      );
      if (giving.length) {
        warnings.push(
          `${t.name} is retired, but the leave policy (v${giving.map((p) => p.version).join(', v')}) still gives it an entitlement, so balances keep counting it. Publish a policy version without it to stop that.`,
        );
      }
    }
    if (dto.isActive !== undefined) t.isActive = dto.isActive;
    t.updatedBy = user.id;
    await m.save(t);
    return { leaveTypes: await this.listLeaveTypes(), warnings };
  }

  // --- HR policy versions -----------------------------------------------------

  async listPolicies() {
    const m = this.dataSource.manager;
    const policies = await m.find(HrPolicy, {
      relations: { leaveRules: { leaveType: true } },
      order: { effectiveFrom: 'DESC', version: 'DESC' },
    });
    const today = businessDate();
    const active = policies.filter((p) => p.status === HrPolicyStatus.ACTIVE).reverse();
    const current = policyOn(active, today);
    const names = await userNames(m, policies.map((p) => p.createdBy));
    return policies.map((p) => {
      const next = active.find((a) => a.effectiveFrom > p.effectiveFrom);
      return {
        id: p.id,
        version: p.version,
        effectiveFrom: p.effectiveFrom,
        effectiveTo: p.status === HrPolicyStatus.ACTIVE && next ? addDays(next.effectiveFrom, -1) : null,
        status: p.status,
        isCurrent: current?.id === p.id,
        isUpcoming: p.status === HrPolicyStatus.ACTIVE && p.effectiveFrom > today,
        note: p.note,
        attendanceBackdateDays: p.attendanceBackdateDays,
        createdAt: p.createdAt,
        createdByName: p.createdBy ? names.get(p.createdBy) ?? null : null,
        leaveRules: [...p.leaveRules]
          .sort((a, b) => a.leaveType.sortOrder - b.leaveType.sortOrder)
          .map((r) => ({
            leaveTypeId: r.leaveTypeId,
            leaveTypeCode: r.leaveType.code,
            leaveTypeName: r.leaveType.name,
            daysPerYear: days(r.daysPerYear),
            availableAfterMonths: r.availableAfterMonths,
            maxConsecutiveDays: r.maxConsecutiveDays,
            carryForward: r.carryForward,
            maxBalance: days(r.maxBalance),
            encashable: r.encashable,
            employmentTypes: r.employmentTypes,
          })),
      };
    });
  }

  /**
   * A new version from a date — never an edit (Fig. 16). It can't start in
   * the past, so a leave year already under way is never re-counted; a
   * version for the same start date as one that hasn't begun replaces it.
   */
  async createPolicy(dto: CreateHrPolicyDto, user: AuthenticatedUser) {
    const today = businessDate();
    if (dto.effectiveFrom < today) {
      throw new BadRequestException('A policy change can start today at the earliest — history is never re-counted.');
    }
    const typeIds = dto.leaveRules.map((r) => r.leaveTypeId);
    if (new Set(typeIds).size !== typeIds.length) throw new BadRequestException('Each leave type can appear only once.');

    return this.dataSource.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtext('hr-policy'))`);
      const types = typeIds.length ? await m.find(LeaveType, { where: { id: In(typeIds) } }) : [];
      for (const rule of dto.leaveRules) {
        const type = types.find((t) => t.id === rule.leaveTypeId);
        if (!type) throw new BadRequestException('One of the leave types does not exist.');
        if (!type.isPaid) throw new BadRequestException(`${type.name} is unpaid — it has no entitlement to set.`);
        if (rule.maxBalance && toHalves(rule.maxBalance) < toHalves(rule.daysPerYear)) {
          throw new BadRequestException(`${type.name}: the maximum balance can't be less than a year's entitlement.`);
        }
        if (!rule.carryForward && rule.maxBalance) {
          throw new BadRequestException(`${type.name}: a maximum balance only applies when leave carries forward.`);
        }
      }

      const sameDay = await m.find(HrPolicy, { where: { effectiveFrom: dto.effectiveFrom, status: HrPolicyStatus.ACTIVE } });
      for (const p of sameDay) {
        p.status = HrPolicyStatus.SUPERSEDED;
        p.updatedBy = user.id;
      }
      await m.save(sameDay);

      const max = await m.createQueryBuilder(HrPolicy, 'p').select('MAX(p.version)', 'max').getRawOne<{ max: number | null }>();
      const policy = await m.save(
        m.create(HrPolicy, {
          version: (max?.max ?? 0) + 1,
          effectiveFrom: dto.effectiveFrom,
          status: HrPolicyStatus.ACTIVE,
          note: dto.note?.trim() || null,
          attendanceBackdateDays: dto.attendanceBackdateDays,
          createdBy: user.id,
          leaveRules: dto.leaveRules.map((r) =>
            m.create(HrPolicyLeaveRule, {
              leaveTypeId: r.leaveTypeId,
              daysPerYear: r.daysPerYear,
              availableAfterMonths: r.availableAfterMonths,
              maxConsecutiveDays: r.maxConsecutiveDays ?? null,
              carryForward: r.carryForward,
              maxBalance: r.carryForward ? r.maxBalance ?? null : null,
              encashable: r.encashable,
              employmentTypes: [...new Set(r.employmentTypes)] as EmploymentType[],
            }),
          ),
        }),
      );
      return { id: policy.id, version: policy.version, replaced: sameDay.map((p) => p.version) };
    });
  }
}

