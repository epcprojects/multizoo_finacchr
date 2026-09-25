import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, In, LessThanOrEqual } from 'typeorm';
import {
  AttendanceSource,
  AttendanceStatus,
  EmployeeStatus,
  LeaveRequestStatus,
  Permission,
} from '@multizoo/types';
import { businessDate } from '@multizoo/utils';
import type { AuthenticatedUser } from '../users/users.service';
import { assertUnitAccess, hasPermission, visibleUnitIds } from '../../../common/scope/unit-scope';
import { Employee } from './entities/employee.entity';
import { AttendanceRecord } from './entities/attendance.entity';
import { HrPolicy, LeaveAdjustment, LeaveRequest, LeaveType } from './entities/leave.entity';
import {
  activePolicies,
  assertNotSelf,
  calendarFor,
  holidaysFor,
  loadEmployee,
  lockEmployees,
  policyOn,
  userNames,
} from './hr-common';
import {
  daysInclusive,
  fromHalves,
  leaveLedger,
  leaveYear,
  toHalves,
  workingDays,
  yearOf,
  type IsoDate,
  type LeaveRuleInput,
  type LeaveYearResult,
} from './hr-math';
import {
  CreateLeaveAdjustmentDto,
  CreateLeaveRequestDto,
  LeaveRequestBodyDto,
  ListLeaveRequestsQueryDto,
} from './dto/hr.dto';

export interface EmployeeLeave {
  /** The requested year's result for every leave type. */
  byType: Map<string, LeaveYearResult>;
  /** Every LEAVE day up to the end of that year → covered by the balance? */
  coverage: Map<IsoDate, boolean>;
}

interface Assessment {
  employee: Employee;
  leaveType: LeaveType | null;
  dates: IsoDate[];
  errors: string[];
  warnings: string[];
  balance: {
    isPaid: boolean;
    entitled: boolean;
    available: string;
    after: string;
    uncoveredDays: number;
  } | null;
  /** Days already marked absent (or as leave by hand) that approval will turn into this leave. */
  converts: IsoDate[];
}

const MAX_REQUEST_SPAN = 180;

/**
 * Leave: balances (walked day by day, Fig. 14), requests and their
 * approval, and balance adjustments. A Branch Manager enters and approves
 * leave for their unit; approval writes the days onto the attendance
 * register, so there's one record of where everyone was.
 */
@Injectable()
export class LeaveService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // --- Balances --------------------------------------------------------------

  /** Leave ledgers for many employees at once, for one leave year. */
  async ledgers(
    m: EntityManager,
    employees: Employee[],
    year: number,
    options: { excludePendingRequestId?: string } = {},
  ): Promise<Map<string, EmployeeLeave>> {
    const out = new Map<string, EmployeeLeave>();
    if (!employees.length) return out;
    const ids = employees.map((e) => e.id);
    const yearEnd = `${year}-12-31`;

    const types = await m.find(LeaveType, { withDeleted: true });
    const policies = await activePolicies(m);
    const records = await m
      .createQueryBuilder(AttendanceRecord, 'a')
      .select(['a.employeeId', 'a.date', 'a.leaveTypeId'])
      .where('a.employeeId IN (:...ids)', { ids })
      .andWhere('a.status = :status', { status: AttendanceStatus.LEAVE })
      .andWhere('a.date <= :yearEnd', { yearEnd })
      .getMany();
    const adjustments = await m.find(LeaveAdjustment, {
      where: { employeeId: In(ids), leaveYear: LessThanOrEqual(year) },
    });
    const pending = await m.find(LeaveRequest, {
      where: { employeeId: In(ids), status: LeaveRequestStatus.PENDING },
    });

    for (const employee of employees) {
      const byType = new Map<string, LeaveYearResult>();
      const coverage = new Map<IsoDate, boolean>();
      for (const type of types) {
        const days = records.filter((r) => r.employeeId === employee.id && r.leaveTypeId === type.id);
        const adj = adjustments.filter((a) => a.employeeId === employee.id && a.leaveTypeId === type.id);
        const pend = pending.filter(
          (p) => p.employeeId === employee.id && p.leaveTypeId === type.id && p.id !== options.excludePendingRequestId,
        );
        if (!type.isActive && !days.length && !adj.length) continue;

        const daysByYear = new Map<number, IsoDate[]>();
        for (const r of days) daysByYear.set(yearOf(r.date), [...(daysByYear.get(yearOf(r.date)) ?? []), r.date]);
        const adjustmentsByYear = new Map<number, number>();
        for (const a of adj) adjustmentsByYear.set(a.leaveYear, (adjustmentsByYear.get(a.leaveYear) ?? 0) + toHalves(a.days));
        const pendingByYear = new Map<number, number>();
        for (const p of pend) {
          const y = yearOf(p.startDate);
          pendingByYear.set(y, (pendingByYear.get(y) ?? 0) + toHalves(p.days));
        }

        const ledger = leaveLedger({
          joinDate: employee.joinDate,
          toYear: year,
          isPaid: type.isPaid,
          ruleForYear: (y) => this.ruleFor(policies, employee, type.id, y),
          adjustmentsByYear,
          daysByYear,
          pendingByYear,
        });
        for (const y of ledger) {
          for (const d of y.covered) coverage.set(d, true);
          for (const d of y.uncovered) coverage.set(d, false);
        }
        const target = ledger.find((y) => y.year === year);
        byType.set(
          type.id,
          target ?? {
            year,
            carriedIn: 0,
            entitlement: 0,
            adjustments: 0,
            eligibleFrom: employee.joinDate,
            taken: 0,
            covered: [],
            uncovered: [],
            closing: 0,
            pending: 0,
            available: 0,
          },
        );
      }
      out.set(employee.id, { byType, coverage });
    }
    return out;
  }

  /** The policy rule in force at the start of the year (or on the join date, if later). */
  private ruleFor(policies: HrPolicy[], employee: Employee, leaveTypeId: string, year: number): LeaveRuleInput | null {
    const start = `${year}-01-01`;
    const policy = policyOn(policies, employee.joinDate > start ? employee.joinDate : start) ?? policies[0] ?? null;
    const rule = policy?.leaveRules.find((r) => r.leaveTypeId === leaveTypeId);
    if (!rule) return null;
    return {
      daysPerYear: toHalves(rule.daysPerYear),
      availableAfterMonths: rule.availableAfterMonths,
      carryForward: rule.carryForward,
      maxBalance: rule.maxBalance === null ? null : toHalves(rule.maxBalance),
      eligible: rule.employmentTypes.includes(employee.employmentType),
    };
  }

  private async typeRows(m: EntityManager) {
    return m.find(LeaveType, { order: { sortOrder: 'ASC', name: 'ASC' }, withDeleted: true });
  }

  private balanceRows(types: LeaveType[], leave: EmployeeLeave | undefined, policyRuleTypeIds: Set<string>) {
    return types.flatMap((t) => {
      const r = leave?.byType.get(t.id);
      if (!r) return [];
      return [
        {
          leaveTypeId: t.id,
          code: t.code,
          name: t.name,
          isPaid: t.isPaid,
          inPolicy: policyRuleTypeIds.has(t.id),
          eligibleFrom: r.eligibleFrom,
          carriedIn: fromHalves(r.carriedIn),
          entitlement: fromHalves(r.entitlement),
          adjustments: fromHalves(r.adjustments),
          taken: fromHalves(r.taken),
          uncovered: r.uncovered.length,
          pending: fromHalves(r.pending),
          balance: fromHalves(r.closing),
          available: fromHalves(r.available),
        },
      ];
    });
  }

  async balances(user: AuthenticatedUser, businessUnitId?: string, year?: number) {
    const m = this.dataSource.manager;
    const y = year ?? yearOf(businessDate());
    if (businessUnitId) assertUnitAccess(user, businessUnitId);
    const scope = visibleUnitIds(user);
    const qb = m
      .createQueryBuilder(Employee, 'e')
      .leftJoinAndSelect('e.designation', 'des')
      .leftJoinAndSelect('e.businessUnit', 'bu')
      .where('e.joinDate <= :end', { end: `${y}-12-31` })
      .andWhere('(e.exitDate IS NULL OR e.exitDate >= :start)', { start: `${y}-01-01` })
      .orderBy('bu.code')
      .addOrderBy('e.fullName');
    if (businessUnitId) qb.andWhere('e.businessUnitId = :businessUnitId', { businessUnitId });
    if (scope) qb.andWhere('e.businessUnitId IN (:...scope)', { scope: scope.length ? scope : [NIL] });
    const employees = await qb.getMany();

    const ledgers = await this.ledgers(m, employees, y);
    const types = await this.typeRows(m);
    const policy = policyOn(await activePolicies(m), `${y}-01-01`);
    const inPolicy = new Set(policy?.leaveRules.map((r) => r.leaveTypeId) ?? []);
    return {
      year: y,
      leaveTypes: types.filter((t) => t.isActive).map((t) => ({ id: t.id, code: t.code, name: t.name, isPaid: t.isPaid })),
      employees: employees.map((e) => ({
        id: e.id,
        employeeCode: e.employeeCode,
        fullName: e.fullName,
        designation: e.designation.name,
        employmentType: e.employmentType,
        businessUnit: { id: e.businessUnit.id, code: e.businessUnit.code, name: e.businessUnit.name },
        status: e.status,
        balances: this.balanceRows(types, ledgers.get(e.id), inPolicy),
      })),
    };
  }

  /** One employee's leave year: balances, the days taken, requests and adjustments. */
  async employeeLeave(employeeId: string, user: AuthenticatedUser, year?: number) {
    const m = this.dataSource.manager;
    const employee = await loadEmployee(m, employeeId, user);
    const y = year ?? yearOf(businessDate());
    const ledgers = await this.ledgers(m, [employee], y);
    const leave = ledgers.get(employee.id);
    const types = await this.typeRows(m);
    const policy = policyOn(await activePolicies(m), `${y}-01-01`);
    const inPolicy = new Set(policy?.leaveRules.map((r) => r.leaveTypeId) ?? []);

    const dayRecords = await m.find(AttendanceRecord, {
      where: { employeeId, status: AttendanceStatus.LEAVE },
      relations: { leaveType: true },
      order: { date: 'ASC' },
      withDeleted: true,
    });
    const requests = await this.listRequests({ employeeId }, user);
    const adjustments = await m.find(LeaveAdjustment, {
      where: { employeeId },
      relations: { leaveType: true },
      order: { leaveYear: 'DESC', createdAt: 'DESC' },
    });
    const names = await userNames(m, adjustments.map((a) => a.createdBy));

    return {
      year: y,
      employee: { id: employee.id, fullName: employee.fullName, joinDate: employee.joinDate },
      balances: this.balanceRows(types, leave, inPolicy),
      days: dayRecords
        .filter((d) => yearOf(d.date) === y)
        .map((d) => ({
          date: d.date,
          leaveTypeId: d.leaveTypeId,
          leaveTypeName: d.leaveType?.name ?? '—',
          covered: leave?.coverage.get(d.date) ?? false,
          leaveRequestId: d.leaveRequestId,
        })),
      requests,
      adjustments: adjustments.map((a) => ({
        id: a.id,
        leaveYear: a.leaveYear,
        leaveTypeName: a.leaveType.name,
        days: fromHalves(toHalves(a.days)),
        reason: a.reason,
        createdAt: a.createdAt,
        createdByName: a.createdBy ? names.get(a.createdBy) ?? null : null,
      })),
    };
  }

  // --- Requests --------------------------------------------------------------

  async listRequests(query: ListLeaveRequestsQueryDto, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const scope = visibleUnitIds(user);
    const qb = m
      .createQueryBuilder(LeaveRequest, 'r')
      .leftJoinAndSelect('r.employee', 'e')
      .leftJoinAndSelect('e.designation', 'des')
      .leftJoinAndSelect('r.businessUnit', 'bu')
      .leftJoinAndSelect('r.leaveType', 'lt')
      .orderBy('r.startDate', 'DESC')
      .addOrderBy('r.createdAt', 'DESC')
      .take(500);
    if (query.businessUnitId) qb.andWhere('r.businessUnitId = :u', { u: query.businessUnitId });
    if (query.employeeId) qb.andWhere('r.employeeId = :e', { e: query.employeeId });
    if (query.status) qb.andWhere('r.status = :s', { s: query.status });
    if (query.from) qb.andWhere('r.endDate >= :from', { from: query.from });
    if (query.to) qb.andWhere('r.startDate <= :to', { to: query.to });
    if (scope) qb.andWhere('r.businessUnitId IN (:...scope)', { scope: scope.length ? scope : [NIL] });
    const rows = await qb.getMany();
    const names = await userNames(
      m,
      rows.flatMap((r) => [r.createdBy, r.reviewedBy, r.cancelledBy]),
    );
    const name = (id: string | null) => (id ? names.get(id) ?? null : null);
    return rows.map((r) => ({
      id: r.id,
      employee: {
        id: r.employee.id,
        employeeCode: r.employee.employeeCode,
        fullName: r.employee.fullName,
        designation: r.employee.designation?.name ?? null,
        userId: r.employee.userId,
      },
      businessUnit: { id: r.businessUnit.id, code: r.businessUnit.code, name: r.businessUnit.name },
      leaveType: { id: r.leaveType.id, code: r.leaveType.code, name: r.leaveType.name, isPaid: r.leaveType.isPaid },
      startDate: r.startDate,
      endDate: r.endDate,
      days: fromHalves(toHalves(r.days)),
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt,
      createdBy: r.createdBy,
      requestedByName: name(r.createdBy),
      reviewedAt: r.reviewedAt,
      reviewedByName: name(r.reviewedBy),
      reviewNote: r.reviewNote,
      cancelledAt: r.cancelledAt,
      cancelledByName: name(r.cancelledBy),
      cancelReason: r.cancelReason,
    }));
  }

  /**
   * Everything that decides whether a request can go ahead, in the words
   * the approver sees: the working days it covers, what the balance will
   * and won't pay for, and anything blocking it.
   */
  private async assess(
    m: EntityManager,
    body: LeaveRequestBodyDto,
    user: AuthenticatedUser,
    excludeRequestId?: string,
  ): Promise<Assessment> {
    const employee = await loadEmployee(m, body.employeeId, user);
    const errors: string[] = [];
    const warnings: string[] = [];
    const result: Assessment = { employee, leaveType: null, dates: [], errors, warnings, balance: null, converts: [] };

    const leaveType = await m.findOne(LeaveType, { where: { id: body.leaveTypeId } });
    if (!leaveType || !leaveType.isActive) {
      errors.push('That leave type is not available.');
      return result;
    }
    result.leaveType = leaveType;

    const { startDate, endDate } = body;
    if (endDate < startDate) {
      errors.push('The leave ends before it starts.');
      return result;
    }
    if (yearOf(startDate) !== yearOf(endDate)) {
      errors.push('Leave can’t cross 31 December — enter the two years as separate requests.');
      return result;
    }
    if (daysInclusive(startDate, endDate) > MAX_REQUEST_SPAN) {
      errors.push(`A single request can cover at most ${MAX_REQUEST_SPAN} days.`);
      return result;
    }
    if (startDate < employee.joinDate) errors.push(`${employee.fullName} joined on ${employee.joinDate}.`);
    if (employee.exitDate && endDate > employee.exitDate) {
      errors.push(`${employee.fullName}'s last working day is ${employee.exitDate}.`);
    }

    const holidays = (await holidaysFor(m, [employee.businessUnitId], startDate, endDate)).get(employee.businessUnitId) ?? new Set<IsoDate>();
    const dates = workingDays(startDate, endDate, calendarFor(employee, holidays));
    result.dates = dates;
    if (!dates.length) {
      errors.push('Those dates are all rest days (weekly off or holidays) — there is no leave to take.');
      return result;
    }

    const overlapping = await m
      .createQueryBuilder(LeaveRequest, 'r')
      .leftJoinAndSelect('r.leaveType', 'lt')
      .where('r.employeeId = :id', { id: employee.id })
      .andWhere('r.status IN (:...statuses)', { statuses: [LeaveRequestStatus.PENDING, LeaveRequestStatus.APPROVED] })
      .andWhere('r.startDate <= :endDate AND r.endDate >= :startDate', { startDate, endDate })
      .andWhere(excludeRequestId ? 'r.id != :exclude' : '1=1', { exclude: excludeRequestId })
      .getMany();
    for (const o of overlapping) {
      errors.push(
        `It overlaps ${o.status === LeaveRequestStatus.PENDING ? 'a pending' : 'an approved'} ${o.leaveType.name.toLowerCase()} request (${o.startDate} – ${o.endDate}).`,
      );
    }

    const policy = policyOn(await activePolicies(m), startDate);
    const rule = policy?.leaveRules.find((r) => r.leaveTypeId === leaveType.id);
    if (rule?.maxConsecutiveDays && dates.length > rule.maxConsecutiveDays) {
      errors.push(
        `${leaveType.name} is at most ${rule.maxConsecutiveDays} working days at a stretch; this is ${dates.length}. Split it, or use another leave type for the rest.`,
      );
    }

    const existing = await m.find(AttendanceRecord, { where: { employeeId: employee.id, date: In(dates) } });
    for (const rec of existing) {
      if (rec.leaveRequestId && rec.leaveRequestId !== excludeRequestId) continue; // reported as an overlap
      if (rec.status === AttendanceStatus.PRESENT || rec.status === AttendanceStatus.HALF_DAY) {
        errors.push(`${employee.fullName} is marked ${rec.status === AttendanceStatus.PRESENT ? 'present' : 'half day'} on ${rec.date}.`);
      } else if (!rec.leaveRequestId) {
        result.converts.push(rec.date);
      }
    }
    if (result.converts.length) {
      warnings.push(
        `${result.converts.length} ${plural(result.converts.length, 'day')} already marked absent or as leave will become this ${leaveType.name.toLowerCase()}.`,
      );
    }

    if (!leaveType.isPaid) {
      warnings.push(`${leaveType.name}: ${dates.length} ${plural(dates.length, 'day')} will be deducted from salary.`);
      result.balance = { isPaid: false, entitled: false, available: '0', after: '0', uncoveredDays: dates.length };
      return result;
    }

    const year = yearOf(startDate);
    const ledger = (await this.ledgers(m, [employee], year, { excludePendingRequestId: excludeRequestId }))
      .get(employee.id)
      ?.byType.get(leaveType.id);
    if (!ledger) throw new Error('leave ledger missing for an active leave type');
    const alreadyThisType = new Set([...ledger.covered, ...ledger.uncovered]);
    const simulated = leaveYear({
      year,
      isPaid: true,
      entitlement: ledger.entitlement,
      eligibleFrom: ledger.eligibleFrom,
      carriedIn: ledger.carriedIn,
      adjustments: ledger.adjustments,
      leaveDays: [...alreadyThisType, ...dates.filter((d) => !alreadyThisType.has(d))],
      pending: 0,
    });
    const uncovered = dates.filter((d) => simulated.uncovered.includes(d)).length;
    const entitled = Boolean(rule && rule.employmentTypes.includes(employee.employmentType));
    result.balance = {
      isPaid: true,
      entitled,
      available: fromHalves(ledger.available),
      after: fromHalves(ledger.available - (dates.length - uncovered) * 2),
      uncoveredDays: uncovered,
    };
    if (!entitled) {
      warnings.push(
        rule
          ? `${employee.fullName}'s employment type (${employee.employmentType.toLowerCase().replace('_', ' ')}) doesn't get ${leaveType.name.toLowerCase()}.`
          : `The leave policy gives no ${leaveType.name.toLowerCase()} entitlement.`,
      );
    }
    if (uncovered) {
      warnings.push(
        `${uncovered} of ${dates.length} ${plural(dates.length, 'day')} ${uncovered === 1 ? "isn't" : "aren't"} covered by the ${leaveType.name.toLowerCase()} balance (${fromHalves(ledger.available)} available${
          ledger.eligibleFrom > startDate ? `, usable from ${ledger.eligibleFrom}` : ''
        }) — ${uncovered === 1 ? 'it' : 'they'} will be deducted like an absence.`,
      );
    }
    return result;
  }

  private summary(a: Assessment) {
    return {
      employee: { id: a.employee.id, fullName: a.employee.fullName },
      leaveType: a.leaveType ? { id: a.leaveType.id, name: a.leaveType.name, isPaid: a.leaveType.isPaid } : null,
      dates: a.dates,
      days: fromHalves(a.dates.length * 2),
      errors: a.errors,
      warnings: a.warnings,
      balance: a.balance,
    };
  }

  async preview(body: LeaveRequestBodyDto, user: AuthenticatedUser) {
    const a = await this.assess(this.dataSource.manager, body, user);
    return this.summary(a);
  }

  async createRequest(dto: CreateLeaveRequestDto, user: AuthenticatedUser) {
    if (dto.approve && !hasPermission(user, Permission.LEAVE_APPROVE_OWN_UNIT)) {
      throw new ForbiddenException('Only a leave approver can approve it in the same step.');
    }
    const { id, warnings } = await this.dataSource.transaction(async (m) => {
      await lockEmployees(m, [dto.employeeId]);
      const a = await this.assess(m, dto, user);
      if (a.errors.length || !a.leaveType) throw new BadRequestException(a.errors.join(' '));
      const request = await m.save(
        m.create(LeaveRequest, {
          employeeId: a.employee.id,
          businessUnitId: a.employee.businessUnitId,
          leaveTypeId: a.leaveType.id,
          startDate: dto.startDate,
          endDate: dto.endDate,
          days: fromHalves(a.dates.length * 2),
          reason: dto.reason?.trim() || null,
          status: LeaveRequestStatus.PENDING,
          createdBy: user.id,
        }),
      );
      if (dto.approve) await this.approveInTx(m, request, user, undefined);
      return { id: request.id, warnings: a.warnings };
    });
    return { request: await this.getRequest(id, user), warnings };
  }

  private async getRequest(id: string, user: AuthenticatedUser) {
    const r = await this.dataSource.manager.findOne(LeaveRequest, { where: { id } });
    if (!r) throw new NotFoundException('Leave request not found');
    const [row] = (await this.listRequests({ employeeId: r.employeeId }, user)).filter((x) => x.id === id);
    return row;
  }

  private async loadRequest(m: EntityManager, id: string, user: AuthenticatedUser) {
    const request = await m.findOne(LeaveRequest, { where: { id } });
    if (!request) throw new NotFoundException('Leave request not found');
    assertUnitAccess(user, request.businessUnitId);
    return request;
  }

  private async approveInTx(m: EntityManager, request: LeaveRequest, user: AuthenticatedUser, note: string | undefined) {
    const employee = await m.findOneOrFail(Employee, { where: { id: request.employeeId } });
    assertNotSelf(employee, user, 'leave');
    const a = await this.assess(
      m,
      {
        employeeId: request.employeeId,
        leaveTypeId: request.leaveTypeId,
        startDate: request.startDate,
        endDate: request.endDate,
      },
      user,
      request.id,
    );
    if (a.errors.length) throw new BadRequestException(a.errors.join(' '));

    const existing = await m.find(AttendanceRecord, { where: { employeeId: request.employeeId, date: In(a.dates) } });
    for (const date of a.dates) {
      const rec = existing.find((r) => r.date === date) ?? m.create(AttendanceRecord, { employeeId: request.employeeId, date, createdBy: user.id });
      Object.assign(rec, {
        businessUnitId: request.businessUnitId,
        status: AttendanceStatus.LEAVE,
        restDay: false,
        leaveTypeId: request.leaveTypeId,
        leaveRequestId: request.id,
        source: AttendanceSource.LEAVE_REQUEST,
        note: null,
        updatedBy: user.id,
      });
      await m.save(rec);
    }

    request.days = fromHalves(a.dates.length * 2);
    request.status = LeaveRequestStatus.APPROVED;
    request.reviewedBy = user.id;
    request.reviewedAt = new Date();
    request.reviewNote = note?.trim() || null;
    request.updatedBy = user.id;
    await m.save(request);
    return a.warnings;
  }

  async approve(id: string, note: string | undefined, user: AuthenticatedUser) {
    const warnings = await this.dataSource.transaction(async (m) => {
      const found = await this.loadRequest(m, id, user);
      await lockEmployees(m, [found.employeeId]);
      const request = await m.findOneOrFail(LeaveRequest, { where: { id } });
      if (request.status !== LeaveRequestStatus.PENDING) {
        throw new ConflictException(`This request is already ${request.status.toLowerCase()}.`);
      }
      return this.approveInTx(m, request, user, note);
    });
    return { request: await this.getRequest(id, user), warnings };
  }

  async reject(id: string, note: string | undefined, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const request = await this.loadRequest(m, id, user);
      if (request.status !== LeaveRequestStatus.PENDING) {
        throw new ConflictException(`This request is already ${request.status.toLowerCase()}.`);
      }
      const employee = await m.findOneOrFail(Employee, { where: { id: request.employeeId } });
      assertNotSelf(employee, user, 'leave');
      request.status = LeaveRequestStatus.REJECTED;
      request.reviewedBy = user.id;
      request.reviewedAt = new Date();
      request.reviewNote = note?.trim() || null;
      request.updatedBy = user.id;
      await m.save(request);
    });
    return { request: await this.getRequest(id, user), warnings: [] as string[] };
  }

  /**
   * Withdraw a pending request, or call off approved leave. The days it
   * wrote come off the register; any that have already passed go back to
   * "not marked" for the Branch Manager to mark.
   */
  async cancel(id: string, reason: string | undefined, user: AuthenticatedUser) {
    const reopened = await this.dataSource.transaction(async (m) => {
      const request = await this.loadRequest(m, id, user);
      await lockEmployees(m, [request.employeeId]);
      const isApprover = hasPermission(user, Permission.LEAVE_APPROVE_OWN_UNIT) || hasPermission(user, Permission.EMPLOYEE_MANAGE);
      if (request.status === LeaveRequestStatus.PENDING) {
        if (request.createdBy !== user.id && !isApprover) {
          throw new ForbiddenException('Only whoever entered it, or an approver, can withdraw this request.');
        }
      } else if (request.status === LeaveRequestStatus.APPROVED) {
        if (!isApprover) throw new ForbiddenException('Only a leave approver can cancel approved leave.');
      } else {
        throw new ConflictException(`This request is already ${request.status.toLowerCase()}.`);
      }

      const today = businessDate();
      const days = await m.find(AttendanceRecord, { where: { leaveRequestId: id } });
      await m.delete(AttendanceRecord, { leaveRequestId: id });

      request.status = LeaveRequestStatus.CANCELLED;
      request.cancelledBy = user.id;
      request.cancelledAt = new Date();
      request.cancelReason = reason?.trim() || null;
      request.updatedBy = user.id;
      await m.save(request);
      return days.filter((d) => d.date <= today).map((d) => d.date).sort();
    });
    const warnings = reopened.length
      ? [`${reopened.length} past ${plural(reopened.length, 'day')} (${reopened[0]}${reopened.length > 1 ? ` – ${reopened[reopened.length - 1]}` : ''}) ${reopened.length === 1 ? 'is' : 'are'} now unmarked — mark ${reopened.length === 1 ? 'it' : 'them'} on the attendance sheet.`]
      : [];
    return { request: await this.getRequest(id, user), warnings };
  }

  // --- Adjustments -----------------------------------------------------------

  async createAdjustment(dto: CreateLeaveAdjustmentDto, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const employee = await loadEmployee(m, dto.employeeId, user);
    const type = await m.findOne(LeaveType, { where: { id: dto.leaveTypeId } });
    if (!type) throw new BadRequestException('That leave type does not exist.');
    if (!type.isPaid) throw new BadRequestException(`${type.name} is unpaid — it has no balance to adjust.`);
    if (dto.leaveYear < yearOf(employee.joinDate)) {
      throw new BadRequestException(`${employee.fullName} joined in ${yearOf(employee.joinDate)}.`);
    }
    if (toHalves(dto.days) === 0) throw new BadRequestException('An adjustment of zero days changes nothing.');
    if (employee.status === EmployeeStatus.EXITED && employee.exitDate && dto.leaveYear > yearOf(employee.exitDate)) {
      throw new BadRequestException(`${employee.fullName} left in ${yearOf(employee.exitDate)}.`);
    }
    await m.save(
      m.create(LeaveAdjustment, {
        employeeId: employee.id,
        leaveTypeId: type.id,
        leaveYear: dto.leaveYear,
        days: dto.days,
        reason: dto.reason.trim(),
        createdBy: user.id,
      }),
    );
    return this.employeeLeave(employee.id, user, dto.leaveYear);
  }

  /** Pending requests the user can act on, for the Leave screen's banner and the queue. */
  async pendingCount(user: AuthenticatedUser) {
    const scope = visibleUnitIds(user);
    const qb = this.dataSource.manager
      .createQueryBuilder(LeaveRequest, 'r')
      .where('r.status = :s', { s: LeaveRequestStatus.PENDING });
    if (scope) {
      qb.andWhere(
        new Brackets((b) => b.where('r.businessUnitId IN (:...scope)', { scope: scope.length ? scope : [NIL] })),
      );
    }
    return qb.getCount();
  }
}

const NIL = '00000000-0000-0000-0000-000000000000';

function plural(n: number, word: string) {
  return n === 1 ? word : `${word}s`;
}

