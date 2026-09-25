import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, In } from 'typeorm';
import {
  AttendanceSource,
  AttendanceStatus,
  Permission,
} from '@multizoo/types';
import { businessDate } from '@multizoo/utils';
import type { AuthenticatedUser } from '../users/users.service';
import { BusinessUnit } from '../business-units/entities/business-unit.entity';
import { assertUnitAccess, hasPermission, visibleUnitIds } from '../../../common/scope/unit-scope';
import { Employee } from './entities/employee.entity';
import { AttendanceRecord } from './entities/attendance.entity';
import { LeaveType } from './entities/leave.entity';
import {
  activePolicies,
  calendarFor,
  holidayNames,
  holidaysFor,
  isEmployedOn,
  loadEmployee,
  lockEmployees,
  policyOn,
  userNames,
} from './hr-common';
import {
  addDays,
  classifyDay,
  eachDay,
  monthBounds,
  restReason,
  statusAllowed,
  summarizeDays,
  weekday,
  yearOf,
  type ClassifiedDay,
  type IsoDate,
} from './hr-math';
import { LeaveService } from './leave.service';
import { SaveAttendanceSheetDto } from './dto/hr.dto';

const NIL = '00000000-0000-0000-0000-000000000000';

/**
 * Attendance (architecture plan Part 07 §02, Fig. 14): the Branch
 * Manager's daily sheet, and the month's register that turns those days
 * into the salary sheet's "Absent" figure.
 */
@Injectable()
export class AttendanceService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly leave: LeaveService,
  ) {}

  private async unit(m: EntityManager, id: string, user: AuthenticatedUser) {
    assertUnitAccess(user, id);
    const unit = await m.findOne(BusinessUnit, { where: { id } });
    if (!unit) throw new NotFoundException('Business unit not found');
    return unit;
  }

  /** How far back this user may mark: the policy's window, or any date for HR. */
  private async earliestEditable(m: EntityManager, user: AuthenticatedUser): Promise<{ date: IsoDate | null; days: number }> {
    const today = businessDate();
    const policy = policyOn(await activePolicies(m), today);
    const days = policy?.attendanceBackdateDays ?? 7;
    if (hasPermission(user, Permission.EMPLOYEE_MANAGE)) return { date: null, days };
    return { date: addDays(today, -days), days };
  }

  /** Who belongs on a unit's sheet for a date: employed there that day, or already marked there. */
  private async sheetEmployees(m: EntityManager, unitId: string, from: IsoDate, to: IsoDate) {
    return m
      .createQueryBuilder(Employee, 'e')
      .leftJoinAndSelect('e.designation', 'des')
      .leftJoinAndSelect('e.department', 'dep')
      .where(
        new Brackets((b) =>
          b
            .where('e.businessUnitId = :unitId AND e.joinDate <= :to AND (e.exitDate IS NULL OR e.exitDate >= :from)')
            .orWhere(
              'e.id IN (SELECT a."employeeId" FROM attendance_records a WHERE a."businessUnitId" = :unitId AND a.date BETWEEN :from AND :to)',
            ),
        ),
        { unitId, from, to },
      )
      .orderBy('dep.name', 'ASC', 'NULLS LAST')
      .addOrderBy('e.fullName')
      .getMany();
  }

  // --- Daily sheet --------------------------------------------------------------

  async sheet(businessUnitId: string, date: IsoDate, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const unit = await this.unit(m, businessUnitId, user);
    const today = businessDate();
    const employees = await this.sheetEmployees(m, unit.id, date, date);
    const records = employees.length
      ? await m.find(AttendanceRecord, {
          where: { employeeId: In(employees.map((e) => e.id)), date },
          relations: { leaveType: true },
        })
      : [];
    const holidays = await holidayNames(m, unit.id, date, date);
    const holidaySet = new Set(holidays.keys());
    const names = await userNames(m, records.flatMap((r) => [r.createdBy, r.updatedBy]));
    const window = await this.earliestEditable(m, user);
    const canMark =
      hasPermission(user, Permission.ATTENDANCE_MARK_OWN_UNIT) || hasPermission(user, Permission.EMPLOYEE_MANAGE);

    let lockedReason: string | null = null;
    if (!canMark) lockedReason = 'You can view this sheet but not mark it.';
    else if (date > today) lockedReason = 'Attendance can’t be marked ahead of the day — record planned absences as leave.';
    else if (window.date && date < window.date) {
      lockedReason = `Days more than ${window.days} days back can only be corrected by HR (the Accountant).`;
    }

    const rows = employees.map((e) => {
      const rec = records.find((r) => r.employeeId === e.id);
      const reason = restReason(date, calendarFor(e, holidaySet));
      return {
        id: e.id,
        employeeCode: e.employeeCode,
        fullName: e.fullName,
        designation: e.designation?.name ?? null,
        department: e.department?.name ?? null,
        weeklyOffDay: e.weeklyOffDay,
        restDay: rec ? rec.restDay : reason !== null,
        restReason: reason,
        transferred: e.businessUnitId !== unit.id,
        employed: isEmployedOn(e, date),
        record: rec
          ? {
              status: rec.status,
              leaveTypeId: rec.leaveTypeId,
              leaveTypeName: rec.leaveType?.name ?? null,
              source: rec.source,
              leaveRequestId: rec.leaveRequestId,
              note: rec.note,
              checkIn: rec.checkIn,
              checkOut: rec.checkOut,
              markedByName: names.get(rec.updatedBy ?? rec.createdBy ?? '') ?? null,
              markedAt: rec.updatedAt ?? rec.createdAt,
            }
          : null,
      };
    });

    const working = rows.filter((r) => r.employed && !r.restDay);
    const count = (s: AttendanceStatus) => rows.filter((r) => r.record?.status === s).length;
    return {
      unit: { id: unit.id, code: unit.code, name: unit.name },
      date,
      weekday: weekday(date),
      holiday: holidays.get(date) ?? null,
      canEdit: lockedReason === null,
      lockedReason,
      backdateDays: window.days,
      canMarkLeave: hasPermission(user, Permission.LEAVE_APPROVE_OWN_UNIT) || hasPermission(user, Permission.EMPLOYEE_MANAGE),
      counts: {
        expected: working.length,
        marked: working.filter((r) => r.record).length,
        present: count(AttendanceStatus.PRESENT),
        absent: count(AttendanceStatus.ABSENT),
        halfDay: count(AttendanceStatus.HALF_DAY),
        leave: count(AttendanceStatus.LEAVE),
        restDayWorked: rows.filter((r) => r.restDay && (r.record?.status === AttendanceStatus.PRESENT || r.record?.status === AttendanceStatus.HALF_DAY)).length,
      },
      employees: rows,
    };
  }

  /**
   * Save a unit's sheet for one day. Every entry is checked before anything
   * is written, so a sheet either saves whole or tells you each problem.
   */
  async saveSheet(dto: SaveAttendanceSheetDto, user: AuthenticatedUser) {
    const today = businessDate();
    if (dto.date > today) {
      throw new BadRequestException('Attendance can’t be marked ahead of the day — record planned absences as leave.');
    }
    const ids = dto.entries.map((e) => e.employeeId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Each employee can appear once per sheet.');

    await this.dataSource.transaction(async (m) => {
      const unit = await this.unit(m, dto.businessUnitId, user);
      const window = await this.earliestEditable(m, user);
      if (window.date && dto.date < window.date) {
        throw new ForbiddenException(`Days more than ${window.days} days back can only be corrected by HR (the Accountant).`);
      }
      await lockEmployees(m, ids);

      const employees = await m.find(Employee, { where: { id: In(ids) } });
      const existing = await m.find(AttendanceRecord, { where: { employeeId: In(ids), date: dto.date } });
      const holidays = new Set((await holidayNames(m, unit.id, dto.date, dto.date)).keys());
      const leaveTypeIds = dto.entries.map((e) => e.leaveTypeId).filter(Boolean) as string[];
      const leaveTypes = leaveTypeIds.length ? await m.find(LeaveType, { where: { id: In(leaveTypeIds) } }) : [];
      const canMarkLeave =
        hasPermission(user, Permission.LEAVE_APPROVE_OWN_UNIT) || hasPermission(user, Permission.EMPLOYEE_MANAGE);

      const problems: string[] = [];
      const writes: (() => Promise<unknown>)[] = [];
      for (const entry of dto.entries) {
        const e = employees.find((x) => x.id === entry.employeeId);
        if (!e) {
          problems.push('One of the employees does not exist.');
          continue;
        }
        const rec = existing.find((r) => r.employeeId === e.id);
        const who = e.fullName;
        if (e.businessUnitId !== unit.id && rec?.businessUnitId !== unit.id) {
          problems.push(`${who} doesn't work at ${unit.name}.`);
          continue;
        }
        if (!isEmployedOn(e, dto.date)) {
          problems.push(`${who} wasn't employed on ${dto.date}.`);
          continue;
        }
        if (rec?.source === AttendanceSource.LEAVE_REQUEST) {
          if (entry.status !== AttendanceStatus.LEAVE || entry.leaveTypeId !== rec.leaveTypeId) {
            problems.push(`${who} is on approved leave that day — cancel the leave request to change it.`);
          }
          continue;
        }

        if (entry.status === null) {
          if (rec) writes.push(() => m.delete(AttendanceRecord, { id: rec.id }));
          continue;
        }

        const restDay = rec ? rec.restDay : restReason(dto.date, calendarFor(e, holidays)) !== null;
        if (!statusAllowed(entry.status, restDay)) {
          problems.push(
            restDay
              ? `${dto.date} is ${who}'s rest day — mark them off, or present if they worked it.`
              : `${who} can't be marked off on a working day — mark them absent, or add a holiday.`,
          );
          continue;
        }
        let leaveTypeId: string | null = null;
        if (entry.status === AttendanceStatus.LEAVE) {
          if (!canMarkLeave) {
            problems.push(`Only a leave approver can mark ${who} as on leave.`);
            continue;
          }
          const type = leaveTypes.find((t) => t.id === entry.leaveTypeId);
          if (!type || !type.isActive) {
            problems.push(`Choose which kind of leave ${who} is on.`);
            continue;
          }
          leaveTypeId = type.id;
        }

        const note = entry.note !== undefined ? entry.note.trim() || null : rec?.note ?? null;
        if (
          rec &&
          rec.source === AttendanceSource.MANUAL &&
          rec.status === entry.status &&
          rec.leaveTypeId === leaveTypeId &&
          rec.note === note
        ) {
          continue;
        }
        const target = rec ?? m.create(AttendanceRecord, { employeeId: e.id, date: dto.date, createdBy: user.id });
        Object.assign(target, {
          businessUnitId: rec?.businessUnitId ?? unit.id,
          status: entry.status,
          restDay,
          leaveTypeId,
          leaveRequestId: null,
          source: AttendanceSource.MANUAL,
          note,
          updatedBy: user.id,
        });
        writes.push(() => m.save(target));
      }
      if (problems.length) throw new BadRequestException(problems.join(' '));
      for (const w of writes) await w();
    });
    return this.sheet(dto.businessUnitId, dto.date, user);
  }

  // --- Month register -------------------------------------------------------------

  private async buildRegister(m: EntityManager, employees: Employee[], unitIdForHolidays: string | null, month: string) {
    const { from, to } = monthBounds(month);
    const ids = employees.map((e) => e.id);
    const records = ids.length
      ? await m
          .createQueryBuilder(AttendanceRecord, 'a')
          .leftJoinAndSelect('a.leaveType', 'lt')
          .where('a.employeeId IN (:...ids)', { ids })
          .andWhere('a.date BETWEEN :from AND :to', { from, to })
          .getMany()
      : [];
    const unitIds = [...new Set([...employees.map((e) => e.businessUnitId), ...(unitIdForHolidays ? [unitIdForHolidays] : [])])];
    const holidays = await holidaysFor(m, unitIds, from, to);
    const ledgers = await this.leave.ledgers(m, employees, yearOf(from));

    return employees.map((e) => {
      const own = records.filter((r) => r.employeeId === e.id);
      const coverage = ledgers.get(e.id)?.coverage ?? new Map<IsoDate, boolean>();
      const cal = calendarFor(e, holidays.get(e.businessUnitId) ?? new Set());
      const days: (ClassifiedDay & { leaveType: string | null })[] = eachDay(from, to).map((date) => {
        const rec = own.find((r) => r.date === date);
        const day = classifyDay(
          date,
          e,
          cal,
          rec ? { status: rec.status, restDay: rec.restDay, covered: coverage.get(date) ?? false } : undefined,
        );
        return { ...day, leaveType: rec?.leaveType?.code ?? null };
      });
      return { employee: e, days, summary: summarizeDays(days) };
    });
  }

  async register(businessUnitId: string, month: string, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const unit = await this.unit(m, businessUnitId, user);
    const { from, to } = monthBounds(month);
    const employees = await this.sheetEmployees(m, unit.id, from, to);
    const rows = await this.buildRegister(m, employees, unit.id, month);
    const holidays = await holidayNames(m, unit.id, from, to);
    const today = businessDate();
    return {
      unit: { id: unit.id, code: unit.code, name: unit.name },
      month,
      from,
      to,
      calendar: eachDay(from, to).map((date) => ({
        date,
        weekday: weekday(date),
        holiday: holidays.get(date) ?? null,
        future: date > today,
      })),
      employees: rows.map(({ employee: e, days, summary }) => ({
        id: e.id,
        employeeCode: e.employeeCode,
        fullName: e.fullName,
        designation: e.designation?.name ?? null,
        department: e.department?.name ?? null,
        weeklyOffDay: e.weeklyOffDay,
        days: days.map((d) => ({ date: d.date, kind: d.date > today && d.kind === 'UNMARKED' ? 'FUTURE' : d.kind, leaveType: d.leaveType })),
        summary: { ...summary, unmarked: days.filter((d) => d.kind === 'UNMARKED' && d.date <= today).length },
      })),
    };
  }

  /** One employee's month — the register row, plus each day's detail. */
  async employeeMonth(employeeId: string, month: string, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const employee = await loadEmployee(m, employeeId, user);
    const [row] = await this.buildRegister(m, [employee], null, month);
    const { from, to } = monthBounds(month);
    const records = await m.find(AttendanceRecord, {
      where: { employeeId, date: In(eachDay(from, to)) },
      relations: { leaveType: true, businessUnit: true },
    });
    const holidays = await holidayNames(m, employee.businessUnitId, from, to);
    const names = await userNames(m, records.flatMap((r) => [r.createdBy, r.updatedBy]));
    const today = businessDate();
    return {
      month,
      employee: { id: employee.id, fullName: employee.fullName, weeklyOffDay: employee.weeklyOffDay },
      summary: { ...row.summary, unmarked: row.days.filter((d) => d.kind === 'UNMARKED' && d.date <= today).length },
      days: row.days.map((d) => {
        const rec = records.find((r) => r.date === d.date);
        return {
          date: d.date,
          weekday: weekday(d.date),
          kind: d.date > today && d.kind === 'UNMARKED' ? 'FUTURE' : d.kind,
          restReason: d.restReason,
          holiday: holidays.get(d.date) ?? null,
          leaveType: rec?.leaveType?.name ?? null,
          source: rec?.source ?? null,
          note: rec?.note ?? null,
          unitCode: rec && rec.businessUnitId !== employee.businessUnitId ? rec.businessUnit.code : null,
          markedByName: rec ? names.get(rec.updatedBy ?? rec.createdBy ?? '') ?? null : null,
        };
      }),
    };
  }

  // --- Today, across units ------------------------------------------------------------

  /** For the Attendance screen's landing view: how far each unit is with today's sheet. */
  async today(user: AuthenticatedUser, date = businessDate()) {
    const m = this.dataSource.manager;
    const scope = visibleUnitIds(user);
    const units = await m.find(BusinessUnit, {
      where: scope ? { id: In(scope.length ? scope : [NIL]), isActive: true } : { isActive: true },
      order: { code: 'ASC' },
    });
    const unitIds = units.map((u) => u.id);
    const employees = unitIds.length
      ? await m
          .createQueryBuilder(Employee, 'e')
          .where('e.businessUnitId IN (:...unitIds)', { unitIds })
          .andWhere('e.joinDate <= :date AND (e.exitDate IS NULL OR e.exitDate >= :date)', { date })
          .getMany()
      : [];
    const records = employees.length
      ? await m.find(AttendanceRecord, { where: { employeeId: In(employees.map((e) => e.id)), date } })
      : [];
    const holidays = await holidaysFor(m, unitIds, date, date);
    return {
      date,
      units: units
        .map((u) => {
          const staff = employees.filter((e) => e.businessUnitId === u.id);
          const cal = holidays.get(u.id) ?? new Set<IsoDate>();
          const working = staff.filter((e) => {
            const rec = records.find((r) => r.employeeId === e.id);
            return rec ? !rec.restDay : !restReason(date, calendarFor(e, cal));
          });
          const recs = records.filter((r) => staff.some((e) => e.id === r.employeeId));
          const by = (s: AttendanceStatus) => recs.filter((r) => r.status === s).length;
          return {
            id: u.id,
            code: u.code,
            name: u.name,
            headcount: staff.length,
            expected: working.length,
            marked: working.filter((e) => recs.some((r) => r.employeeId === e.id)).length,
            present: by(AttendanceStatus.PRESENT) + by(AttendanceStatus.HALF_DAY),
            absent: by(AttendanceStatus.ABSENT),
            onLeave: by(AttendanceStatus.LEAVE),
          };
        })
        .filter((u) => u.headcount > 0 || !scope),
    };
  }
}

