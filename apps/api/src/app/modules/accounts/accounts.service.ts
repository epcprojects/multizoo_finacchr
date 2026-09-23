import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository } from 'typeorm';
import { AccountClassUnitRule } from '@multizoo/types';
import { businessDate, fromPaisa, toPaisa } from '@multizoo/utils';
import { Account } from './entities/account.entity';
import { AccountClass } from './entities/account-class.entity';
import { BusinessUnit } from '../business-units/entities/business-unit.entity';
import { LedgerService } from '../ledger/ledger.service';
import type { AuthenticatedUser } from '../users/users.service';
import {
  assertUnitAccess,
  visibleUnitIds,
} from '../../../common/scope/unit-scope';
import { generateAccountCode } from './chart-of-accounts';
import {
  CreateAccountDto,
  ListAccountsQueryDto,
  UpdateAccountDto,
} from './dto/account.dto';

/** Enforces a class's unit rule for one account. */
export function unitRuleViolation(cls: AccountClass, hasUnit: boolean): string | null {
  if (cls.unitRule === AccountClassUnitRule.UNIT_REQUIRED && !hasUnit) {
    return `${cls.name} accounts must belong to a business unit.`;
  }
  if (cls.unitRule === AccountClassUnitRule.GROUP_ONLY && hasUnit) {
    return `${cls.name} accounts are shared across the group — the business unit is recorded on each entry instead.`;
  }
  return null;
}

@Injectable()
export class AccountsService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,

    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,

    @InjectRepository(AccountClass)
    private readonly classRepo: Repository<AccountClass>,

    @InjectRepository(BusinessUnit)
    private readonly unitRepo: Repository<BusinessUnit>,

    private readonly ledgerService: LedgerService,
  ) {}

  /**
   * The chart of accounts the caller can see, each with today's balance.
   * Headings carry the rolled-up balance of their children. For group-wide
   * accounts the balance only counts lines in the caller's units (or the
   * one unit filtered on).
   */
  async list(query: ListAccountsQueryDto, user: AuthenticatedUser) {
    const scope = visibleUnitIds(user);
    if (query.businessUnitId) assertUnitAccess(user, query.businessUnitId);

    const qb = this.accountRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.businessUnit', 'bu')
      .leftJoinAndSelect('a.parent', 'p')
      .leftJoinAndSelect('a.accountClass', 'cls')
      .orderBy('a.code', 'ASC');

    if (query.businessUnitId) {
      qb.andWhere('(a.businessUnitId IS NULL OR a.businessUnitId = :unitId)', {
        unitId: query.businessUnitId,
      });
    } else if (scope) {
      if (scope.length) {
        qb.andWhere('(a.businessUnitId IS NULL OR a.businessUnitId IN (:...scope))', { scope });
      } else {
        qb.andWhere('a.businessUnitId IS NULL');
      }
    }
    if (query.type) qb.andWhere('a.type = :type', { type: query.type });
    if (!query.includeInactive) qb.andWhere('a.isActive = true');
    const search = query.search?.trim();
    if (search) {
      qb.andWhere(
        new Brackets((w) =>
          w.where('a.name ILIKE :q', { q: `%${search}%` }).orWhere('a.code ILIKE :q'),
        ),
      );
    }

    const accounts = await qb.getMany();
    const balances = await this.ledgerService.balancesFor(accounts, {
      asOf: businessDate(),
      unitIds: query.businessUnitId ? [query.businessUnitId] : scope,
    });

    const rolled = new Map<string, bigint>();
    for (const a of accounts) {
      const own = toPaisa(balances.get(a.id) ?? '0.00');
      rolled.set(a.id, (rolled.get(a.id) ?? 0n) + own);
      if (a.parentId) rolled.set(a.parentId, (rolled.get(a.parentId) ?? 0n) + own);
    }

    return accounts.map((a) => ({
      ...this.ledgerService.shapeAccount(a),
      balance: fromPaisa(rolled.get(a.id) ?? 0n),
    }));
  }

  async findOne(id: string, user: AuthenticatedUser) {
    const account = await this.ledgerService.accountForUser(id, user);
    const unitIds = account.businessUnitId ? null : visibleUnitIds(user);
    const balances = await this.ledgerService.balancesFor([account], { asOf: businessDate(), unitIds });
    return { ...this.ledgerService.shapeAccount(account), balance: balances.get(account.id) ?? '0.00' };
  }

  async create(dto: CreateAccountDto, user: AuthenticatedUser) {
    const cls = await this.classRepo.findOne({ where: { id: dto.classId } });
    if (!cls || !cls.isActive) throw new BadRequestException('Account class not found or inactive');

    let unit: BusinessUnit | null = null;
    if (dto.businessUnitId) {
      unit = await this.unitRepo.findOne({ where: { id: dto.businessUnitId } });
      if (!unit) throw new BadRequestException('Business unit not found');
      assertUnitAccess(user, unit.id);
    }
    const ruleError = unitRuleViolation(cls, Boolean(unit));
    if (ruleError) throw new BadRequestException(ruleError);

    let parent: Account | null = null;
    if (dto.parentId) {
      parent = await this.accountRepo.findOne({ where: { id: dto.parentId } });
      if (!parent) throw new BadRequestException('Heading account not found');
      if (parent.type !== cls.type) {
        throw new BadRequestException(`A ${cls.type.toLowerCase()} account can't sit under a ${parent.type.toLowerCase()} heading.`);
      }
      if (parent.isPostable) {
        throw new BadRequestException(`${parent.name} takes entries directly, so it can't be used as a heading.`);
      }
      if ((parent.businessUnitId ?? null) !== (unit?.id ?? null)) {
        throw new BadRequestException('A sub-account must belong to the same business unit as its heading.');
      }
    }

    await this.assertNameFree(dto.name, unit?.id ?? null);

    const id = await this.dataSource.transaction(async (m) => {
      const code = dto.code?.trim().toUpperCase() || (await generateAccountCode(m, cls, unit, parent));
      await this.assertCodeFree(code);
      const saved = await m.save(
        m.create(Account, {
          code,
          name: dto.name.trim(),
          type: cls.type,
          classId: cls.id,
          businessUnitId: unit?.id ?? null,
          parentId: parent?.id ?? null,
          isPostable: dto.isPostable ?? true,
          isSystem: false,
          systemKey: null,
          description: dto.description?.trim() || null,
          createdBy: user.id,
        }),
      );
      return saved.id;
    });
    return this.findOne(id, user);
  }

  async update(id: string, dto: UpdateAccountDto, user: AuthenticatedUser) {
    const account = await this.ledgerService.accountForUser(id, user);

    if (account.isSystem && (dto.name !== undefined || dto.isActive === false || dto.classId)) {
      throw new BadRequestException(`${account.name} is a system account — its name, class and status are fixed.`);
    }

    if (dto.code !== undefined) {
      const code = dto.code.trim().toUpperCase();
      if (code !== account.code) {
        await this.assertCodeFree(code, id);
        account.code = code;
      }
    }

    if (dto.name !== undefined && dto.name.trim().toUpperCase() !== account.name.toUpperCase()) {
      await this.assertNameFree(dto.name, account.businessUnitId, id);
    }

    if (dto.classId && dto.classId !== account.classId) {
      const cls = await this.classRepo.findOne({ where: { id: dto.classId } });
      if (!cls || !cls.isActive) throw new BadRequestException('Account class not found or inactive');
      if (cls.type !== account.type) {
        throw new BadRequestException(
          `${account.name} is in ${account.type.toLowerCase()}s; ${cls.name} is a ${cls.type.toLowerCase()} class. An account can't change bucket — create a new account and move the balance with an entry.`,
        );
      }
      const ruleError = unitRuleViolation(cls, Boolean(account.businessUnitId));
      if (ruleError) throw new BadRequestException(ruleError);
      account.classId = cls.id;
      account.accountClass = cls;
    }

    if (dto.isActive === false && account.isActive) {
      const raw = (await this.ledgerService.rawBalances({ accountIds: [id] })).get(id) ?? 0n;
      if (raw !== 0n) {
        throw new BadRequestException(
          `${account.name} still has a balance of ${fromPaisa(raw < 0n ? -raw : raw)} — move it to another account before deactivating.`,
        );
      }
      const activeChildren = await this.accountRepo.count({ where: { parentId: id, isActive: true } });
      if (activeChildren) {
        throw new BadRequestException(`Deactivate the ${activeChildren} sub-account(s) under ${account.name} first.`);
      }
    }

    if (dto.name !== undefined) account.name = dto.name.trim();
    if (dto.description !== undefined) account.description = dto.description.trim() || null;
    if (dto.isActive !== undefined) account.isActive = dto.isActive;
    account.updatedBy = user.id;

    await this.accountRepo.save(account);
    return this.findOne(id, user);
  }

  private async assertCodeFree(code: string, exceptId?: string) {
    const clash = await this.accountRepo.findOne({ where: { code }, withDeleted: true });
    if (clash && clash.id !== exceptId) {
      throw new ConflictException(`Account code ${code} is already in use (${clash.name}).`);
    }
  }

  private async assertNameFree(name: string, unitId: string | null, exceptId?: string) {
    const qb = this.accountRepo
      .createQueryBuilder('a')
      .where('UPPER(a.name) = UPPER(:name)', { name: name.trim() })
      .andWhere(unitId ? 'a.businessUnitId = :unitId' : 'a.businessUnitId IS NULL', { unitId });
    if (exceptId) qb.andWhere('a.id != :exceptId', { exceptId });
    const clash = await qb.getOne();
    if (clash) throw new ConflictException(`An account named "${clash.name}" already exists here (${clash.code}).`);
  }
}
