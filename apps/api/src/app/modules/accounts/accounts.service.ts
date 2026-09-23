import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { businessDate, fromPaisa, toPaisa } from '@multizoo/utils';
import { Account } from './entities/account.entity';
import { BusinessUnit } from '../business-units/entities/business-unit.entity';
import { LedgerService } from '../ledger/ledger.service';
import type { AuthenticatedUser } from '../users/users.service';
import {
  assertUnitAccess,
  visibleUnitIds,
} from '../../../common/scope/unit-scope';
import {
  GROUP_ONLY_SUBTYPES,
  SUBTYPE_CODE_BASE,
  SUBTYPE_TO_TYPE,
  UNIT_OWNED_SUBTYPES,
  subtypeCodeBandEnd,
} from './chart-of-accounts';
import {
  CreateAccountDto,
  ListAccountsQueryDto,
  UpdateAccountDto,
} from './dto/account.dto';

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,

    @InjectRepository(BusinessUnit)
    private readonly unitRepo: Repository<BusinessUnit>,

    private readonly ledgerService: LedgerService,
  ) {}

  /**
   * The chart of accounts the caller can see, each with today's balance.
   * Group headings carry the rolled-up balance of their children. For
   * group-wide accounts the balance only counts lines in the caller's units
   * (or the one unit filtered on).
   */
  async list(query: ListAccountsQueryDto, user: AuthenticatedUser) {
    const scope = visibleUnitIds(user);
    if (query.businessUnitId) assertUnitAccess(user, query.businessUnitId);

    const qb = this.accountRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.businessUnit', 'bu')
      .leftJoinAndSelect('a.parent', 'p')
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

    // Roll children up into their group heading.
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
    const type = SUBTYPE_TO_TYPE[dto.subtype];
    let unit: BusinessUnit | null = null;

    if (UNIT_OWNED_SUBTYPES.includes(dto.subtype) && !dto.businessUnitId) {
      throw new BadRequestException('Cash, bank, wallet and reserve accounts must belong to a business unit.');
    }
    if (GROUP_ONLY_SUBTYPES.includes(dto.subtype) && dto.businessUnitId) {
      throw new BadRequestException(
        'Income and expense accounts are shared across the group — the business unit is recorded on each transaction instead.',
      );
    }
    if (dto.businessUnitId) {
      unit = await this.unitRepo.findOne({ where: { id: dto.businessUnitId } });
      if (!unit) throw new BadRequestException('Business unit not found');
      assertUnitAccess(user, unit.id);
    }

    let parent: Account | null = null;
    if (dto.parentId) {
      parent = await this.accountRepo.findOne({ where: { id: dto.parentId } });
      if (!parent) throw new BadRequestException('Parent account not found');
      if (parent.type !== type) {
        throw new BadRequestException(`A ${type.toLowerCase()} account can't sit under a ${parent.type.toLowerCase()} heading.`);
      }
      if (parent.isPostable) {
        throw new BadRequestException(`${parent.name} takes postings directly, so it can't be used as a group heading.`);
      }
      if ((parent.businessUnitId ?? null) !== (unit?.id ?? null)) {
        throw new BadRequestException('A sub-account must belong to the same business unit as its heading.');
      }
    }

    const code = dto.code ?? (await this.nextCode(dto.subtype, unit, parent));
    const clash = await this.accountRepo.findOne({ where: { code }, withDeleted: true });
    if (clash) throw new ConflictException(`Account code ${code} is already in use (${clash.name}).`);

    const nameClash = await this.accountRepo
      .createQueryBuilder('a')
      .where('UPPER(a.name) = UPPER(:name)', { name: dto.name.trim() })
      .andWhere(unit ? 'a.businessUnitId = :unitId' : 'a.businessUnitId IS NULL', { unitId: unit?.id })
      .getOne();
    if (nameClash) throw new ConflictException(`An account named "${nameClash.name}" already exists here (${nameClash.code}).`);

    const saved = await this.accountRepo.save(
      this.accountRepo.create({
        code,
        name: dto.name.trim(),
        type,
        subtype: dto.subtype,
        businessUnitId: unit?.id ?? null,
        parentId: parent?.id ?? null,
        isPostable: dto.isPostable ?? true,
        isSystem: false,
        description: dto.description?.trim() || null,
        createdBy: user.id,
      }),
    );
    return this.findOne(saved.id, user);
  }

  async update(id: string, dto: UpdateAccountDto, user: AuthenticatedUser) {
    const account = await this.ledgerService.accountForUser(id, user);

    if (account.isSystem && (dto.name !== undefined || dto.isActive === false)) {
      throw new BadRequestException(`${account.name} is a system account — it can't be renamed or deactivated.`);
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

  /**
   * Next free code in the right numbering band — ZOO-1510, ZOO-1520 for a
   * unit's reserves; 5161 under the 5100 feed heading; the next top-level
   * slot otherwise. Steps by 10 while there's room, so gaps stay for
   * accounts inserted later.
   */
  private async nextCode(subtype: Account['subtype'], unit: BusinessUnit | null, parent: Account | null) {
    const base = SUBTYPE_CODE_BASE[subtype];
    let prefix = '';
    let start: number;
    let end: number;

    if (unit) {
      prefix = `${unit.code}-`;
      start = base;
      end = subtypeCodeBandEnd(subtype);
    } else if (parent && /^\d+$/.test(parent.code)) {
      start = Number(parent.code) + 1;
      end = Number(parent.code) + 99;
    } else {
      start = base;
      end = Math.floor(base / 1000) * 1000 + 999;
    }

    const codes = (await this.accountRepo.find({ select: { code: true }, withDeleted: true }))
      .map((a) => a.code)
      .filter((c) => c.startsWith(prefix))
      .map((c) => c.slice(prefix.length))
      .filter((c) => /^\d+$/.test(c))
      .map(Number);
    const taken = new Set(codes);
    const inBand = codes.filter((n) => n >= start && n <= end);

    let next = inBand.length ? Math.max(...inBand) : start - 10;
    next = next + 10 <= end ? next + 10 : next + 1;
    if (next < start) next = start;
    while (taken.has(next)) next += 1;
    if (next > end) {
      throw new BadRequestException('No free account codes left in this range — enter a code manually.');
    }
    return `${prefix}${next}`;
  }
}
