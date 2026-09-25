import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, In } from 'typeorm';
import { BonusPoolStatus, BonusTier } from '@multizoo/types';
import { businessDate, fromPaisa, toPaisa } from '@multizoo/utils';
import type { AuthenticatedUser } from '../users/users.service';
import { BusinessUnit } from '../business-units/entities/business-unit.entity';
import { Employee } from '../hr/entities/employee.entity';
import { userNames } from '../hr/hr-common';
import { monthBounds } from '../hr/hr-math';
import { assertUnitAccess, visibleUnitIds } from '../../../common/scope/unit-scope';
import { BonusPool, BonusPoolMember } from './entities/bonus.entity';
import { Payslip } from './entities/payroll.entity';
import { monthLabel, payrollPolicyFor } from './payroll-common';
import { bonusPool } from './payroll-math';
import { CreateBonusPoolDto, ListBonusPoolsQueryDto, SetBonusMembersDto, UpdateBonusPoolDto } from './dto/payroll.dto';

const NIL = '00000000-0000-0000-0000-000000000000';

/**
 * The incentive engine (module M7, Fig. 9): a commission pool from
 * qualifying sales, split by bonus tier, paid through payroll. Qualifying
 * sales are entered here until sales capture (Module 7) can supply them.
 */
@Injectable()
export class BonusService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  private calc(pool: BonusPool) {
    return bonusPool(toPaisa(pool.qualifyingSales), pool.commissionPct, pool.tiers, pool.members ?? []);
  }

  async list(query: ListBonusPoolsQueryDto, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const scope = visibleUnitIds(user);
    const qb = m
      .createQueryBuilder(BonusPool, 'p')
      .leftJoinAndSelect('p.businessUnit', 'bu')
      .leftJoinAndSelect('p.members', 'mem')
      .orderBy('p.month', 'DESC')
      .addOrderBy('p.createdAt', 'DESC');
    if (query.businessUnitId) qb.andWhere('p.businessUnitId = :u', { u: query.businessUnitId });
    if (query.month) qb.andWhere('p.month = :mo', { mo: query.month });
    if (query.status) qb.andWhere('p.status = :s', { s: query.status });
    if (scope) qb.andWhere('p.businessUnitId IN (:...scope)', { scope: scope.length ? scope : [NIL] });
    const pools = await qb.getMany();
    return pools.map((p) => {
      const r = this.calc(p);
      return {
        id: p.id,
        month: p.month,
        title: p.title,
        businessUnit: { id: p.businessUnit.id, code: p.businessUnit.code, name: p.businessUnit.name },
        qualifyingSales: p.qualifyingSales,
        commissionPct: String(Number(p.commissionPct)),
        pool: fromPaisa(r.pool),
        distributed: fromPaisa(r.pool - r.undistributed),
        undistributed: fromPaisa(r.undistributed),
        members: p.members.length,
        status: p.status,
      };
    });
  }

  private async load(m: EntityManager, id: string, user: AuthenticatedUser) {
    const pool = await m.findOne(BonusPool, { where: { id }, relations: { businessUnit: true, members: { employee: { designation: true } } } });
    if (!pool) throw new NotFoundException('Commission pool not found');
    assertUnitAccess(user, pool.businessUnitId);
    return pool;
  }

  async findOne(id: string, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const pool = await this.load(m, id, user);
    const r = this.calc(pool);
    const names = await userNames(m, [pool.createdBy, pool.approvedBy]);
    const paidIn = await this.paidIn(m, pool);
    return {
      id: pool.id,
      month: pool.month,
      title: pool.title,
      basis: pool.basis,
      businessUnit: { id: pool.businessUnit.id, code: pool.businessUnit.code, name: pool.businessUnit.name },
      qualifyingSales: pool.qualifyingSales,
      commissionPct: String(Number(pool.commissionPct)),
      policyVersion: pool.policyVersion,
      status: pool.status,
      pool: fromPaisa(r.pool),
      undistributed: fromPaisa(r.undistributed),
      tiers: pool.tiers.map((t) => {
        const calc = r.tiers.find((x) => x.tier === t.tier);
        return {
          ...t,
          amount: fromPaisa(calc?.amount ?? 0n),
          headcount: calc?.headcount ?? 0,
          totalUnits: calc?.totalUnits ?? '0.00',
          perUnit: calc?.perUnit ?? null,
          distributed: fromPaisa(calc?.distributed ?? 0n),
        };
      }),
      members: [...pool.members]
        .sort((a, b) => a.tier.localeCompare(b.tier) || a.employee.fullName.localeCompare(b.employee.fullName))
        .map((mem) => ({
          employeeId: mem.employeeId,
          employeeCode: mem.employee.employeeCode,
          fullName: mem.employee.fullName,
          designation: mem.employee.designation?.name ?? null,
          tier: mem.tier,
          units: String(Number(mem.units)),
          amount: fromPaisa(r.shares.find((s) => s.employeeId === mem.employeeId)?.amount ?? 0n),
        })),
      paidInPayslips: paidIn,
      createdAt: pool.createdAt,
      createdByName: pool.createdBy ? names.get(pool.createdBy) ?? null : null,
      approvedAt: pool.approvedAt,
      approvedByName: pool.approvedBy ? names.get(pool.approvedBy) ?? null : null,
    };
  }

  /** How many finalised payslips carry a share of this pool. */
  private async paidIn(m: EntityManager, pool: BonusPool): Promise<number> {
    return m
      .createQueryBuilder(Payslip, 'p')
      .where('p.month = :month', { month: pool.month })
      .andWhere(`p.details->'poolShares' @> :ref::jsonb`, { ref: JSON.stringify([{ poolId: pool.id }]) })
      .getCount();
  }

  /** People who could be in a unit's pool that month: employed at some point in it, with a tier. */
  private async candidates(m: EntityManager, unitId: string, month: string) {
    const { from, to } = monthBounds(month);
    return m
      .createQueryBuilder(Employee, 'e')
      .leftJoinAndSelect('e.designation', 'des')
      .where('e.businessUnitId = :unitId', { unitId })
      .andWhere('e.joinDate <= :to', { to })
      .andWhere(new Brackets((b) => b.where('e.exitDate IS NULL').orWhere('e.exitDate >= :from', { from })))
      .orderBy('e.fullName')
      .getMany();
  }

  async create(dto: CreateBonusPoolDto, user: AuthenticatedUser) {
    assertUnitAccess(user, dto.businessUnitId);
    if (dto.month > businessDate().slice(0, 7)) throw new BadRequestException('A pool is paid with a month that has started.');
    const id = await this.dataSource.transaction(async (m) => {
      const unit = await m.findOne(BusinessUnit, { where: { id: dto.businessUnitId } });
      if (!unit || !unit.isActive) throw new BadRequestException('That business unit is not active.');
      const policy = await payrollPolicyFor(m, dto.month);
      const pool = await m.save(
        m.create(BonusPool, {
          businessUnitId: unit.id,
          month: dto.month,
          title: dto.title.trim(),
          basis: dto.basis?.trim() || null,
          qualifyingSales: fromPaisa(toPaisa(dto.qualifyingSales)),
          commissionPct: policy.commissionPct,
          tiers: policy.bonusTiers,
          policyVersion: policy.version,
          status: BonusPoolStatus.DRAFT,
          createdBy: user.id,
        }),
      );
      if (dto.addEveryone) {
        const inPool = new Set(policy.bonusTiers.map((t) => t.tier));
        const people = (await this.candidates(m, unit.id, dto.month)).filter((e) => inPool.has(e.bonusTier ?? e.designation.bonusTier));
        await m.save(
          people.map((e) => m.create(BonusPoolMember, { poolId: pool.id, employeeId: e.id, tier: e.bonusTier ?? e.designation.bonusTier, units: '1' })),
        );
      }
      return pool.id;
    });
    return this.findOne(id, user);
  }

  private async draft(m: EntityManager, id: string, user: AuthenticatedUser) {
    const pool = await this.load(m, id, user);
    if (pool.status !== BonusPoolStatus.DRAFT) throw new ConflictException('This pool is approved — move it back to draft to change it.');
    return pool;
  }

  async update(id: string, dto: UpdateBonusPoolDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const pool = await this.draft(m, id, user);
      await m.update(BonusPool, { id: pool.id }, {
        title: dto.title?.trim() ?? pool.title,
        basis: dto.basis !== undefined ? dto.basis.trim() || null : pool.basis,
        qualifyingSales: dto.qualifyingSales !== undefined ? fromPaisa(toPaisa(dto.qualifyingSales)) : pool.qualifyingSales,
        updatedBy: user.id,
      });
    });
    return this.findOne(id, user);
  }

  async setMembers(id: string, dto: SetBonusMembersDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const pool = await this.draft(m, id, user);
      const ids = dto.members.map((x) => x.employeeId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException('Each person can be in the pool once.');
      const allowed = new Set((await this.candidates(m, pool.businessUnitId, pool.month)).map((e) => e.id));
      const tiers = new Set(pool.tiers.map((t) => t.tier));
      for (const x of dto.members) {
        if (!allowed.has(x.employeeId)) throw new BadRequestException(`Everyone in the pool must work at ${pool.businessUnit.name} in ${monthLabel(pool.month)}.`);
        if (!tiers.has(x.tier) || x.tier === BonusTier.NONE) throw new BadRequestException(`${x.tier} isn't one of this pool's tiers.`);
      }
      await m.delete(BonusPoolMember, { poolId: pool.id });
      if (dto.members.length) {
        await m.save(dto.members.map((x) => m.create(BonusPoolMember, { poolId: pool.id, employeeId: x.employeeId, tier: x.tier, units: x.units })));
      }
      await m.update(BonusPool, { id: pool.id }, { updatedBy: user.id });
    });
    return this.findOne(id, user);
  }

  /** Approved shares are added to each person's Bonus / Incentive for the pool's month. */
  async approve(id: string, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const pool = await this.draft(m, id, user);
      if (!pool.members.length) throw new BadRequestException('Add the people the pool is shared between first.');
      const paid = await m.find(Payslip, { where: { month: pool.month, employeeId: In(pool.members.map((x) => x.employeeId)) } });
      if (paid.length) {
        throw new ConflictException(
          `${monthLabel(pool.month)} pay is already finalised for ${paid.map((p) => p.fullName).join(', ')} — reopen that run, or pay this pool with the next month.`,
        );
      }
      await m.update(BonusPool, { id: pool.id }, { status: BonusPoolStatus.APPROVED, approvedBy: user.id, approvedAt: new Date(), updatedBy: user.id });
    });
    return this.findOne(id, user);
  }

  async unapprove(id: string, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const pool = await this.load(m, id, user);
      if (pool.status !== BonusPoolStatus.APPROVED) throw new ConflictException('This pool is still a draft.');
      if (await this.paidIn(m, pool)) throw new ConflictException('Shares of this pool are on finalised payslips — reopen that payroll run first.');
      await m.update(BonusPool, { id: pool.id }, { status: BonusPoolStatus.DRAFT, approvedBy: null, approvedAt: null, updatedBy: user.id });
    });
    return this.findOne(id, user);
  }

  async remove(id: string, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const pool = await this.draft(m, id, user);
      await m.delete(BonusPool, { id: pool.id });
    });
    return { deleted: true };
  }
}
