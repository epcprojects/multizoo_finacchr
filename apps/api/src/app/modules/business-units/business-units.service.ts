import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  AccountSubtype,
  JournalEntryKind,
  JournalEntrySource,
  LIQUID_SUBTYPES,
} from '@multizoo/types';
import { businessDate, fromPaisa, toPaisa } from '@multizoo/utils';
import { BusinessUnit } from './entities/business-unit.entity';
import { Account } from '../accounts/entities/account.entity';
import { UserBusinessUnit } from '../users/entities/user.business-unit.entity';
import { JournalService } from '../journal/journal.service';
import { LedgerService } from '../ledger/ledger.service';
import type { AuthenticatedUser } from '../users/users.service';
import {
  assertUnitAccess,
  hasAllUnitAccess,
  visibleUnitIds,
} from '../../../common/scope/unit-scope';
import {
  OPENING_BALANCE_EQUITY_CODE,
  RESERVE_BUCKET_CATALOG,
  provisionUnitAccounts,
} from '../accounts/chart-of-accounts';
import {
  CreateBusinessUnitDto,
  UpdateBusinessUnitDto,
} from './dto/business-unit.dto';

@Injectable()
export class BusinessUnitsService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,

    @InjectRepository(BusinessUnit)
    private readonly unitRepo: Repository<BusinessUnit>,

    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,

    private readonly journalService: JournalService,
    private readonly ledgerService: LedgerService,
  ) {}

  async list(user: AuthenticatedUser) {
    const scope = visibleUnitIds(user);
    if (scope && !scope.length) return [];
    const units = await this.unitRepo.find({
      where: scope ? { id: In(scope) } : {},
      order: { code: 'ASC' },
    });
    if (!units.length) return [];

    const accounts = await this.accountRepo.find({
      where: { businessUnitId: In(units.map((u) => u.id)) },
      order: { code: 'ASC' },
    });

    return units.map((u) => {
      const own = accounts.filter((a) => a.businessUnitId === u.id);
      return {
        id: u.id,
        code: u.code,
        name: u.name,
        type: u.type,
        description: u.description,
        isActive: u.isActive,
        createdAt: u.createdAt,
        accountCount: own.length,
        reserveBuckets: own
          .filter((a) => a.subtype === AccountSubtype.RESERVE && a.isActive)
          .map((a) => a.name.replace(/ Reserve$/, '')),
      };
    });
  }

  templates() {
    return { reserveCatalog: RESERVE_BUCKET_CATALOG };
  }

  /**
   * The "Add Business Unit" wizard (plan Part 04: "a wizard, not a
   * migration"): the unit, its full standard account set, its reserve
   * buckets and — optionally — its opening cash/bank/wallet balances, all in
   * one transaction. Either everything exists afterwards or nothing does.
   */
  async create(dto: CreateBusinessUnitDto, user: AuthenticatedUser) {
    const code = dto.code.trim().toUpperCase();

    const unitId = await this.dataSource.transaction(async (m) => {
      const codeClash = await m.findOne(BusinessUnit, { where: { code }, withDeleted: true });
      if (codeClash) throw new ConflictException(`Code ${code} is already used by ${codeClash.name}.`);

      const nameClash = await m
        .createQueryBuilder(BusinessUnit, 'u')
        .where('UPPER(u.name) = UPPER(:name)', { name: dto.name.trim() })
        .getOne();
      if (nameClash) throw new ConflictException(`A business unit named "${nameClash.name}" already exists.`);

      const unit = await m.save(
        m.create(BusinessUnit, {
          code,
          name: dto.name.trim(),
          type: dto.type,
          description: dto.description?.trim() || null,
          createdBy: user.id,
        }),
      );

      const accounts = await provisionUnitAccounts(m, unit, dto.reserveBuckets, user.id);

      // Someone who manages units but isn't all-units must still be able to
      // see the unit they just created.
      let actor = user;
      if (!hasAllUnitAccess(user)) {
        await m.save(m.create(UserBusinessUnit, { userId: user.id, businessUnitId: unit.id, assignedBy: user.id }));
        actor = { ...user, businessUnitIds: [...user.businessUnitIds, unit.id] };
      }

      const ob = dto.openingBalances;
      if (ob) {
        const lines: { accountId: string; debit?: string; credit?: string; memo?: string }[] = [];
        let total = 0n;
        const add = (subtype: AccountSubtype, amount?: string) => {
          if (!amount || toPaisa(amount) === 0n) return;
          const account = accounts.find((a) => a.subtype === subtype);
          if (!account) {
            throw new BadRequestException(`This unit has no ${subtype.toLowerCase()} account for an opening balance.`);
          }
          lines.push({ accountId: account.id, debit: amount });
          total += toPaisa(amount);
        };
        add(AccountSubtype.CASH, ob.cash);
        add(AccountSubtype.BANK, ob.bank);
        add(AccountSubtype.WALLET, ob.wallet);

        if (lines.length) {
          const equity = await m.findOne(Account, { where: { code: OPENING_BALANCE_EQUITY_CODE } });
          if (!equity) throw new BadRequestException('Opening Balance Equity account is missing — run the seed.');
          lines.push({ accountId: equity.id, credit: fromPaisa(total) });

          await this.journalService.post(
            {
              entryDate: ob.asOfDate,
              businessUnitId: unit.id,
              description: `Opening balances — ${unit.name}`,
              kind: JournalEntryKind.OPENING_BALANCE,
              lines,
            },
            actor,
            { manager: m, source: JournalEntrySource.SYSTEM },
          );
        }
      }
      return unit.id;
    });

    const actor = { ...user, businessUnitIds: [...user.businessUnitIds, unitId] };
    return (await this.list(actor)).find((u) => u.id === unitId);
  }

  async update(id: string, dto: UpdateBusinessUnitDto, user: AuthenticatedUser) {
    const unit = await this.unitRepo.findOne({ where: { id } });
    if (!unit) throw new NotFoundException('Business unit not found');
    assertUnitAccess(user, id);

    if (dto.name && dto.name.trim().toUpperCase() !== unit.name.toUpperCase()) {
      const clash = await this.unitRepo
        .createQueryBuilder('u')
        .where('UPPER(u.name) = UPPER(:name)', { name: dto.name.trim() })
        .andWhere('u.id != :id', { id })
        .getOne();
      if (clash) throw new ConflictException(`A business unit named "${clash.name}" already exists.`);
    }

    if (dto.isActive === false && unit.isActive) {
      const liquid = await this.accountRepo.find({
        where: { businessUnitId: id, subtype: In([...LIQUID_SUBTYPES]) },
      });
      const balances = await this.ledgerService.balancesFor(liquid, { asOf: businessDate() });
      const nonZero = liquid.filter((a) => balances.get(a.id) !== '0.00');
      if (nonZero.length) {
        throw new BadRequestException(
          `${unit.name} still holds money in ${nonZero.map((a) => a.name).join(', ')} — move it before deactivating the unit.`,
        );
      }
    }

    if (dto.name !== undefined) unit.name = dto.name.trim();
    if (dto.type !== undefined) unit.type = dto.type;
    if (dto.description !== undefined) unit.description = dto.description.trim() || null;
    if (dto.isActive !== undefined) unit.isActive = dto.isActive;
    unit.updatedBy = user.id;
    await this.unitRepo.save(unit);

    return (await this.list(user)).find((u) => u.id === id);
  }
}
