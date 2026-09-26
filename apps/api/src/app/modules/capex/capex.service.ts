import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import { AccountType, CapexFunding, CapexStatus, JournalEntryKind, JournalEntrySource } from '@multizoo/types';
import { businessDate, fromPaisa, isIsoDate, toPaisa } from '@multizoo/utils';
import type { AuthenticatedUser } from '../users/users.service';
import { assertUnitAccess, visibleUnitIds } from '../../../common/scope/unit-scope';
import { Account } from '../accounts/entities/account.entity';
import { BusinessUnit } from '../business-units/entities/business-unit.entity';
import { JournalEntry } from '../journal/entities/journal-entry.entity';
import { formatEntryNo, JournalService } from '../journal/journal.service';
import { payingAccount } from '../payroll/payroll-common';
import { SalesItem } from '../sales/entities/sales.entity';
import { CapexItem } from './entities/capex.entity';
import { capexSummary, payback } from './capex-math';
import { CreateCapexDto, ListCapexQueryDto, RemoveCapexDto, RetireCapexDto, UpdateCapexDto } from './dto/capex.dto';

const NO_UNIT = '00000000-0000-0000-0000-000000000000';

/**
 * The capex register (architecture plan Part 03 §11, M11) — `Dir Invst
 * Zoo` as data: every capital purchase, investment to date by nature and
 * unit, and — for purchases whose takings show on the price list — how far
 * each is to paying for itself against its "Roi Time Expct".
 */
@Injectable()
export class CapexService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly journal: JournalService,
  ) {}

  async list(q: ListCapexQueryDto, user: AuthenticatedUser) {
    if (q.businessUnitId) assertUnitAccess(user, q.businessUnitId);
    const scope = visibleUnitIds(user);
    const qb = this.dataSource.manager
      .createQueryBuilder(CapexItem, 'c')
      .leftJoinAndSelect('c.businessUnit', 'bu')
      .orderBy('c.purchaseDate', 'DESC')
      .addOrderBy('c.createdAt', 'DESC');
    if (q.businessUnitId) qb.andWhere('c.businessUnitId = :u', { u: q.businessUnitId });
    if (q.status) qb.andWhere('c.status = :s', { s: q.status });
    if (scope) qb.andWhere('c.businessUnitId IN (:...scope)', { scope: scope.length ? scope : [NO_UNIT] });
    const items = await qb.getMany();
    const earnings = await this.earnings(items);
    const entries = await this.entries(items.map((i) => i.journalEntryId));
    const natures: { nature: string }[] = await this.dataSource.query(
      `SELECT DISTINCT nature FROM capex_items WHERE "deletedAt" IS NULL ORDER BY nature`,
    );
    const capexAccount = await this.defaultAccount(this.dataSource.manager);
    return {
      items: items.map((i) => this.shape(i, earnings, entries)),
      summary: capexSummary(items.map((i) => ({ amount: i.amount, nature: i.nature, unit: i.businessUnit.code, purchaseDate: i.purchaseDate }))),
      natures: natures.map((n) => n.nature),
      defaultAccountId: capexAccount?.id ?? null,
    };
  }

  async findOne(id: string, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const item = await m.findOne(CapexItem, { where: { id }, relations: { businessUnit: true } });
    if (!item) throw new NotFoundException('Capex item not found');
    assertUnitAccess(user, item.businessUnitId);
    const earnings = await this.earnings([item]);
    const entries = await this.entries([item.journalEntryId]);
    const byMonth = new Map<string, bigint>();
    for (const e of earnings.get(item.id) ?? []) {
      if (e.date < item.purchaseDate) continue;
      byMonth.set(e.date.slice(0, 7), (byMonth.get(e.date.slice(0, 7)) ?? 0n) + toPaisa(e.amount));
    }
    return {
      ...this.shape(item, earnings, entries),
      earningsByMonth: [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, v]) => ({ month, amount: fromPaisa(v) })),
    };
  }

  async create(dto: CreateCapexDto, user: AuthenticatedUser) {
    const id = await this.dataSource.transaction(async (m) => {
      const unit = await this.activeUnit(m, dto.businessUnitId, user);
      this.assertDate(dto.purchaseDate);
      if (toPaisa(dto.amount) <= 0n) throw new BadRequestException('Enter what it cost.');
      await this.assertEarningItems(m, dto.earningItemIds ?? [], unit.id);
      let journalEntryId: string | null = null;
      let accountId: string | null = null;
      if (dto.funding === CapexFunding.PAID_HERE) {
        const charged = await this.chargeableAccount(m, dto.accountId as string, unit.id);
        const from = await payingAccount(m, dto.paidFromAccountId as string, unit.id);
        const entry = (await this.journal.post(
          {
            entryDate: dto.purchaseDate,
            businessUnitId: unit.id,
            description: `Capex: ${dto.name.trim()}`,
            reference: 'CAPEX',
            kind: JournalEntryKind.MONEY_OUT,
            reserveAccountId: dto.reserveAccountId ?? null,
            lines: [
              { accountId: charged.id, debit: fromPaisa(toPaisa(dto.amount)), memo: dto.nature.trim() },
              { accountId: from.id, credit: fromPaisa(toPaisa(dto.amount)), memo: null },
            ],
          },
          user,
          { manager: m, source: JournalEntrySource.CAPEX },
        )) as JournalEntry;
        journalEntryId = entry.id;
        accountId = charged.id;
      } else if (dto.funding === CapexFunding.LINKED_ENTRY) {
        journalEntryId = (await this.linkableEntry(m, dto.journalEntryId as string, unit.id)).id;
      }
      const saved = await m.save(
        m.create(CapexItem, {
          businessUnitId: unit.id,
          purchaseDate: dto.purchaseDate,
          name: dto.name.trim(),
          nature: dto.nature.trim(),
          amount: fromPaisa(toPaisa(dto.amount)),
          paybackMonths: dto.paybackMonths ?? null,
          funding: dto.funding,
          accountId,
          journalEntryId,
          earningItemIds: [...new Set(dto.earningItemIds ?? [])],
          status: CapexStatus.ACTIVE,
          note: dto.note?.trim() || null,
          createdBy: user.id,
        }),
      );
      return saved.id;
    });
    return this.findOne(id, user);
  }

  async update(id: string, dto: UpdateCapexDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const item = await this.lock(m, id, user);
      if (dto.name !== undefined) item.name = dto.name.trim();
      if (dto.nature !== undefined) item.nature = dto.nature.trim();
      if (dto.paybackMonths !== undefined) item.paybackMonths = dto.paybackMonths;
      if (dto.note !== undefined) item.note = dto.note?.trim() || null;
      if (dto.earningItemIds !== undefined) {
        await this.assertEarningItems(m, dto.earningItemIds, item.businessUnitId);
        item.earningItemIds = [...new Set(dto.earningItemIds)];
      }
      const changesMoney = (dto.amount !== undefined && toPaisa(dto.amount) !== toPaisa(item.amount)) || (dto.purchaseDate !== undefined && dto.purchaseDate !== item.purchaseDate);
      if (changesMoney && item.funding === CapexFunding.PAID_HERE) {
        throw new ConflictException('It was paid from here — remove it (which reverses the payment) and record it again to change the date or amount.');
      }
      if (dto.purchaseDate !== undefined) {
        this.assertDate(dto.purchaseDate);
        item.purchaseDate = dto.purchaseDate;
      }
      if (dto.amount !== undefined) {
        if (toPaisa(dto.amount) <= 0n) throw new BadRequestException('Enter what it cost.');
        item.amount = fromPaisa(toPaisa(dto.amount));
      }
      item.updatedBy = user.id;
      await m.save(item);
    });
    return this.findOne(id, user);
  }

  async retire(id: string, dto: RetireCapexDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const item = await this.lock(m, id, user);
      if (item.status === CapexStatus.RETIRED) throw new ConflictException('It’s already retired.');
      this.assertDate(dto.retiredOn);
      if (dto.retiredOn < item.purchaseDate) throw new BadRequestException('It can’t be retired before it was bought.');
      await m.update(CapexItem, item.id, {
        status: CapexStatus.RETIRED,
        retiredOn: dto.retiredOn,
        note: dto.note?.trim() ? [item.note, `Retired: ${dto.note.trim()}`].filter(Boolean).join('\n') : item.note,
        updatedBy: user.id,
      } as Partial<CapexItem>);
    });
    return this.findOne(id, user);
  }

  async reinstate(id: string, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const item = await this.lock(m, id, user);
      if (item.status !== CapexStatus.RETIRED) throw new ConflictException('It isn’t retired.');
      await m.update(CapexItem, item.id, { status: CapexStatus.ACTIVE, retiredOn: null, updatedBy: user.id } as Partial<CapexItem>);
    });
    return this.findOne(id, user);
  }

  /** Takes it off the register. A payment made here is reversed with it; a linked entry is left alone. */
  async remove(id: string, dto: RemoveCapexDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const item = await this.lock(m, id, user);
      if (item.funding === CapexFunding.PAID_HERE && item.journalEntryId) {
        await this.journal.reverseWithin(
          m,
          item.journalEntryId,
          { reason: dto.reason?.trim() || `Capex item removed: ${item.name}`, entryDate: businessDate() },
          user,
          { fromCapex: true, source: JournalEntrySource.CAPEX },
        );
      }
      await m.update(CapexItem, item.id, { updatedBy: user.id } as Partial<CapexItem>);
      await m.softDelete(CapexItem, item.id);
    });
    return { deleted: true };
  }

  // --- Internals ---------------------------------------------------------------------------

  /** Posted takings of each item's linked price-list items, by date. */
  private async earnings(items: CapexItem[]) {
    const out = new Map<string, { date: string; amount: string }[]>();
    const itemIds = [...new Set(items.flatMap((i) => i.earningItemIds))];
    if (!itemIds.length) return out;
    const rows: { itemId: string; date: string; amount: string }[] = await this.dataSource.query(
      `SELECT l."itemId", to_char(d."salesDate", 'YYYY-MM-DD') AS date, SUM(l.amount) AS amount
         FROM sales_lines l JOIN sales_days d ON d.id = l."dayId"
        WHERE d.status = 'POSTED' AND l."itemId" = ANY($1)
        GROUP BY 1, 2`,
      [itemIds],
    );
    for (const i of items) {
      if (!i.earningItemIds.length) continue;
      const byDate = new Map<string, bigint>();
      for (const r of rows) if (i.earningItemIds.includes(r.itemId)) byDate.set(r.date, (byDate.get(r.date) ?? 0n) + toPaisa(String(r.amount)));
      out.set(i.id, [...byDate.entries()].map(([date, v]) => ({ date, amount: fromPaisa(v) })));
    }
    return out;
  }

  private shape(i: CapexItem, earnings: Map<string, { date: string; amount: string }[]>, entries: JournalEntry[]) {
    const e = i.journalEntryId ? entries.find((x) => x.id === i.journalEntryId) : null;
    const today = i.status === CapexStatus.RETIRED && i.retiredOn ? i.retiredOn : businessDate();
    return {
      id: i.id,
      businessUnit: { id: i.businessUnit.id, code: i.businessUnit.code, name: i.businessUnit.name },
      purchaseDate: i.purchaseDate,
      name: i.name,
      nature: i.nature,
      amount: i.amount,
      paybackMonths: i.paybackMonths,
      funding: i.funding,
      accountId: i.accountId,
      entry: e ? { id: e.id, displayNo: formatEntryNo(e.entryNo), reversed: Boolean(e.reversedById) } : null,
      earningItemIds: i.earningItemIds,
      status: i.status,
      retiredOn: i.retiredOn,
      note: i.note,
      payback: payback({
        cost: i.amount,
        purchaseDate: i.purchaseDate,
        paybackMonths: i.paybackMonths,
        earnings: i.earningItemIds.length ? earnings.get(i.id) ?? [] : null,
        today,
      }),
    };
  }

  private async lock(m: EntityManager, id: string, user: AuthenticatedUser) {
    const item = await m.findOne(CapexItem, { where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!item) throw new NotFoundException('Capex item not found');
    assertUnitAccess(user, item.businessUnitId);
    return item;
  }

  private async activeUnit(m: EntityManager, id: string, user: AuthenticatedUser) {
    assertUnitAccess(user, id);
    const unit = await m.findOne(BusinessUnit, { where: { id } });
    if (!unit) throw new BadRequestException('Business unit not found');
    if (!unit.isActive) throw new BadRequestException(`${unit.name} is inactive.`);
    return unit;
  }

  private assertDate(date: string) {
    if (!isIsoDate(date)) throw new BadRequestException('That isn’t a real date.');
    if (date > businessDate()) throw new BadRequestException('It can’t be dated in the future.');
  }

  /** An asset (e.g. a fixed-asset account) or expense (5800) account — not cash and not a reserve. */
  private async chargeableAccount(m: EntityManager, id: string, unitId: string) {
    const a = await m.findOne(Account, { where: { id }, relations: { accountClass: true } });
    if (!a || !a.isActive || !a.isPostable) throw new BadRequestException('Choose an active account to charge it to.');
    if (![AccountType.ASSET, AccountType.EXPENSE].includes(a.type) || a.accountClass.isLiquid || a.accountClass.isReserve || a.loanId || a.partnerId || a.campaignId) {
      throw new BadRequestException('Charge it to a fixed-asset account or to Development & Capital Expenditure — not cash, a reserve or a loan.');
    }
    if (a.businessUnitId && a.businessUnitId !== unitId) throw new BadRequestException(`${a.name} belongs to another unit.`);
    return a;
  }

  private async linkableEntry(m: EntityManager, id: string, unitId: string) {
    const e = await m.findOne(JournalEntry, { where: { id } });
    if (!e) throw new BadRequestException('That entry doesn’t exist.');
    if (e.businessUnitId !== unitId) throw new BadRequestException(`${formatEntryNo(e.entryNo)} is another unit’s entry.`);
    if (e.reversedById || e.reversalOfId) throw new BadRequestException(`${formatEntryNo(e.entryNo)} is reversed, or is itself a reversal.`);
    const other = await m.findOne(CapexItem, { where: { journalEntryId: e.id, deletedAt: IsNull() } });
    if (other) throw new ConflictException(`${formatEntryNo(e.entryNo)} is already the purchase of “${other.name}”.`);
    return e;
  }

  private async assertEarningItems(m: EntityManager, ids: string[], unitId: string) {
    if (!ids.length) return;
    const items = await m.find(SalesItem, { where: { id: In(ids) } });
    if (items.length !== new Set(ids).size || items.some((i) => i.businessUnitId !== unitId)) {
      throw new BadRequestException('Link only items on this unit’s price list.');
    }
  }

  private async entries(ids: (string | null)[]) {
    const wanted = ids.filter(Boolean) as string[];
    return wanted.length ? this.dataSource.manager.find(JournalEntry, { where: { id: In(wanted) } }) : [];
  }

  /** 5800 Development & Capital Expenditure — where capex is charged today. */
  private defaultAccount(m: EntityManager) {
    return m.findOne(Account, { where: { name: 'Development & Capital Expenditure', businessUnitId: IsNull(), isActive: true, isPostable: true } });
  }
}
