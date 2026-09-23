import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  AccountSubtype,
  AccountType,
  JournalEntryKind,
  LIQUID_SUBTYPES,
} from '@multizoo/types';
import { businessDate, fromPaisa, isIsoDate, toPaisa } from '@multizoo/utils';
import { Account } from '../accounts/entities/account.entity';
import { BusinessUnit } from '../business-units/entities/business-unit.entity';
import { JournalLine } from '../journal/entities/journal-line.entity';
import { User } from '../users/entities/user.entity';
import { CashReconciliation } from './entities/cash-reconciliation.entity';
import type { AuthenticatedUser } from '../users/users.service';
import {
  assertUnitAccess,
  visibleUnitIds,
} from '../../../common/scope/unit-scope';
import { runningBalances, toNormalBalance } from '../journal/ledger-math';
import { formatEntryNo } from '../journal/journal.service';
import { CreateReconciliationDto } from './dto/ledger.dto';

type BalanceFilter = {
  accountIds?: string[];
  /** Inclusive. */
  asOf?: string;
  /** Exclusive — used for a ledger's opening balance. */
  before?: string;
  /** null = every unit. Filters on the LINE's unit, so group-wide income/expense accounts are scoped too. */
  unitIds?: string[] | null;
};

/**
 * Everything read-only about the ledger. Balances are never stored — every
 * number here is summed from journal lines at read time.
 */
@Injectable()
export class LedgerService {
  constructor(
    @InjectRepository(JournalLine)
    private readonly lineRepo: Repository<JournalLine>,

    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,

    @InjectRepository(BusinessUnit)
    private readonly unitRepo: Repository<BusinessUnit>,

    @InjectRepository(CashReconciliation)
    private readonly reconRepo: Repository<CashReconciliation>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /** Raw (Σdebit − Σcredit) per account, in paisa. Missing key = no movement. */
  async rawBalances(filter: BalanceFilter = {}): Promise<Map<string, bigint>> {
    if (filter.unitIds && !filter.unitIds.length) return new Map();
    if (filter.accountIds && !filter.accountIds.length) return new Map();

    const qb = this.lineRepo
      .createQueryBuilder('l')
      .innerJoin('l.entry', 'e')
      .select('l.accountId', 'accountId')
      .addSelect('COALESCE(SUM(l.debit), 0)', 'debit')
      .addSelect('COALESCE(SUM(l.credit), 0)', 'credit')
      .groupBy('l.accountId');

    if (filter.accountIds) qb.andWhere('l.accountId IN (:...accountIds)', { accountIds: filter.accountIds });
    if (filter.asOf) qb.andWhere('e.entryDate <= :asOf', { asOf: filter.asOf });
    if (filter.before) qb.andWhere('e.entryDate < :before', { before: filter.before });
    if (filter.unitIds) qb.andWhere('l.businessUnitId IN (:...unitIds)', { unitIds: filter.unitIds });

    const rows = await qb.getRawMany<{ accountId: string; debit: string; credit: string }>();
    return new Map(rows.map((r) => [r.accountId, toPaisa(r.debit) - toPaisa(r.credit)]));
  }

  /** Normal-signed balances as decimal strings, keyed by account id. */
  async balancesFor(accounts: Account[], filter: Omit<BalanceFilter, 'accountIds'> = {}) {
    const raw = await this.rawBalances({ ...filter, accountIds: accounts.map((a) => a.id) });
    return new Map(
      accounts.map((a) => [a.id, fromPaisa(toNormalBalance(raw.get(a.id) ?? 0n, a.type))]),
    );
  }

  /** Loads an account and checks the caller may see it. */
  async accountForUser(id: string, user: AuthenticatedUser): Promise<Account> {
    const account = await this.accountRepo.findOne({
      where: { id },
      relations: { businessUnit: true, parent: true },
    });
    if (!account) throw new NotFoundException('Account not found');
    if (account.businessUnitId) assertUnitAccess(user, account.businessUnitId);
    return account;
  }

  /**
   * The workbook view: Date · Description · Deposit · Withdraw · Balance,
   * with an opening-balance row when a start date is given. For a
   * group-wide account (e.g. Ticket Sales), a unit-scoped user sees only
   * their own units' lines.
   */
  async accountLedger(id: string, user: AuthenticatedUser, from?: string, to?: string) {
    if (from && to && from > to) throw new BadRequestException('from must be on or before to');
    const account = await this.accountForUser(id, user);
    const unitIds = account.businessUnitId ? null : visibleUnitIds(user);

    const openingRaw = from
      ? ((await this.rawBalances({ accountIds: [id], before: from, unitIds })).get(id) ?? 0n)
      : 0n;
    const opening = toNormalBalance(openingRaw, account.type);

    const qb = this.lineRepo
      .createQueryBuilder('l')
      .innerJoin('l.entry', 'e')
      .select('e.id', 'entryId')
      .addSelect('e.entryNo', 'entryNo')
      .addSelect(`to_char(e."entryDate", 'YYYY-MM-DD')`, 'entryDate')
      .addSelect('e.description', 'description')
      .addSelect('e.reference', 'reference')
      .addSelect('e.kind', 'kind')
      .addSelect('e.reversalOfId', 'reversalOfId')
      .addSelect('e.reversedById', 'reversedById')
      .addSelect('l.debit', 'debit')
      .addSelect('l.credit', 'credit')
      .addSelect('l.memo', 'memo')
      .where('l.accountId = :id', { id })
      .orderBy('e.entryDate', 'ASC')
      .addOrderBy('e.entryNo', 'ASC')
      .addOrderBy('l.lineNo', 'ASC');
    if (from) qb.andWhere('e.entryDate >= :from', { from });
    if (to) qb.andWhere('e.entryDate <= :to', { to });
    if (unitIds) {
      if (!unitIds.length) qb.andWhere('1 = 0');
      else qb.andWhere('l.businessUnitId IN (:...unitIds)', { unitIds });
    }

    const rows = await qb.getRawMany<{
      entryId: string;
      entryNo: number;
      entryDate: string;
      description: string;
      reference: string | null;
      kind: JournalEntryKind;
      reversalOfId: string | null;
      reversedById: string | null;
      debit: string;
      credit: string;
      memo: string | null;
    }>();

    const against = await this.counterpartNames(rows.map((r) => r.entryId), id);
    const balances = runningBalances(opening, rows, account.type);

    let totalDebit = 0n;
    let totalCredit = 0n;
    for (const r of rows) {
      totalDebit += toPaisa(r.debit);
      totalCredit += toPaisa(r.credit);
    }

    return {
      account: this.shapeAccount(account),
      from: from ?? null,
      to: to ?? null,
      openingBalance: fromPaisa(opening),
      closingBalance: balances.length ? balances[balances.length - 1] : fromPaisa(opening),
      totalDebit: fromPaisa(totalDebit),
      totalCredit: fromPaisa(totalCredit),
      rows: rows.map((r, i) => ({
        entryId: r.entryId,
        displayNo: formatEntryNo(Number(r.entryNo)),
        entryDate: r.entryDate,
        description: r.description,
        reference: r.reference,
        kind: r.kind,
        memo: r.memo,
        against: against.get(r.entryId) ?? [],
        debit: r.debit,
        credit: r.credit,
        balance: balances[i],
        isReversed: Boolean(r.reversedById),
        isReversal: Boolean(r.reversalOfId),
      })),
    };
  }

  /** For each entry, the names of the OTHER accounts it touched ("Ticket Sales"). */
  private async counterpartNames(entryIds: string[], excludeAccountId: string) {
    const out = new Map<string, string[]>();
    if (!entryIds.length) return out;
    const rows = await this.lineRepo
      .createQueryBuilder('l')
      .innerJoin('l.account', 'a')
      .select('l.entryId', 'entryId')
      .addSelect('a.name', 'name')
      .where('l.entryId IN (:...entryIds)', { entryIds: [...new Set(entryIds)] })
      .andWhere('l.accountId != :excludeAccountId', { excludeAccountId })
      .orderBy('l.lineNo', 'ASC')
      .getRawMany<{ entryId: string; name: string }>();
    for (const r of rows) {
      const names = out.get(r.entryId) ?? [];
      if (!names.includes(r.name)) names.push(r.name);
      out.set(r.entryId, names);
    }
    return out;
  }

  /** The Daily Cash Position report (plan Part 08), live. */
  async cashPosition(user: AuthenticatedUser, asOf = businessDate()) {
    if (!isIsoDate(asOf)) throw new BadRequestException('asOf is not a real date');
    const scope = visibleUnitIds(user);

    const units =
      scope && !scope.length
        ? []
        : await this.unitRepo.find({
            where: scope ? { id: In(scope) } : {},
            order: { code: 'ASC' },
          });
    const unitIds = units.map((u) => u.id);

    const accounts = unitIds.length
      ? await this.accountRepo.find({
          where: { businessUnitId: In(unitIds), subtype: In([...LIQUID_SUBTYPES]) },
          order: { code: 'ASC' },
        })
      : [];
    const balances = await this.balancesFor(accounts, { asOf });

    // Net effect of each of the day's entries on cash/bank/wallet: a
    // transfer nets to zero; opening balances aren't "today's money".
    const flows = unitIds.length
      ? await this.lineRepo.manager.query(
          `SELECT x."businessUnitId",
                  COALESCE(SUM(GREATEST(x.net, 0)), 0)  AS inflow,
                  COALESCE(SUM(GREATEST(-x.net, 0)), 0) AS outflow
             FROM (
               SELECT e.id, e."businessUnitId", SUM(l.debit - l.credit) AS net
                 FROM journal_lines l
                 JOIN journal_entries e ON e.id = l."entryId"
                 JOIN accounts a ON a.id = l."accountId"
                WHERE e."entryDate" = $1
                  AND e.kind <> $2
                  AND a.subtype = ANY($3)
                  AND e."businessUnitId" = ANY($4)
                GROUP BY e.id, e."businessUnitId"
             ) x
            GROUP BY x."businessUnitId"`,
          [asOf, JournalEntryKind.OPENING_BALANCE, [...LIQUID_SUBTYPES], unitIds],
        )
      : [];
    const flowByUnit = new Map<string, { inflow: string; outflow: string }>(
      flows.map((f: { businessUnitId: string; inflow: string; outflow: string }) => [
        f.businessUnitId,
        { inflow: String(f.inflow), outflow: String(f.outflow) },
      ]),
    );

    const zero = () => ({ cash: 0n, bank: 0n, wallet: 0n, inflow: 0n, outflow: 0n });
    const grand = zero();

    const unitRows = units.map((unit) => {
      const t = zero();
      const unitAccounts = accounts
        .filter((a) => a.businessUnitId === unit.id)
        .map((a) => {
          const balance = balances.get(a.id) ?? '0.00';
          const p = toPaisa(balance);
          if (a.subtype === AccountSubtype.CASH) t.cash += p;
          if (a.subtype === AccountSubtype.BANK) t.bank += p;
          if (a.subtype === AccountSubtype.WALLET) t.wallet += p;
          return { id: a.id, code: a.code, name: a.name, subtype: a.subtype, isActive: a.isActive, balance };
        });
      const flow = flowByUnit.get(unit.id);
      t.inflow = flow ? toPaisa(flow.inflow) : 0n;
      t.outflow = flow ? toPaisa(flow.outflow) : 0n;
      (Object.keys(grand) as (keyof typeof grand)[]).forEach((k) => (grand[k] += t[k]));

      return {
        id: unit.id,
        code: unit.code,
        name: unit.name,
        type: unit.type,
        isActive: unit.isActive,
        accounts: unitAccounts,
        cash: fromPaisa(t.cash),
        bank: fromPaisa(t.bank),
        wallet: fromPaisa(t.wallet),
        total: fromPaisa(t.cash + t.bank + t.wallet),
        inflow: fromPaisa(t.inflow),
        outflow: fromPaisa(t.outflow),
      };
    });

    return {
      asOf,
      totals: {
        cash: fromPaisa(grand.cash),
        bank: fromPaisa(grand.bank),
        wallet: fromPaisa(grand.wallet),
        total: fromPaisa(grand.cash + grand.bank + grand.wallet),
        inflow: fromPaisa(grand.inflow),
        outflow: fromPaisa(grand.outflow),
      },
      units: unitRows,
    };
  }

  /** Proof that the books balance: Σ debit balances = Σ credit balances. */
  async trialBalance(user: AuthenticatedUser, asOf = businessDate(), businessUnitId?: string) {
    if (!isIsoDate(asOf)) throw new BadRequestException('asOf is not a real date');
    let unitIds = visibleUnitIds(user);
    if (businessUnitId) {
      assertUnitAccess(user, businessUnitId);
      unitIds = [businessUnitId];
    }

    const raw = await this.rawBalances({ asOf, unitIds });
    const accounts = raw.size
      ? await this.accountRepo.find({
          where: { id: In([...raw.keys()]) },
          relations: { businessUnit: true },
          withDeleted: true,
          order: { code: 'ASC' },
        })
      : [];

    let totalDebit = 0n;
    let totalCredit = 0n;
    const rows = accounts
      .map((a) => {
        const r = raw.get(a.id) ?? 0n;
        const debit = r > 0n ? r : 0n;
        const credit = r < 0n ? -r : 0n;
        totalDebit += debit;
        totalCredit += credit;
        return {
          accountId: a.id,
          code: a.code,
          name: a.name,
          type: a.type,
          businessUnit: a.businessUnit ? a.businessUnit.code : null,
          debit: fromPaisa(debit),
          credit: fromPaisa(credit),
        };
      })
      .filter((row) => row.debit !== '0.00' || row.credit !== '0.00');

    return {
      asOf,
      businessUnitId: businessUnitId ?? null,
      rows,
      totalDebit: fromPaisa(totalDebit),
      totalCredit: fromPaisa(totalCredit),
      isBalanced: totalDebit === totalCredit,
    };
  }

  async listReconciliations(accountId: string, user: AuthenticatedUser) {
    await this.accountForUser(accountId, user);
    const recons = await this.reconRepo.find({
      where: { accountId },
      order: { asOfDate: 'DESC', createdAt: 'DESC' },
    });
    const ids = [...new Set(recons.map((r) => r.createdBy).filter(Boolean) as string[])];
    const users = ids.length ? await this.userRepo.find({ where: { id: In(ids) }, withDeleted: true }) : [];
    const nameOf = new Map(users.map((u) => [u.id, u.fullName]));
    return recons.map((r) => ({
      id: r.id,
      asOfDate: r.asOfDate,
      systemBalance: r.systemBalance,
      countedBalance: r.countedBalance,
      variance: r.variance,
      note: r.note,
      createdAt: r.createdAt,
      createdByName: r.createdBy ? (nameOf.get(r.createdBy) ?? null) : null,
    }));
  }

  async createReconciliation(accountId: string, dto: CreateReconciliationDto, user: AuthenticatedUser) {
    const account = await this.accountForUser(accountId, user);
    if (!LIQUID_SUBTYPES.includes(account.subtype)) {
      throw new BadRequestException('Only cash, bank and wallet accounts can be reconciled against a count.');
    }
    if (!isIsoDate(dto.asOfDate)) throw new BadRequestException('asOfDate is not a real date');
    if (dto.asOfDate > businessDate()) throw new BadRequestException('A count cannot be dated in the future.');

    const raw = (await this.rawBalances({ accountIds: [accountId], asOf: dto.asOfDate })).get(accountId) ?? 0n;
    const system = toNormalBalance(raw, account.type);
    const counted = toPaisa(dto.countedBalance);

    const saved = await this.reconRepo.save(
      this.reconRepo.create({
        accountId,
        asOfDate: dto.asOfDate,
        systemBalance: fromPaisa(system),
        countedBalance: fromPaisa(counted),
        variance: fromPaisa(counted - system),
        note: dto.note?.trim() || null,
        createdBy: user.id,
        updatedBy: null,
      }),
    );
    return { ...saved, createdByName: user.fullName };
  }

  shapeAccount(a: Account) {
    return {
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      subtype: a.subtype,
      isPostable: a.isPostable,
      isSystem: a.isSystem,
      isActive: a.isActive,
      description: a.description,
      parentId: a.parentId,
      parentName: a.parent?.name ?? null,
      businessUnit: a.businessUnit
        ? { id: a.businessUnit.id, code: a.businessUnit.code, name: a.businessUnit.name }
        : null,
      isDebitNormal: a.type === AccountType.ASSET || a.type === AccountType.EXPENSE,
    };
  }
}
