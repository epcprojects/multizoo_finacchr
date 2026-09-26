import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, LessThan, MoreThan, Not } from 'typeorm';
import {
  AccountType,
  FootfallKind,
  JournalEntryKind,
  JournalEntrySource,
  SalesDayStatus,
  SalesPricing,
} from '@multizoo/types';
import { businessDate, fromPaisa, isIsoDate, toPaisa } from '@multizoo/utils';
import type { AuthenticatedUser } from '../users/users.service';
import { assertUnitAccess, visibleUnitIds } from '../../../common/scope/unit-scope';
import { Account } from '../accounts/entities/account.entity';
import { BusinessUnit } from '../business-units/entities/business-unit.entity';
import { JournalEntry } from '../journal/entities/journal-entry.entity';
import { formatEntryNo, JournalService } from '../journal/journal.service';
import { payingAccount } from '../payroll/payroll-common';
import { userNames } from '../hr/hr-common';
import { addDays } from '../hr/hr-math';
import { SalesDay, SalesEvent, SalesItem, SalesLine } from './entities/sales.entity';
import {
  dayProblems,
  DayFigures,
  eventComparison,
  itemBreakup,
  lineAmount,
  salesGrid,
  SalesMathError,
  yearOverYear,
} from './sales-math';
import {
  CreateSalesItemDto,
  ListSalesDaysQueryDto,
  ListSalesItemsQueryDto,
  OpenSalesDayDto,
  SalesCompareQueryDto,
  SalesTotalQueryDto,
  SalesYearQueryDto,
  SaveSalesDayDto,
  SaveSalesEventDto,
  UnpostSalesDayDto,
  UpdateSalesItemDto,
} from './dto/sales.dto';

const NO_UNIT = '00000000-0000-0000-0000-000000000000';

/**
 * Sales & ticketing (architecture plan Part 03 §9, M9, Fig. 11).
 *
 * Staff fill in a unit's day — each ticket type or item, Qty × Rate — and
 * post it. Posting is one money-in entry, so the day's sales are the
 * ledger's income and the allocation engine splits them like any other.
 * Every rollup (the day × month grid, the category breakup, the Eid
 * comparison, year over year) is a query over the posted lines, so they
 * can't drift apart the way the sheets' separately-kept pivots do.
 */
@Injectable()
export class SalesService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly journal: JournalService,
  ) {}

  // --- Price list -----------------------------------------------------------------------

  async listItems(q: ListSalesItemsQueryDto, user: AuthenticatedUser) {
    if (q.businessUnitId) assertUnitAccess(user, q.businessUnitId);
    const scope = visibleUnitIds(user);
    const qb = this.dataSource.manager
      .createQueryBuilder(SalesItem, 'i')
      .leftJoinAndSelect('i.incomeAccount', 'a')
      .leftJoinAndSelect('i.businessUnit', 'bu')
      .orderBy('bu.code', 'ASC')
      .addOrderBy('i.sortOrder', 'ASC')
      .addOrderBy('i.name', 'ASC');
    if (q.businessUnitId) qb.andWhere('i.businessUnitId = :u', { u: q.businessUnitId });
    if (scope) qb.andWhere('i.businessUnitId IN (:...scope)', { scope: scope.length ? scope : [NO_UNIT] });
    if (!q.includeInactive) qb.andWhere('i.isActive = true');
    return (await qb.getMany()).map((i) => this.shapeItem(i));
  }

  async createItem(dto: CreateSalesItemDto, user: AuthenticatedUser) {
    const id = await this.dataSource.transaction(async (m) => {
      await this.activeUnit(m, dto.businessUnitId, user);
      await this.assertItemNameFree(m, dto.businessUnitId, dto.name.trim());
      await this.assertIncomeAccount(m, dto.incomeAccountId);
      const saved = await m.save(
        m.create(SalesItem, {
          businessUnitId: dto.businessUnitId,
          name: dto.name.trim(),
          category: dto.category.trim(),
          incomeAccountId: dto.incomeAccountId,
          pricing: dto.pricing,
          defaultRate: dto.pricing === SalesPricing.PER_UNIT && dto.defaultRate ? fromPaisa(toPaisa(dto.defaultRate)) : null,
          footfall: dto.pricing === SalesPricing.PER_UNIT ? (dto.footfall ?? FootfallKind.NONE) : FootfallKind.NONE,
          sortOrder: dto.sortOrder ?? (await this.nextSortOrder(m, dto.businessUnitId)),
          createdBy: user.id,
        }),
      );
      return saved.id;
    });
    return this.getItem(id);
  }

  async updateItem(id: string, dto: UpdateSalesItemDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const item = await m.findOne(SalesItem, { where: { id } });
      if (!item) throw new NotFoundException('Item not found');
      assertUnitAccess(user, item.businessUnitId);
      if (dto.name !== undefined && dto.name.trim() !== item.name) {
        await this.assertItemNameFree(m, item.businessUnitId, dto.name.trim(), item.id);
        item.name = dto.name.trim();
      }
      if (dto.category !== undefined) item.category = dto.category.trim();
      if (dto.incomeAccountId !== undefined) {
        await this.assertIncomeAccount(m, dto.incomeAccountId);
        item.incomeAccountId = dto.incomeAccountId;
      }
      if (dto.pricing !== undefined) item.pricing = dto.pricing;
      if (dto.defaultRate !== undefined) item.defaultRate = dto.defaultRate ? fromPaisa(toPaisa(dto.defaultRate)) : null;
      if (dto.footfall !== undefined) item.footfall = dto.footfall;
      if (item.pricing === SalesPricing.AMOUNT) {
        item.defaultRate = null;
        item.footfall = FootfallKind.NONE;
      }
      if (dto.sortOrder !== undefined) item.sortOrder = dto.sortOrder;
      if (dto.isActive !== undefined) item.isActive = dto.isActive;
      item.updatedBy = user.id;
      await m.save(item);
    });
    return this.getItem(id);
  }

  private async getItem(id: string) {
    const item = await this.dataSource.manager.findOne(SalesItem, { where: { id }, relations: { incomeAccount: true, businessUnit: true } });
    if (!item) throw new NotFoundException('Item not found');
    return this.shapeItem(item);
  }

  // --- Days -----------------------------------------------------------------------------

  async listDays(q: ListSalesDaysQueryDto, user: AuthenticatedUser) {
    if (q.businessUnitId) assertUnitAccess(user, q.businessUnitId);
    const scope = visibleUnitIds(user);
    const qb = this.dataSource.manager
      .createQueryBuilder(SalesDay, 'd')
      .leftJoinAndSelect('d.businessUnit', 'bu')
      .orderBy('d.salesDate', 'DESC')
      .addOrderBy('bu.code', 'ASC')
      .take(500);
    if (q.businessUnitId) qb.andWhere('d.businessUnitId = :u', { u: q.businessUnitId });
    if (scope) qb.andWhere('d.businessUnitId IN (:...scope)', { scope: scope.length ? scope : [NO_UNIT] });
    if (q.from) qb.andWhere('d.salesDate >= :from', { from: q.from });
    if (q.to) qb.andWhere('d.salesDate <= :to', { to: q.to });
    if (q.status) qb.andWhere('d.status = :s', { s: q.status });
    const days = await qb.getMany();
    const ids = days.map((d) => d.id);
    const stats: { dayId: string; lines: string; adults: string; kids: string }[] = ids.length
      ? await this.dataSource.query(
          `SELECT "dayId", COUNT(*) AS lines,
                  COALESCE(SUM(quantity) FILTER (WHERE footfall = 'ADULT'), 0) AS adults,
                  COALESCE(SUM(quantity) FILTER (WHERE footfall = 'KID'), 0) AS kids
             FROM sales_lines WHERE "dayId" = ANY($1) GROUP BY "dayId"`,
          [ids],
        )
      : [];
    const entries = await this.entries(days.map((d) => d.journalEntryId));
    return days.map((d) => {
      const s = stats.find((x) => x.dayId === d.id);
      return {
        id: d.id,
        businessUnit: this.unitRef(d.businessUnit),
        salesDate: d.salesDate,
        status: d.status,
        total: d.total,
        lineCount: Number(s?.lines ?? 0),
        adults: Number(s?.adults ?? 0),
        kids: Number(s?.kids ?? 0),
        entry: this.entryRef(entries, d.journalEntryId),
        postedAt: d.postedAt,
      };
    });
  }

  /** The day's sheet for a unit — started as an empty draft if there isn't one yet. */
  async openDay(dto: OpenSalesDayDto, user: AuthenticatedUser) {
    if (!isIsoDate(dto.salesDate)) throw new BadRequestException('salesDate is not a real calendar date');
    if (dto.salesDate > businessDate()) throw new BadRequestException('Sales can’t be entered for a day that hasn’t come yet.');
    const id = await this.dataSource.transaction(async (m) => {
      await this.activeUnit(m, dto.businessUnitId, user);
      await m.query(`SELECT pg_advisory_xact_lock(hashtext('sales-day:' || $1 || ':' || $2))`, [dto.businessUnitId, dto.salesDate]);
      const existing = await m.findOne(SalesDay, { where: { businessUnitId: dto.businessUnitId, salesDate: dto.salesDate } });
      if (existing) return existing.id;
      const saved = await m.save(
        m.create(SalesDay, {
          businessUnitId: dto.businessUnitId,
          salesDate: dto.salesDate,
          status: SalesDayStatus.DRAFT,
          total: '0.00',
          receipts: [],
          createdBy: user.id,
        }),
      );
      return saved.id;
    });
    return this.getDay(id, user);
  }

  async getDay(id: string, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const day = await m.findOne(SalesDay, { where: { id }, relations: { businessUnit: true } });
    if (!day) throw new NotFoundException('Sales day not found');
    assertUnitAccess(user, day.businessUnitId);
    const lines = await m.find(SalesLine, { where: { dayId: id }, order: { lineNo: 'ASC' } });
    const accountIds = [...new Set([...lines.map((l) => l.incomeAccountId), ...day.receipts.map((r) => r.accountId)])];
    const accounts = accountIds.length ? await m.find(Account, { where: { id: In(accountIds) }, withDeleted: true }) : [];
    const acct = (aid: string) => {
      const a = accounts.find((x) => x.id === aid);
      return a ? { id: a.id, code: a.code, name: a.name } : { id: aid, code: '?', name: 'Unknown account' };
    };
    const [prev, next] = await Promise.all([
      m.findOne(SalesDay, { where: { businessUnitId: day.businessUnitId, salesDate: LessThan(day.salesDate) }, order: { salesDate: 'DESC' } }),
      m.findOne(SalesDay, { where: { businessUnitId: day.businessUnitId, salesDate: MoreThan(day.salesDate) }, order: { salesDate: 'ASC' } }),
    ]);
    const entries = await this.entries([day.journalEntryId]);
    const names = await userNames(m, [day.createdBy, day.postedBy]);
    const received = day.receipts.reduce((s, r) => s + toPaisa(r.amount), 0n);
    const shapedLines = lines.map((l) => ({
      id: l.id,
      lineNo: l.lineNo,
      itemId: l.itemId,
      itemName: l.itemName,
      category: l.category,
      incomeAccount: acct(l.incomeAccountId),
      footfall: l.footfall,
      quantity: l.quantity,
      rate: l.rate,
      amount: l.amount,
      note: l.note,
    }));
    return {
      id: day.id,
      businessUnit: this.unitRef(day.businessUnit),
      salesDate: day.salesDate,
      status: day.status,
      total: day.total,
      received: fromPaisa(received),
      note: day.note,
      lines: shapedLines,
      receipts: day.receipts.map((r) => ({ account: acct(r.accountId), amount: r.amount })),
      footfall: {
        adults: lines.filter((l) => l.footfall === FootfallKind.ADULT).reduce((s, l) => s + (l.quantity ?? 0), 0),
        kids: lines.filter((l) => l.footfall === FootfallKind.KID).reduce((s, l) => s + (l.quantity ?? 0), 0),
      },
      byAccount: this.byIncomeAccount(lines).map((g) => ({ account: acct(g.accountId), amount: fromPaisa(g.amount) })),
      problems: day.status === SalesDayStatus.DRAFT ? dayProblems(lines, day.receipts) : [],
      entry: this.entryRef(entries, day.journalEntryId),
      previous: prev ? { id: prev.id, salesDate: prev.salesDate } : null,
      next: next ? { id: next.id, salesDate: next.salesDate } : null,
      createdByName: day.createdBy ? names.get(day.createdBy) ?? null : null,
      postedByName: day.postedBy ? names.get(day.postedBy) ?? null : null,
      postedAt: day.postedAt,
    };
  }

  /** Replaces a draft's lines and receipts. Amounts are worked out here, never trusted from the client. */
  async saveDay(id: string, dto: SaveSalesDayDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const day = await this.lockDay(m, id, user);
      if (day.status !== SalesDayStatus.DRAFT) throw new ConflictException('This day is posted — unpost it to change it.');
      const itemIds = [...new Set(dto.lines.map((l) => l.itemId))];
      const items = itemIds.length ? await m.find(SalesItem, { where: { id: In(itemIds) } }) : [];
      const lines = dto.lines.map((l, i) => {
        const item = items.find((x) => x.id === l.itemId);
        if (!item || item.businessUnitId !== day.businessUnitId) throw new BadRequestException(`Line ${i + 1}: that item isn’t on this unit’s price list.`);
        let quantity: number | null = null;
        let rate: string | null = null;
        let amount: string;
        try {
          if (item.pricing === SalesPricing.PER_UNIT) {
            quantity = l.quantity ?? 0;
            rate = l.rate ?? item.defaultRate;
            if (rate == null) throw new BadRequestException(`${item.name}: enter the rate it was sold at.`);
            rate = fromPaisa(toPaisa(rate));
            amount = lineAmount(quantity, rate);
          } else {
            amount = fromPaisa(toPaisa(l.amount ?? '0'));
          }
        } catch (err) {
          if (err instanceof SalesMathError) throw new BadRequestException(`${item.name}: ${err.message}`);
          throw err;
        }
        return m.create(SalesLine, {
          dayId: day.id,
          lineNo: i + 1,
          itemId: item.id,
          itemName: item.name,
          category: item.category,
          incomeAccountId: item.incomeAccountId,
          footfall: item.footfall,
          quantity,
          rate,
          amount,
          note: l.note?.trim() || null,
        });
      });
      for (const r of dto.receipts) await payingAccount(m, r.accountId, day.businessUnitId);
      const receipts = dto.receipts
        .filter((r) => toPaisa(r.amount) > 0n)
        .map((r) => ({ accountId: r.accountId, amount: fromPaisa(toPaisa(r.amount)) }));
      await m.delete(SalesLine, { dayId: day.id });
      if (lines.length) await m.save(lines);
      await m.update(SalesDay, day.id, {
        receipts,
        total: fromPaisa(lines.reduce((s, l) => s + toPaisa(l.amount), 0n)),
        note: dto.note !== undefined ? dto.note?.trim() || null : day.note,
        updatedBy: user.id,
      } as Partial<SalesDay>);
    });
    return this.getDay(id, user);
  }

  async deleteDay(id: string, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const day = await this.lockDay(m, id, user);
      if (day.status !== SalesDayStatus.DRAFT) throw new ConflictException('Unpost the day before deleting it.');
      await m.delete(SalesDay, { id: day.id });
    });
    return { deleted: true };
  }

  /**
   * Puts the day on the ledger: Dr each account the takings went into /
   * Cr each line's income account. One entry, dated the sales day.
   */
  async postDay(id: string, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const day = await this.lockDay(m, id, user);
      if (day.status !== SalesDayStatus.DRAFT) throw new ConflictException('This day is already posted.');
      const lines = await m.find(SalesLine, { where: { dayId: day.id }, order: { lineNo: 'ASC' } });
      const problems = dayProblems(lines, day.receipts);
      if (problems.length) throw new BadRequestException(problems.join(' '));
      const unit = await m.findOneOrFail(BusinessUnit, { where: { id: day.businessUnitId } });
      const credits = lines
        .filter((l) => toPaisa(l.amount) > 0n)
        .map((l) => ({
          accountId: l.incomeAccountId,
          credit: l.amount,
          memo: (l.quantity != null ? `${l.quantity} × ${l.itemName} @ ${l.rate}` : l.itemName).slice(0, 255),
        }));
      const entry = (await this.journal.post(
        {
          entryDate: day.salesDate,
          businessUnitId: day.businessUnitId,
          description: `${unit.name} sales, ${day.salesDate}`,
          reference: `SALES-${unit.code}-${day.salesDate}`,
          kind: JournalEntryKind.MONEY_IN,
          lines: [...day.receipts.map((r) => ({ accountId: r.accountId, debit: r.amount, memo: 'Takings' })), ...credits],
        },
        user,
        { manager: m, source: JournalEntrySource.SALES },
      )) as JournalEntry;
      await m.update(SalesDay, day.id, {
        status: SalesDayStatus.POSTED,
        journalEntryId: entry.id,
        postedBy: user.id,
        postedAt: new Date(),
        updatedBy: user.id,
      } as Partial<SalesDay>);
    });
    return this.getDay(id, user);
  }

  /** Back to draft: the entry is reversed (dated today), and the allocation shows the day as changed. */
  async unpostDay(id: string, dto: UnpostSalesDayDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const day = await this.lockDay(m, id, user);
      if (day.status !== SalesDayStatus.POSTED || !day.journalEntryId) throw new ConflictException('This day isn’t posted.');
      await this.journal.reverseWithin(
        m,
        day.journalEntryId,
        { reason: dto.reason?.trim() || 'Sales day unposted to correct it', entryDate: businessDate() },
        user,
        { fromSales: true, source: JournalEntrySource.SALES },
      );
      await m.update(SalesDay, day.id, {
        status: SalesDayStatus.DRAFT,
        journalEntryId: null,
        postedBy: null,
        postedAt: null,
        updatedBy: user.id,
      } as Partial<SalesDay>);
    });
    return this.getDay(id, user);
  }

  // --- Reports ----------------------------------------------------------------------------

  /** Banner figures over the caller's units: today, this month, this year, and this year against last. */
  async stats(user: AuthenticatedUser) {
    const today = businessDate();
    const year = Number(today.slice(0, 4));
    const amounts = await this.dailyAmounts(user, undefined, `${year - 1}-01-01`, today);
    const sum = (pred: (d: string) => boolean) => fromPaisa(amounts.filter((a) => pred(a.date)).reduce((s, a) => s + toPaisa(a.amount), 0n));
    const yoy = yearOverYear(year, amounts, today);
    const scope = visibleUnitIds(user);
    const [{ drafts }] = await this.dataSource.query(
      `SELECT COUNT(*) AS drafts FROM sales_days WHERE status = 'DRAFT' ${scope ? `AND "businessUnitId" = ANY($1)` : ''}`,
      scope ? [scope.length ? scope : [NO_UNIT]] : [],
    );
    return {
      today: sum((d) => d === today),
      month: sum((d) => d.startsWith(today.slice(0, 7))),
      year: sum((d) => d.startsWith(`${year}-`)),
      yearToDate: yoy.toDate,
      drafts: Number(drafts),
    };
  }

  /** The day-of-month × month grid for a year (Ticket sales L4:X39). */
  async grid(q: SalesYearQueryDto, user: AuthenticatedUser) {
    const amounts = await this.dailyAmounts(user, q.businessUnitId, `${q.year}-01-01`, `${q.year}-12-31`);
    return { businessUnitId: q.businessUnitId ?? null, ...salesGrid(q.year, amounts) };
  }

  /** Amount and count per item per month (Ticket sales Z4:AX40). */
  async breakup(q: SalesYearQueryDto, user: AuthenticatedUser) {
    const params: unknown[] = [`${q.year}-01-01`, `${q.year}-12-31`];
    const unitFilter = this.unitFilter(user, q.businessUnitId, params);
    const rows: { month: string; item: string; category: string; amount: string; quantity: string | null }[] = await this.dataSource.query(
      `SELECT to_char(d."salesDate", 'YYYY-MM') AS month, l."itemName" AS item, l.category,
              SUM(l.amount) AS amount, SUM(l.quantity) AS quantity
         FROM sales_lines l JOIN sales_days d ON d.id = l."dayId"
        WHERE d.status = 'POSTED' AND d."salesDate" BETWEEN $1 AND $2 ${unitFilter}
        GROUP BY 1, 2, 3`,
      params,
    );
    const order = q.businessUnitId
      ? (await this.dataSource.manager.find(SalesItem, { where: { businessUnitId: q.businessUnitId }, order: { sortOrder: 'ASC', name: 'ASC' }, withDeleted: true })).map((i) => i.name)
      : undefined;
    return {
      year: q.year,
      businessUnitId: q.businessUnitId ?? null,
      ...itemBreakup(
        rows.map((r) => ({
          month: r.month,
          item: r.item,
          category: r.category,
          amount: fromPaisa(toPaisa(String(r.amount))),
          quantity: r.quantity == null ? null : Number(r.quantity),
        })),
        order,
      ),
    };
  }

  /** This year against last, month by month. */
  async yearOverYear(q: SalesYearQueryDto, user: AuthenticatedUser) {
    const amounts = await this.dailyAmounts(user, q.businessUnitId, `${q.year - 1}-01-01`, `${q.year}-12-31`);
    return { businessUnitId: q.businessUnitId ?? null, ...yearOverYear(q.year, amounts, businessDate()) };
  }

  /** A peak event, day by day, across the years it's been recorded for (Eid Sales Comperison). */
  async compare(q: SalesCompareQueryDto, user: AuthenticatedUser) {
    const event = await this.dataSource.manager.findOne(SalesEvent, { where: { id: q.eventId } });
    if (!event) throw new NotFoundException('Event not found');
    const occurrences = [...event.occurrences].sort((a, b) => a.year - b.year);
    const daily = new Map<string, DayFigures>();
    for (const o of occurrences) {
      const params: unknown[] = [o.startDate, addDays(o.startDate, event.days - 1)];
      const unitFilter = this.unitFilter(user, q.businessUnitId, params);
      const rows: { date: string; amount: string; adults: string; kids: string }[] = await this.dataSource.query(
        `SELECT to_char(d."salesDate", 'YYYY-MM-DD') AS date, SUM(l.amount) AS amount,
                COALESCE(SUM(l.quantity) FILTER (WHERE l.footfall = 'ADULT'), 0) AS adults,
                COALESCE(SUM(l.quantity) FILTER (WHERE l.footfall = 'KID'), 0) AS kids
           FROM sales_lines l JOIN sales_days d ON d.id = l."dayId"
          WHERE d.status = 'POSTED' AND d."salesDate" BETWEEN $1 AND $2 ${unitFilter}
          GROUP BY 1`,
        params,
      );
      for (const r of rows) daily.set(r.date, { amount: fromPaisa(toPaisa(String(r.amount))), adults: Number(r.adults), kids: Number(r.kids) });
    }
    return {
      event: this.shapeEvent(event),
      businessUnitId: q.businessUnitId ?? null,
      ...eventComparison(event.days, occurrences, daily),
    };
  }

  /** What a unit sold over a period — the commission pool's qualifying sales. */
  async total(q: SalesTotalQueryDto, user: AuthenticatedUser) {
    assertUnitAccess(user, q.businessUnitId);
    const params: unknown[] = [q.businessUnitId, q.from, q.to];
    let categoryFilter = '';
    if (q.category) categoryFilter = `AND lower(l.category) = lower($${params.push(q.category.trim())})`;
    const [row]: { amount: string | null; quantity: string | null; days: string }[] = await this.dataSource.query(
      `SELECT SUM(l.amount) AS amount, SUM(l.quantity) AS quantity, COUNT(DISTINCT d.id) AS days
         FROM sales_lines l JOIN sales_days d ON d.id = l."dayId"
        WHERE d.status = 'POSTED' AND d."businessUnitId" = $1 AND d."salesDate" BETWEEN $2 AND $3 ${categoryFilter}`,
      params,
    );
    const categories: { category: string }[] = await this.dataSource.query(
      `SELECT DISTINCT category FROM sales_items WHERE "businessUnitId" = $1 AND "deletedAt" IS NULL ORDER BY category`,
      [q.businessUnitId],
    );
    return {
      businessUnitId: q.businessUnitId,
      from: q.from,
      to: q.to,
      category: q.category ?? null,
      amount: fromPaisa(toPaisa(String(row?.amount ?? '0'))),
      quantity: Number(row?.quantity ?? 0),
      days: Number(row?.days ?? 0),
      categories: categories.map((c) => c.category),
    };
  }

  // --- Peak events -------------------------------------------------------------------------

  async listEvents() {
    const events = await this.dataSource.manager.find(SalesEvent, { order: { isActive: 'DESC', name: 'ASC' } });
    return events.map((e) => this.shapeEvent(e));
  }

  async createEvent(dto: SaveSalesEventDto, user: AuthenticatedUser) {
    const id = await this.dataSource.transaction(async (m) => {
      await this.assertEventNameFree(m, dto.name.trim());
      const saved = await m.save(
        m.create(SalesEvent, {
          name: dto.name.trim(),
          days: dto.days,
          occurrences: this.checkOccurrences(dto.occurrences),
          notes: dto.notes?.trim() || null,
          createdBy: user.id,
        }),
      );
      return saved.id;
    });
    return this.shapeEvent(await this.dataSource.manager.findOneOrFail(SalesEvent, { where: { id } }));
  }

  async updateEvent(id: string, dto: SaveSalesEventDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const e = await m.findOne(SalesEvent, { where: { id } });
      if (!e) throw new NotFoundException('Event not found');
      if (dto.name.trim() !== e.name) await this.assertEventNameFree(m, dto.name.trim(), e.id);
      await m.update(SalesEvent, e.id, {
        name: dto.name.trim(),
        days: dto.days,
        occurrences: this.checkOccurrences(dto.occurrences),
        notes: dto.notes?.trim() || null,
        isActive: dto.isActive ?? e.isActive,
        updatedBy: user.id,
      } as Partial<SalesEvent>);
    });
    return this.shapeEvent(await this.dataSource.manager.findOneOrFail(SalesEvent, { where: { id } }));
  }

  // --- Internals ----------------------------------------------------------------------------

  /** Posted sales per date over the caller's units (or one unit). */
  private async dailyAmounts(user: AuthenticatedUser, unitId: string | undefined, from: string, to: string) {
    const params: unknown[] = [from, to];
    const unitFilter = this.unitFilter(user, unitId, params);
    const rows: { date: string; amount: string }[] = await this.dataSource.query(
      `SELECT to_char(d."salesDate", 'YYYY-MM-DD') AS date, SUM(d.total) AS amount
         FROM sales_days d
        WHERE d.status = 'POSTED' AND d."salesDate" BETWEEN $1 AND $2 ${unitFilter}
        GROUP BY 1`,
      params,
    );
    return rows.map((r) => ({ date: r.date, amount: fromPaisa(toPaisa(String(r.amount))) }));
  }

  /** `AND d."businessUnitId" …` for one unit, or every unit the caller can see. */
  private unitFilter(user: AuthenticatedUser, unitId: string | undefined, params: unknown[]): string {
    if (unitId) {
      assertUnitAccess(user, unitId);
      return `AND d."businessUnitId" = $${params.push(unitId)}`;
    }
    const scope = visibleUnitIds(user);
    return scope ? `AND d."businessUnitId" = ANY($${params.push(scope.length ? scope : [NO_UNIT])})` : '';
  }

  private byIncomeAccount(lines: SalesLine[]) {
    const map = new Map<string, bigint>();
    for (const l of lines) map.set(l.incomeAccountId, (map.get(l.incomeAccountId) ?? 0n) + toPaisa(l.amount));
    return [...map.entries()].map(([accountId, amount]) => ({ accountId, amount }));
  }

  private async lockDay(m: EntityManager, id: string, user: AuthenticatedUser) {
    const day = await m.findOne(SalesDay, { where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!day) throw new NotFoundException('Sales day not found');
    assertUnitAccess(user, day.businessUnitId);
    return day;
  }

  private async activeUnit(m: EntityManager, id: string, user: AuthenticatedUser) {
    assertUnitAccess(user, id);
    const unit = await m.findOne(BusinessUnit, { where: { id } });
    if (!unit) throw new BadRequestException('Business unit not found');
    if (!unit.isActive) throw new BadRequestException(`${unit.name} is inactive.`);
    return unit;
  }

  private async assertIncomeAccount(m: EntityManager, id: string) {
    const a = await m.findOne(Account, { where: { id } });
    if (!a || a.type !== AccountType.INCOME || !a.isPostable || !a.isActive) {
      throw new BadRequestException('Choose an active income account (e.g. 4100 Ticket Sales) that can be posted to.');
    }
  }

  private async assertItemNameFree(m: EntityManager, unitId: string, name: string, exceptId?: string) {
    const clash = await m
      .createQueryBuilder(SalesItem, 'i')
      .where('i.businessUnitId = :u AND lower(i.name) = lower(:n)', { u: unitId, n: name })
      .andWhere(exceptId ? 'i.id <> :id' : '1=1', { id: exceptId })
      .getOne();
    if (clash) throw new ConflictException(`“${name}” is already on this unit’s price list.`);
  }

  private async assertEventNameFree(m: EntityManager, name: string, exceptId?: string) {
    const clash = await m.findOne(SalesEvent, { where: { name, ...(exceptId ? { id: Not(exceptId) } : {}) } });
    if (clash) throw new ConflictException(`There's already an event called ${name}.`);
  }

  private checkOccurrences(list: { year: number; startDate: string }[]) {
    const seen = new Set<number>();
    return list
      .map((o) => {
        if (!isIsoDate(o.startDate) || Number(o.startDate.slice(0, 4)) !== o.year) {
          throw new BadRequestException(`${o.year}: the first day must be a real date in ${o.year}.`);
        }
        if (seen.has(o.year)) throw new BadRequestException(`${o.year} is listed twice.`);
        seen.add(o.year);
        return { year: o.year, startDate: o.startDate };
      })
      .sort((a, b) => a.year - b.year);
  }

  private async nextSortOrder(m: EntityManager, unitId: string) {
    const [{ max }] = await m.query(`SELECT COALESCE(MAX("sortOrder"), -1) AS max FROM sales_items WHERE "businessUnitId" = $1`, [unitId]);
    return Number(max) + 1;
  }

  private async entries(ids: (string | null)[]) {
    const wanted = ids.filter(Boolean) as string[];
    return wanted.length ? this.dataSource.manager.find(JournalEntry, { where: { id: In(wanted) } }) : [];
  }

  private entryRef(entries: JournalEntry[], id: string | null) {
    const e = id ? entries.find((x) => x.id === id) : null;
    return e ? { id: e.id, displayNo: formatEntryNo(e.entryNo) } : null;
  }

  private unitRef(u: BusinessUnit) {
    return { id: u.id, code: u.code, name: u.name };
  }

  private shapeItem(i: SalesItem) {
    return {
      id: i.id,
      businessUnit: i.businessUnit ? this.unitRef(i.businessUnit) : { id: i.businessUnitId, code: '?', name: '?' },
      name: i.name,
      category: i.category,
      incomeAccount: i.incomeAccount ? { id: i.incomeAccount.id, code: i.incomeAccount.code, name: i.incomeAccount.name } : null,
      pricing: i.pricing,
      defaultRate: i.defaultRate,
      footfall: i.footfall,
      sortOrder: i.sortOrder,
      isActive: i.isActive,
    };
  }

  private shapeEvent(e: SalesEvent) {
    return { id: e.id, name: e.name, days: e.days, occurrences: e.occurrences, notes: e.notes, isActive: e.isActive };
  }
}
