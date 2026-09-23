import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { AccountClassUnitRule, AccountType } from '@multizoo/types';
import { AccountClass } from './entities/account-class.entity';
import { Account } from './entities/account.entity';
import { ChartSettings } from './entities/chart-settings.entity';
import type { AuthenticatedUser } from '../users/users.service';
import { getChartSettings } from './chart-of-accounts';
import { buildCode, validatePattern } from './account-codes';
import {
  CreateAccountClassDto,
  UpdateAccountClassDto,
  UpdateChartSettingsDto,
} from './dto/account-class.dto';

type ClassShape = Pick<
  AccountClass,
  'type' | 'unitRule' | 'codeStart' | 'codeEnd' | 'isLiquid' | 'isReserve' | 'isReconcilable' | 'provisionForNewUnits'
>;

/**
 * The rules that keep a class meaningful. They're what the ledger relies
 * on: cash position is per unit, so money-on-hand must be unit-owned; a
 * reserve can't also be spendable cash; and so on.
 */
export function classRuleViolation(c: ClassShape): string | null {
  if (c.codeStart > c.codeEnd) return 'The code range must start before it ends.';
  if (c.isLiquid && c.isReserve) return 'A class can be money on hand or a reserve, not both.';
  if ((c.isLiquid || c.isReserve) && c.type !== AccountType.ASSET) {
    return 'Money-on-hand and reserve classes must be Assets.';
  }
  if ((c.isLiquid || c.isReserve) && c.unitRule !== AccountClassUnitRule.UNIT_REQUIRED) {
    return 'Money-on-hand and reserve accounts must belong to a business unit — cash position is per unit.';
  }
  if (c.isReconcilable && c.type !== AccountType.ASSET && c.type !== AccountType.LIABILITY) {
    return 'Only asset or liability accounts can be reconciled against a count or statement.';
  }
  if (c.provisionForNewUnits && (c.isReserve || c.unitRule === AccountClassUnitRule.GROUP_ONLY)) {
    return 'Only unit-owned, non-reserve classes can be created automatically for new units.';
  }
  return null;
}

export function keyFromName(name: string): string {
  return (
    name
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 36) || 'CLASS'
  );
}

@Injectable()
export class AccountClassesService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,

    @InjectRepository(AccountClass)
    private readonly classRepo: Repository<AccountClass>,

    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,

    @InjectRepository(ChartSettings)
    private readonly settingsRepo: Repository<ChartSettings>,
  ) {}

  async list(includeInactive = false) {
    const classes = await this.classRepo.find({
      where: includeInactive ? {} : { isActive: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    const counts = await this.accountRepo
      .createQueryBuilder('a')
      .select('a.classId', 'classId')
      .addSelect('COUNT(*)', 'count')
      .groupBy('a.classId')
      .getRawMany<{ classId: string; count: string }>();
    const countOf = new Map(counts.map((c) => [c.classId, Number(c.count)]));
    return classes.map((c) => ({ ...this.shape(c), accountCount: countOf.get(c.id) ?? 0 }));
  }

  shape(c: AccountClass) {
    return {
      id: c.id,
      key: c.key,
      name: c.name,
      type: c.type,
      unitRule: c.unitRule,
      codeStart: c.codeStart,
      codeEnd: c.codeEnd,
      isLiquid: c.isLiquid,
      isReserve: c.isReserve,
      isReconcilable: c.isReconcilable,
      provisionForNewUnits: c.provisionForNewUnits,
      defaultAccountName: c.defaultAccountName,
      sortOrder: c.sortOrder,
      isSystem: c.isSystem,
      isActive: c.isActive,
      description: c.description,
    };
  }

  async create(dto: CreateAccountClassDto, user: AuthenticatedUser) {
    const draft = {
      type: dto.type,
      unitRule: dto.unitRule,
      codeStart: dto.codeStart,
      codeEnd: dto.codeEnd,
      isLiquid: dto.isLiquid ?? false,
      isReserve: dto.isReserve ?? false,
      isReconcilable: dto.isReconcilable ?? false,
      provisionForNewUnits: dto.provisionForNewUnits ?? false,
    };
    const violation = classRuleViolation(draft);
    if (violation) throw new BadRequestException(violation);
    await this.assertNameFree(dto.name);

    let key = keyFromName(dto.name);
    for (let n = 2; await this.classRepo.findOne({ where: { key }, withDeleted: true }); n++) {
      key = `${keyFromName(dto.name).slice(0, 34)}_${n}`;
    }

    const saved = await this.classRepo.save(
      this.classRepo.create({
        ...draft,
        key,
        name: dto.name.trim(),
        defaultAccountName: dto.defaultAccountName?.trim() || null,
        sortOrder: dto.sortOrder ?? 100,
        description: dto.description?.trim() || null,
        isSystem: false,
        createdBy: user.id,
      }),
    );
    return { ...this.shape(saved), accountCount: 0 };
  }

  async update(id: string, dto: UpdateAccountClassDto, user: AuthenticatedUser) {
    const cls = await this.classRepo.findOne({ where: { id } });
    if (!cls) throw new NotFoundException('Account class not found');

    const accountCount = await this.accountRepo.count({ where: { classId: id }, withDeleted: true });

    if (dto.type !== undefined && dto.type !== cls.type) {
      if (cls.isSystem) throw new BadRequestException(`${cls.name} is a built-in class — its bucket is fixed.`);
      if (accountCount) {
        throw new BadRequestException(
          `${accountCount} account(s) already use ${cls.name}, so its bucket can't change — that would move their balances between Assets/Liabilities/…`,
        );
      }
    }
    if (dto.name && dto.name.trim().toUpperCase() !== cls.name.toUpperCase()) await this.assertNameFree(dto.name, id);

    const next: ClassShape = {
      type: dto.type ?? cls.type,
      unitRule: dto.unitRule ?? cls.unitRule,
      codeStart: dto.codeStart ?? cls.codeStart,
      codeEnd: dto.codeEnd ?? cls.codeEnd,
      isLiquid: dto.isLiquid ?? cls.isLiquid,
      isReserve: dto.isReserve ?? cls.isReserve,
      isReconcilable: dto.isReconcilable ?? cls.isReconcilable,
      provisionForNewUnits: dto.provisionForNewUnits ?? cls.provisionForNewUnits,
    };
    const violation = classRuleViolation(next);
    if (violation) throw new BadRequestException(violation);

    // Existing accounts must still satisfy the unit rule.
    if (next.unitRule === AccountClassUnitRule.UNIT_REQUIRED) {
      const n = await this.accountRepo.count({ where: { classId: id, businessUnitId: IsNull() } });
      if (n) throw new BadRequestException(`${n} group-wide ${cls.name} account(s) exist — they'd break the "unit required" rule.`);
    }
    if (next.unitRule === AccountClassUnitRule.GROUP_ONLY) {
      const n = await this.accountRepo.count({ where: { classId: id, businessUnitId: Not(IsNull()) } });
      if (n) throw new BadRequestException(`${n} unit-owned ${cls.name} account(s) exist — they'd break the "group-wide only" rule.`);
    }

    if (dto.isActive === false && cls.isActive) {
      const active = await this.accountRepo.count({ where: { classId: id, isActive: true } });
      if (active) throw new BadRequestException(`Deactivate or reclassify the ${active} active ${cls.name} account(s) first.`);
    }

    Object.assign(cls, next);
    if (dto.name !== undefined) cls.name = dto.name.trim();
    if (dto.defaultAccountName !== undefined) cls.defaultAccountName = dto.defaultAccountName.trim() || null;
    if (dto.sortOrder !== undefined) cls.sortOrder = dto.sortOrder;
    if (dto.description !== undefined) cls.description = dto.description.trim() || null;
    if (dto.isActive !== undefined) cls.isActive = dto.isActive;
    cls.updatedBy = user.id;
    const saved = await this.classRepo.save(cls);
    return { ...this.shape(saved), accountCount };
  }

  private async assertNameFree(name: string, exceptId?: string) {
    const qb = this.classRepo
      .createQueryBuilder('c')
      .where('UPPER(c.name) = UPPER(:name)', { name: name.trim() });
    if (exceptId) qb.andWhere('c.id != :exceptId', { exceptId });
    const clash = await qb.getOne();
    if (clash) throw new ConflictException(`A class named "${clash.name}" already exists.`);
  }

  // --- Numbering settings ---------------------------------------------------

  async getSettings() {
    const s = await getChartSettings(this.dataSource.manager);
    return this.shapeSettings(s);
  }

  async updateSettings(dto: UpdateChartSettingsDto, user: AuthenticatedUser) {
    const s = await getChartSettings(this.dataSource.manager);
    // Codes are upper-case; the tokens are too, so upper-casing is safe.
    const unitCodePattern = dto.unitCodePattern?.trim().toUpperCase() ?? s.unitCodePattern;
    const groupCodePattern = dto.groupCodePattern?.trim().toUpperCase() ?? s.groupCodePattern;

    const unitError = validatePattern(unitCodePattern, { requireUnit: true });
    if (unitError) throw new BadRequestException(`Unit accounts: ${unitError}`);
    const groupError = validatePattern(groupCodePattern, { requireUnit: false });
    if (groupError) throw new BadRequestException(`Group-wide accounts: ${groupError}`);
    if (groupCodePattern.includes('{UNIT}')) {
      throw new BadRequestException('Group-wide accounts have no unit, so their pattern cannot use {UNIT}.');
    }

    s.unitCodePattern = unitCodePattern;
    s.groupCodePattern = groupCodePattern;
    if (dto.codeStep !== undefined) s.codeStep = dto.codeStep;
    s.updatedAt = new Date();
    s.updatedBy = user.id;
    return this.shapeSettings(await this.settingsRepo.save(s));
  }

  private shapeSettings(s: ChartSettings) {
    return {
      unitCodePattern: s.unitCodePattern,
      groupCodePattern: s.groupCodePattern,
      codeStep: s.codeStep,
      updatedAt: s.updatedAt,
      examples: {
        unit: buildCode(s.unitCodePattern, 1100, 'CAFE'),
        group: buildCode(s.groupCodePattern, 5110),
      },
    };
  }
}
