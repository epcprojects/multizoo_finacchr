import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { DisciplinaryStatus, DisciplinaryType, Permission } from '@multizoo/types';
import { businessDate, toPaisa } from '@multizoo/utils';
import type { AuthenticatedUser } from '../users/users.service';
import { assertUnitAccess, hasPermission, visibleUnitIds } from '../../../common/scope/unit-scope';
import { Employee } from './entities/employee.entity';
import { DisciplinaryRecord } from './entities/attendance.entity';
import { assertNotSelf, isEmployedOn, loadEmployee, userNames } from './hr-common';
import { CreateDisciplinaryDto, ListDisciplinaryQueryDto } from './dto/hr.dto';

const NIL = '00000000-0000-0000-0000-000000000000';

/**
 * Fines and warnings (architecture plan Part 07 §04; roles table: a Branch
 * Manager raises, the Accountant approves). Only approved fines reach
 * payroll's Fine column (Module 5).
 */
@Injectable()
export class DisciplinaryService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async list(query: ListDisciplinaryQueryDto, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const scope = visibleUnitIds(user);
    const qb = m
      .createQueryBuilder(DisciplinaryRecord, 'd')
      .leftJoinAndSelect('d.employee', 'e')
      .leftJoinAndSelect('e.designation', 'des')
      .leftJoinAndSelect('d.businessUnit', 'bu')
      .orderBy('d.incidentDate', 'DESC')
      .addOrderBy('d.createdAt', 'DESC')
      .take(500);
    if (query.businessUnitId) qb.andWhere('d.businessUnitId = :u', { u: query.businessUnitId });
    if (query.employeeId) qb.andWhere('d.employeeId = :e', { e: query.employeeId });
    if (query.status) qb.andWhere('d.status = :s', { s: query.status });
    if (scope) qb.andWhere('d.businessUnitId IN (:...scope)', { scope: scope.length ? scope : [NIL] });
    const rows = await qb.getMany();
    const names = await userNames(m, rows.flatMap((r) => [r.createdBy, r.reviewedBy]));
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
      type: r.type,
      incidentDate: r.incidentDate,
      reason: r.reason,
      amount: r.amount,
      status: r.status,
      createdAt: r.createdAt,
      createdBy: r.createdBy,
      raisedByName: r.createdBy ? names.get(r.createdBy) ?? null : null,
      reviewedAt: r.reviewedAt,
      reviewedByName: r.reviewedBy ? names.get(r.reviewedBy) ?? null : null,
      reviewNote: r.reviewNote,
    }));
  }

  private async one(id: string, user: AuthenticatedUser) {
    return (await this.list({}, user)).find((r) => r.id === id);
  }

  async create(dto: CreateDisciplinaryDto, user: AuthenticatedUser) {
    const canApprove = hasPermission(user, Permission.DISCIPLINARY_APPROVE);
    if (dto.approve && !canApprove) throw new ForbiddenException('Only an approver can approve it in the same step.');
    const id = await this.dataSource.transaction(async (m) => {
      const employee = await loadEmployee(m, dto.employeeId, user);
      if (dto.incidentDate > businessDate()) throw new BadRequestException('The incident date is in the future.');
      if (!isEmployedOn(employee, dto.incidentDate)) {
        throw new BadRequestException(`${employee.fullName} wasn't employed on ${dto.incidentDate}.`);
      }
      if (dto.type === DisciplinaryType.FINE && (!dto.amount || toPaisa(dto.amount) <= 0n)) {
        throw new BadRequestException('A fine needs an amount.');
      }
      if (dto.type === DisciplinaryType.WARNING && dto.amount) {
        throw new BadRequestException('A warning has no amount — record a fine instead.');
      }
      if (dto.approve) assertNotSelf(employee, user, 'a fine or warning');
      const record = await m.save(
        m.create(DisciplinaryRecord, {
          employeeId: employee.id,
          businessUnitId: employee.businessUnitId,
          type: dto.type,
          incidentDate: dto.incidentDate,
          reason: dto.reason.trim(),
          amount: dto.type === DisciplinaryType.FINE ? dto.amount : null,
          status: dto.approve ? DisciplinaryStatus.APPROVED : DisciplinaryStatus.PENDING_APPROVAL,
          reviewedBy: dto.approve ? user.id : null,
          reviewedAt: dto.approve ? new Date() : null,
          createdBy: user.id,
        }),
      );
      return record.id;
    });
    return this.one(id, user);
  }

  private async pending(m: EntityManager, id: string, user: AuthenticatedUser) {
    const record = await m.findOne(DisciplinaryRecord, { where: { id } });
    if (!record) throw new NotFoundException('Record not found');
    assertUnitAccess(user, record.businessUnitId);
    if (record.status !== DisciplinaryStatus.PENDING_APPROVAL) {
      throw new ConflictException(`This record is already ${record.status.toLowerCase().replace('_', ' ')}.`);
    }
    return record;
  }

  async review(id: string, approve: boolean, note: string | undefined, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const record = await this.pending(m, id, user);
      const employee = await m.findOneOrFail(Employee, { where: { id: record.employeeId } });
      assertNotSelf(employee, user, 'a fine or warning');
      record.status = approve ? DisciplinaryStatus.APPROVED : DisciplinaryStatus.REJECTED;
      record.reviewedBy = user.id;
      record.reviewedAt = new Date();
      record.reviewNote = note?.trim() || null;
      record.updatedBy = user.id;
      await m.save(record);
    });
    return this.one(id, user);
  }

  async withdraw(id: string, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const record = await this.pending(m, id, user);
      if (record.createdBy !== user.id && !hasPermission(user, Permission.DISCIPLINARY_APPROVE)) {
        throw new ForbiddenException('Only whoever raised it, or an approver, can withdraw it.');
      }
      record.status = DisciplinaryStatus.WITHDRAWN;
      record.updatedBy = user.id;
      await m.save(record);
    });
    return this.one(id, user);
  }
}
