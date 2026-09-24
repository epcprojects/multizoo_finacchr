import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Not } from 'typeorm';
import { AllocationRuleStatus } from '@multizoo/types';
import { businessDate, fromPaisa, toPaisa } from '@multizoo/utils';
import { Account } from '../accounts/entities/account.entity';
import { User } from '../users/entities/user.entity';
import { LedgerService } from '../ledger/ledger.service';
import type { AuthenticatedUser } from '../users/users.service';
import { visibleUnitIds } from '../../../common/scope/unit-scope';
import {
  ensurePartnerEquity,
  partnerEquityName,
  partnerReserveName,
} from '../accounts/reserves';
import { AllocationLine } from './entities/allocation-rule.entity';
import { Partner } from './entities/partner.entity';
import { CreatePartnerDto, UpdatePartnerDto } from './dto/allocation.dto';

/**
 * Partners: who shares in each unit's residual income, and their accounts.
 * Each partner gets a group-wide Capital & Current account (equity) on
 * creation; a profit reserve per unit appears once a rule gives them a
 * share there.
 */
@Injectable()
export class PartnersService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
  ) {}

  async list(user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const partners = await m.find(Partner, { order: { isActive: 'DESC', name: 'ASC' } });
    if (!partners.length) return [];

    const scope = visibleUnitIds(user);
    const accounts = await m.find(Account, {
      where: { partnerId: In(partners.map((p) => p.id)) },
      relations: { businessUnit: true },
      order: { code: 'ASC' },
    });
    const visible = accounts.filter((a) => !a.businessUnitId || !scope || scope.includes(a.businessUnitId));
    const balances = await this.ledger.balancesFor(visible, { asOf: businessDate() });

    const userIds = partners.map((p) => p.userId).filter(Boolean) as string[];
    const users = userIds.length ? await m.find(User, { where: { id: In(userIds) }, withDeleted: true }) : [];

    // Units whose rule in force (or awaiting approval) gives the partner a share.
    const shares: { partnerId: string; code: string; status: AllocationRuleStatus }[] = await m.query(
      `SELECT DISTINCT l."partnerId", bu.code, r.status
         FROM allocation_lines l
         JOIN allocation_tranches t ON t.id = l."trancheId"
         JOIN allocation_rules r ON r.id = t."ruleId"
         JOIN business_units bu ON bu.id = r."businessUnitId"
        WHERE l."partnerId" IS NOT NULL
          AND r.status IN ('APPROVED', 'PENDING_APPROVAL')
          AND (r.status = 'PENDING_APPROVAL' OR r.id IN (
                SELECT DISTINCT ON (r2."businessUnitId") r2.id
                  FROM allocation_rules r2
                 WHERE r2.status = 'APPROVED' AND r2."effectiveFrom" <= $1
                 ORDER BY r2."businessUnitId", r2."effectiveFrom" DESC, r2.version DESC))`,
      [businessDate()],
    );

    return partners.map((p) => {
      const own = visible.filter((a) => a.partnerId === p.id);
      const equity = own.find((a) => !a.businessUnitId);
      const reserves = own.filter((a) => a.businessUnitId);
      const reserveTotal = reserves.reduce((s, a) => s + toPaisa(balances.get(a.id) ?? '0.00'), 0n);
      return {
        id: p.id,
        name: p.name,
        shortName: p.shortName,
        isActive: p.isActive,
        notes: p.notes,
        userId: p.userId,
        userName: users.find((u) => u.id === p.userId)?.fullName ?? null,
        equityAccount: equity
          ? { id: equity.id, code: equity.code, name: equity.name, balance: balances.get(equity.id) ?? '0.00' }
          : null,
        profitReserves: reserves.map((a) => ({
          id: a.id,
          code: a.code,
          name: a.name,
          businessUnit: a.businessUnit ? { id: a.businessUnit.id, code: a.businessUnit.code, name: a.businessUnit.name } : null,
          balance: balances.get(a.id) ?? '0.00',
        })),
        profitReservesTotal: fromPaisa(reserveTotal),
        shareIn: shares
          .filter((s) => s.partnerId === p.id)
          .map((s) => ({ unitCode: s.code, pending: s.status === AllocationRuleStatus.PENDING_APPROVAL })),
      };
    });
  }

  private async assertUnique(m: EntityManager, name: string, shortName: string, exceptId?: string) {
    const clash = await m
      .createQueryBuilder(Partner, 'p')
      .withDeleted()
      .where('(UPPER(p.name) = UPPER(:name) OR UPPER(p.shortName) = UPPER(:shortName))', { name, shortName })
      .andWhere(exceptId ? 'p.id != :exceptId' : '1=1', { exceptId })
      .getOne();
    if (clash) throw new ConflictException(`A partner named ${clash.name} (${clash.shortName}) already exists.`);
  }

  private async assertUserFree(m: EntityManager, userId: string, exceptId?: string) {
    const u = await m.findOne(User, { where: { id: userId } });
    if (!u) throw new BadRequestException('That user does not exist.');
    const taken = await m.findOne(Partner, { where: { userId, ...(exceptId ? { id: Not(exceptId) } : {}) } });
    if (taken) throw new ConflictException(`${u.fullName} is already linked to ${taken.name}.`);
  }

  async create(dto: CreatePartnerDto, user: AuthenticatedUser) {
    const name = dto.name.trim();
    const shortName = dto.shortName.trim().toUpperCase();
    const id = await this.dataSource.transaction(async (m) => {
      await this.assertUnique(m, name, shortName);
      if (dto.userId) await this.assertUserFree(m, dto.userId);
      const partner = await m.save(
        m.create(Partner, {
          name,
          shortName,
          userId: dto.userId ?? null,
          notes: dto.notes?.trim() || null,
          createdBy: user.id,
        }),
      );
      await ensurePartnerEquity(m, partner, user.id);
      return partner.id;
    });
    return (await this.list(user)).find((p) => p.id === id);
  }

  async update(id: string, dto: UpdatePartnerDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const partner = await m.findOne(Partner, { where: { id } });
      if (!partner) throw new NotFoundException('Partner not found');

      const name = dto.name?.trim() ?? partner.name;
      const shortName = dto.shortName?.trim().toUpperCase() ?? partner.shortName;
      if (name !== partner.name || shortName !== partner.shortName) await this.assertUnique(m, name, shortName, id);
      if (dto.userId) await this.assertUserFree(m, dto.userId, id);

      if (dto.isActive === false && partner.isActive) {
        const inUse = await m
          .createQueryBuilder(AllocationLine, 'l')
          .innerJoin('l.tranche', 't')
          .innerJoin('t.rule', 'r')
          .innerJoin('r.businessUnit', 'bu')
          .select('DISTINCT bu.code', 'code')
          .where('l.partnerId = :id', { id })
          .andWhere('r.status IN (:...statuses)', {
            statuses: [AllocationRuleStatus.PENDING_APPROVAL, AllocationRuleStatus.DRAFT, AllocationRuleStatus.APPROVED],
          })
          .andWhere(`(r.status != 'APPROVED' OR r."effectiveFrom" >= (
             SELECT COALESCE(MAX(r3."effectiveFrom"), '1900-01-01') FROM allocation_rules r3
              WHERE r3."businessUnitId" = r."businessUnitId" AND r3.status = 'APPROVED' AND r3."effectiveFrom" <= :today))`, {
            today: businessDate(),
          })
          .getRawMany<{ code: string }>();
        if (inUse.length) {
          throw new BadRequestException(
            `${partner.name} still has a share in ${inUse.map((u) => u.code).join(', ')}. Approve a rule version without them first.`,
          );
        }
      }

      if (name !== partner.name) {
        // Their accounts carry their name — keep them readable.
        const accounts = await m.find(Account, { where: { partnerId: id }, withDeleted: true });
        for (const a of accounts) {
          a.name = a.businessUnitId ? partnerReserveName(name) : partnerEquityName(name);
          a.updatedBy = user.id;
        }
        await m.save(accounts);
      }

      partner.name = name;
      partner.shortName = shortName;
      if (dto.userId !== undefined) partner.userId = dto.userId;
      if (dto.notes !== undefined) partner.notes = dto.notes.trim() || null;
      if (dto.isActive !== undefined) partner.isActive = dto.isActive;
      partner.updatedBy = user.id;
      await m.save(partner);
    });
    return (await this.list(user)).find((p) => p.id === id);
  }
}
