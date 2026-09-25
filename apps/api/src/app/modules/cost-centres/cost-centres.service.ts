import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Not } from 'typeorm';
import { CostCentreCharge, Permission } from '@multizoo/types';
import { fromPaisa, toPaisa } from '@multizoo/utils';
import type { AuthenticatedUser } from '../users/users.service';
import { hasPermission, visibleUnitIds } from '../../../common/scope/unit-scope';
import { Partner } from '../allocation/entities/partner.entity';
import { BusinessUnit } from '../business-units/entities/business-unit.entity';
import { CostCentre } from './entities/cost-centre.entity';
import { rollupCostCentre } from './cost-centre-math';
import { CostCentreReportQueryDto, CreateCostCentreDto, UpdateCostCentreDto } from './dto/cost-centre.dto';

/**
 * Cost centres (architecture plan Part 03 §10, M10): the tags spending is
 * routed by. A centre charged to a partner moves money off a unit's P&L
 * onto that partner's profit — so only a Partner may point one at a
 * partner (roles table: profit-share decisions are the Partners').
 */
@Injectable()
export class CostCentresService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async list() {
    const m = this.dataSource.manager;
    const centres = await m.find(CostCentre, {
      relations: { partner: true, businessUnit: true },
      order: { isActive: 'DESC', code: 'ASC' },
    });
    const spent: { id: string; spent: string; entries: string }[] = await m.query(
      `SELECT l."costCentreId" AS id, COALESCE(SUM(l.debit - l.credit), 0) AS spent, COUNT(DISTINCT l."entryId") AS entries
         FROM journal_lines l JOIN accounts a ON a.id = l."accountId"
        WHERE l."costCentreId" IS NOT NULL AND l."crossCharge" = false AND a.type = 'EXPENSE'
        GROUP BY l."costCentreId"`,
    );
    return centres.map((c) => {
      const s = spent.find((x) => x.id === c.id);
      return {
        ...this.shape(c),
        spent: fromPaisa(toPaisa(String(s?.spent ?? '0'))),
        entryCount: Number(s?.entries ?? 0),
      };
    });
  }

  async findOne(id: string) {
    const c = await this.dataSource.manager.findOne(CostCentre, { where: { id }, relations: { partner: true, businessUnit: true } });
    if (!c) throw new NotFoundException('Cost centre not found');
    return this.shape(c);
  }

  async create(dto: CreateCostCentreDto, user: AuthenticatedUser) {
    const id = await this.dataSource.transaction(async (m) => {
      const code = dto.code.trim();
      await this.assertCodeFree(m, code);
      const route = await this.resolveRoute(m, dto.chargeTo, dto.partnerId ?? null, user);
      await this.assertUnit(m, dto.businessUnitId ?? null);
      const saved = await m.save(
        m.create(CostCentre, {
          code,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          ...route,
          businessUnitId: dto.businessUnitId ?? null,
          createdBy: user.id,
        }),
      );
      return saved.id;
    });
    return this.findOne(id);
  }

  async update(id: string, dto: UpdateCostCentreDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const c = await m.findOne(CostCentre, { where: { id } });
      if (!c) throw new NotFoundException('Cost centre not found');
      const routingChanges =
        (dto.chargeTo !== undefined && dto.chargeTo !== c.chargeTo) ||
        (dto.partnerId !== undefined && dto.partnerId !== c.partnerId);
      // Whatever its route, a centre that charges a partner is a Partner's to change.
      if ((routingChanges || c.chargeTo === CostCentreCharge.PARTNER) && !hasPermission(user, Permission.RULES_EDIT_ALLOCATION)) {
        throw new ForbiddenException('Only a Partner can change a cost centre that charges a partner’s profit.');
      }
      if (dto.code !== undefined && dto.code.trim() !== c.code) {
        await this.assertCodeFree(m, dto.code.trim(), c.id);
        c.code = dto.code.trim();
      }
      if (dto.name !== undefined) c.name = dto.name.trim();
      if (dto.description !== undefined) c.description = dto.description?.trim() || null;
      if (routingChanges) {
        const route = await this.resolveRoute(m, dto.chargeTo ?? c.chargeTo, dto.partnerId !== undefined ? dto.partnerId : c.partnerId, user);
        c.chargeTo = route.chargeTo;
        c.partnerId = route.partnerId;
      }
      if (dto.businessUnitId !== undefined) {
        await this.assertUnit(m, dto.businessUnitId);
        c.businessUnitId = dto.businessUnitId;
      }
      if (dto.isActive !== undefined) c.isActive = dto.isActive;
      c.updatedBy = user.id;
      await m.save(c);
    });
    return this.findOne(id);
  }

  /**
   * What the centre spent, by category and month, and who bore it — the
   * unit's P&L or a partner's profit. Reversals net out.
   */
  async report(id: string, q: CostCentreReportQueryDto, user: AuthenticatedUser) {
    const centre = await this.findOne(id);
    const params: unknown[] = [id];
    const where: string[] = [];
    if (q.from) where.push(`e."entryDate" >= $${params.push(q.from)}`);
    if (q.to) where.push(`e."entryDate" <= $${params.push(q.to)}`);
    if (q.businessUnitId) where.push(`l."businessUnitId" = $${params.push(q.businessUnitId)}`);
    const scope = visibleUnitIds(user);
    if (scope) where.push(`l."businessUnitId" = ANY($${params.push(scope.length ? scope : ['00000000-0000-0000-0000-000000000000'])})`);
    const rows: { month: string; category: string; unit: string; amount: string; charged_to: string | null }[] = await this.dataSource.query(
      `SELECT to_char(e."entryDate", 'YYYY-MM') AS month,
              COALESCE(parent.name || ' › ', '') || a.name AS category,
              bu.code AS unit,
              SUM(l.debit - l.credit) AS amount,
              (SELECT p."shortName" FROM journal_lines x
                 JOIN accounts xa ON xa.id = x."accountId"
                 JOIN partners p ON p.id = xa."partnerId"
                WHERE x."entryId" = l."entryId" AND x."crossCharge" = true AND xa.type = 'EQUITY'
                LIMIT 1) AS charged_to
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l."entryId"
         JOIN accounts a ON a.id = l."accountId"
         LEFT JOIN accounts parent ON parent.id = a."parentId"
         JOIN business_units bu ON bu.id = l."businessUnitId"
        WHERE l."costCentreId" = $1 AND l."crossCharge" = false AND a.type = 'EXPENSE'
          ${where.map((w) => `AND ${w}`).join(' ')}
        GROUP BY 1, 2, 3, l."entryId"`,
      params,
    );
    const lines = rows.map((r) => ({
      month: r.month,
      category: r.category,
      amount: fromPaisa(toPaisa(String(r.amount))),
      chargedTo: r.charged_to,
    }));
    const byUnit = new Map<string, bigint>();
    for (const r of rows) byUnit.set(r.unit, (byUnit.get(r.unit) ?? 0n) + toPaisa(String(r.amount)));
    return {
      costCentre: centre,
      from: q.from ?? null,
      to: q.to ?? null,
      ...rollupCostCentre(lines),
      byUnit: [...byUnit.entries()].filter(([, v]) => v !== 0n).map(([unit, v]) => ({ unit, amount: fromPaisa(v) })),
    };
  }

  private shape(c: CostCentre) {
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      description: c.description,
      chargeTo: c.chargeTo,
      partner: c.partner ? { id: c.partner.id, name: c.partner.name, shortName: c.partner.shortName } : null,
      businessUnit: c.businessUnit ? { id: c.businessUnit.id, code: c.businessUnit.code, name: c.businessUnit.name } : null,
      isActive: c.isActive,
      createdAt: c.createdAt,
    };
  }

  private async assertCodeFree(m: EntityManager, code: string, exceptId?: string) {
    const clash = await m.findOne(CostCentre, { where: { code, ...(exceptId ? { id: Not(exceptId) } : {}) } });
    if (clash) throw new ConflictException(`Cost centre ${code} already exists.`);
  }

  private async assertUnit(m: EntityManager, unitId: string | null) {
    if (!unitId) return;
    const unit = await m.findOne(BusinessUnit, { where: { id: unitId } });
    if (!unit) throw new BadRequestException('Business unit not found');
  }

  private async resolveRoute(m: EntityManager, chargeTo: CostCentreCharge, partnerId: string | null, user: AuthenticatedUser) {
    if (chargeTo === CostCentreCharge.UNIT) return { chargeTo, partnerId: null };
    if (!hasPermission(user, Permission.RULES_EDIT_ALLOCATION)) {
      throw new ForbiddenException('Only a Partner can route a cost centre to a partner’s profit.');
    }
    if (!partnerId) throw new BadRequestException('Choose the partner it’s charged to.');
    const partner = await m.findOne(Partner, { where: { id: partnerId, deletedAt: IsNull() } });
    if (!partner || !partner.isActive) throw new BadRequestException('Choose an active partner.');
    return { chargeTo, partnerId: partner.id };
  }
}
