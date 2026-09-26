import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Not } from 'typeorm';
import {
  AccountType,
  CampaignEntryStatus,
  CampaignEntryType,
  CampaignStatus,
  JournalEntryKind,
  JournalEntrySource,
  SystemAccountClass,
} from '@multizoo/types';
import { businessDate, fromPaisa, isIsoDate, toPaisa } from '@multizoo/utils';
import type { AuthenticatedUser } from '../users/users.service';
import { assertUnitAccess, visibleUnitIds } from '../../../common/scope/unit-scope';
import { Account } from '../accounts/entities/account.entity';
import { AccountClass } from '../accounts/entities/account-class.entity';
import { BusinessUnit } from '../business-units/entities/business-unit.entity';
import { buildCode, nextNumber, parseNumber } from '../accounts/account-codes';
import { getChartSettings } from '../accounts/chart-of-accounts';
import { JournalEntry } from '../journal/entities/journal-entry.entity';
import { formatEntryNo, JournalService } from '../journal/journal.service';
import { payingAccount } from '../payroll/payroll-common';
import { userNames } from '../hr/hr-common';
import { Campaign, CampaignEntry } from './entities/capex.entity';
import { campaignStatement } from './capex-math';
import {
  CampaignEntryDto,
  CloseCampaignDto,
  CreateCampaignDto,
  ListCampaignsQueryDto,
  ReverseCampaignEntryDto,
  UpdateCampaignDto,
} from './dto/capex.dto';

const NO_UNIT = '00000000-0000-0000-0000-000000000000';

/**
 * Seasonal campaigns (architecture plan Part 03 §11, M11) — the `Ramazan
 * 2023` sheet as a standalone, date-bounded P&L.
 *
 *   raised for it     Dr cash / bank / wallet    Cr Campaign fund
 *   spent on it       Dr Campaign fund           Cr cash / bank / wallet
 *   closed, short     Dr the chosen expense      Cr Campaign fund
 *   closed, surplus   Dr Campaign fund           Cr the chosen income
 *
 * The fund is a liability of the host unit: money held for the campaign.
 * Its balance is the campaign's balance (the sheet's C3) — negative when
 * the unit has put in more than was raised. Nothing reaches the unit's
 * income or expenses until the campaign is closed, so the waterfall never
 * splits a donation.
 */
@Injectable()
export class CampaignsService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly journal: JournalService,
  ) {}

  async list(q: ListCampaignsQueryDto, user: AuthenticatedUser) {
    const scope = visibleUnitIds(user);
    const qb = this.dataSource.manager
      .createQueryBuilder(Campaign, 'c')
      .leftJoinAndSelect('c.businessUnit', 'bu')
      .orderBy('c.startDate', 'DESC');
    if (q.status) qb.andWhere('c.status = :s', { s: q.status });
    if (scope) qb.andWhere('c.businessUnitId IN (:...scope)', { scope: scope.length ? scope : [NO_UNIT] });
    const campaigns = await qb.getMany();
    const entries = campaigns.length
      ? await this.dataSource.manager.find(CampaignEntry, { where: { campaignId: In(campaigns.map((c) => c.id)), status: CampaignEntryStatus.POSTED } })
      : [];
    return campaigns.map((c) => {
      const s = campaignStatement(this.lines(entries.filter((e) => e.campaignId === c.id)), c.budget);
      return {
        ...this.shapeCampaign(c),
        income: s.income,
        expenses: s.expenses,
        balance: s.balance,
        budgetTotal: s.budget?.total ?? null,
        entryCount: entries.filter((e) => e.campaignId === c.id).length,
      };
    });
  }

  async findOne(id: string, user: AuthenticatedUser) {
    const m = this.dataSource.manager;
    const c = await m.findOne(Campaign, { where: { id }, relations: { businessUnit: true } });
    if (!c) throw new NotFoundException('Campaign not found');
    assertUnitAccess(user, c.businessUnitId);
    const entries = await m.find(CampaignEntry, { where: { campaignId: c.id }, order: { entryDate: 'ASC', createdAt: 'ASC' } });
    const posted = entries.filter((e) => e.status === CampaignEntryStatus.POSTED);
    const journal = await this.entries([...entries.flatMap((e) => [e.journalEntryId, e.reversalEntryId]), c.closingEntryId]);
    const accountIds = [...new Set([...entries.map((e) => e.accountId), c.fundAccountId, c.closeAccountId].filter(Boolean) as string[])];
    const accounts = accountIds.length ? await m.find(Account, { where: { id: In(accountIds) }, withDeleted: true }) : [];
    const acct = (aid: string | null) => {
      const a = aid ? accounts.find((x) => x.id === aid) : null;
      return a ? { id: a.id, code: a.code, name: a.name } : null;
    };
    const names = await userNames(m, [...entries.map((e) => e.createdBy), c.closedBy]);
    let running = 0n;
    const statement = campaignStatement(this.lines(posted), c.budget);
    const categories: { category: string }[] = await m.query(`SELECT DISTINCT category FROM campaign_entries ORDER BY category`);
    return {
      ...this.shapeCampaign(c),
      fundAccount: acct(c.fundAccountId),
      closeAccount: acct(c.closeAccountId),
      closingEntry: this.entryRef(journal, c.closingEntryId),
      closedByName: c.closedBy ? names.get(c.closedBy) ?? null : null,
      statement,
      entries: entries.map((e) => {
        const live = e.status === CampaignEntryStatus.POSTED;
        if (live) running += e.type === CampaignEntryType.INCOME ? toPaisa(e.amount) : -toPaisa(e.amount);
        return {
          id: e.id,
          entryDate: e.entryDate,
          type: e.type,
          category: e.category,
          description: e.description,
          amount: e.amount,
          account: acct(e.accountId),
          status: e.status,
          balance: live ? fromPaisa(running) : null,
          entry: this.entryRef(journal, e.journalEntryId),
          reversal: this.entryRef(journal, e.reversalEntryId),
          createdByName: e.createdBy ? names.get(e.createdBy) ?? null : null,
        };
      }),
      categories: categories.map((x) => x.category),
    };
  }

  async create(dto: CreateCampaignDto, user: AuthenticatedUser) {
    const id = await this.dataSource.transaction(async (m) => {
      const unit = await this.activeUnit(m, dto.businessUnitId, user);
      this.assertPeriod(dto.startDate, dto.endDate ?? null);
      await this.assertNameFree(m, dto.name.trim());
      const c = await m.save(
        m.create(Campaign, {
          name: dto.name.trim(),
          businessUnitId: unit.id,
          startDate: dto.startDate,
          endDate: dto.endDate ?? null,
          status: CampaignStatus.OPEN,
          budget: this.checkBudget(dto.budget ?? []),
          notes: dto.notes?.trim() || null,
          createdBy: user.id,
        }),
      );
      const fund = await this.createFund(m, c, unit, user.id);
      await m.update(Campaign, c.id, { fundAccountId: fund.id });
      return c.id;
    });
    return this.findOne(id, user);
  }

  async update(id: string, dto: UpdateCampaignDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const c = await this.lock(m, id, user);
      if (dto.name !== undefined && dto.name.trim() !== c.name) {
        await this.assertNameFree(m, dto.name.trim(), c.id);
        c.name = dto.name.trim();
        if (c.fundAccountId) await m.update(Account, c.fundAccountId, { name: this.fundName(c.name) });
      }
      const start = dto.startDate ?? c.startDate;
      const end = dto.endDate !== undefined ? dto.endDate : c.endDate;
      this.assertPeriod(start, end);
      const first = await m.findOne(CampaignEntry, { where: { campaignId: c.id, status: CampaignEntryStatus.POSTED }, order: { entryDate: 'ASC' } });
      if (first && first.entryDate < start) throw new BadRequestException(`It has money recorded on ${first.entryDate} — it can’t start after that.`);
      await m.update(Campaign, c.id, {
        name: c.name,
        startDate: start,
        endDate: end,
        budget: dto.budget !== undefined ? this.checkBudget(dto.budget) : c.budget,
        notes: dto.notes !== undefined ? dto.notes?.trim() || null : c.notes,
        updatedBy: user.id,
      } as Partial<Campaign>);
    });
    return this.findOne(id, user);
  }

  /** Money raised for, or spent on, the campaign — posted at once through its fund. */
  async addEntry(id: string, dto: CampaignEntryDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const c = await this.lock(m, id, user);
      if (c.status !== CampaignStatus.OPEN) throw new ConflictException('The campaign is closed — reopen it to record more.');
      if (!isIsoDate(dto.entryDate) || dto.entryDate > businessDate()) throw new BadRequestException('Enter a real date, not in the future.');
      if (dto.entryDate < c.startDate) throw new BadRequestException(`The campaign starts on ${c.startDate}.`);
      if (toPaisa(dto.amount) <= 0n) throw new BadRequestException('Enter an amount.');
      const account = await payingAccount(m, dto.accountId, c.businessUnitId);
      const amount = fromPaisa(toPaisa(dto.amount));
      const income = dto.type === CampaignEntryType.INCOME;
      const entry = (await this.journal.post(
        {
          entryDate: dto.entryDate,
          businessUnitId: c.businessUnitId,
          description: `${c.name}: ${dto.description.trim()}`.slice(0, 500),
          reference: 'CAMPAIGN',
          kind: income ? JournalEntryKind.MONEY_IN : JournalEntryKind.MONEY_OUT,
          lines: income
            ? [
                { accountId: account.id, debit: amount, memo: dto.category.trim() },
                { accountId: c.fundAccountId as string, credit: amount, memo: dto.category.trim() },
              ]
            : [
                { accountId: c.fundAccountId as string, debit: amount, memo: dto.category.trim() },
                { accountId: account.id, credit: amount, memo: dto.category.trim() },
              ],
        },
        user,
        { manager: m, source: JournalEntrySource.CAMPAIGNS },
      )) as JournalEntry;
      await m.save(
        m.create(CampaignEntry, {
          campaignId: c.id,
          entryDate: dto.entryDate,
          type: dto.type,
          category: dto.category.trim(),
          description: dto.description.trim(),
          amount,
          accountId: account.id,
          status: CampaignEntryStatus.POSTED,
          journalEntryId: entry.id,
          createdBy: user.id,
        }),
      );
    });
    return this.findOne(id, user);
  }

  async reverseEntry(id: string, entryId: string, dto: ReverseCampaignEntryDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const c = await this.lock(m, id, user);
      if (c.status !== CampaignStatus.OPEN) throw new ConflictException('The campaign is closed — reopen it first.');
      const e = await m.findOne(CampaignEntry, { where: { id: entryId, campaignId: c.id } });
      if (!e) throw new NotFoundException('Entry not found');
      if (e.status !== CampaignEntryStatus.POSTED) throw new ConflictException('It’s already reversed.');
      const reversalId = await this.journal.reverseWithin(
        m,
        e.journalEntryId,
        { reason: dto.reason?.trim() || 'Campaign entry reversed', entryDate: businessDate() },
        user,
        { fromCampaigns: true, source: JournalEntrySource.CAMPAIGNS },
      );
      await m.update(CampaignEntry, e.id, { status: CampaignEntryStatus.REVERSED, reversalEntryId: reversalId, updatedBy: user.id } as Partial<CampaignEntry>);
    });
    return this.findOne(id, user);
  }

  /**
   * Balances the campaign off. A shortfall (the unit carried it) is charged
   * to an expense; a surplus is taken into income. Either way the fund ends
   * at zero, and the campaign's net lands in the unit's P&L once.
   */
  async close(id: string, dto: CloseCampaignDto, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const c = await this.lock(m, id, user);
      if (c.status !== CampaignStatus.OPEN) throw new ConflictException('It’s already closed.');
      const closedOn = dto.closedOn ?? businessDate();
      if (!isIsoDate(closedOn) || closedOn > businessDate()) throw new BadRequestException('Enter a real closing date, not in the future.');
      const posted = await m.find(CampaignEntry, { where: { campaignId: c.id, status: CampaignEntryStatus.POSTED } });
      const last = posted.reduce((d, e) => (e.entryDate > d ? e.entryDate : d), c.startDate);
      if (closedOn < last) throw new BadRequestException(`It has money recorded up to ${last} — close it on or after that.`);
      const balance = toPaisa(campaignStatement(this.lines(posted)).balance);
      let closingEntryId: string | null = null;
      let closeAccountId: string | null = null;
      if (balance !== 0n) {
        if (!dto.accountId) {
          throw new BadRequestException(
            balance < 0n ? 'Choose the expense to charge the shortfall to.' : 'Choose the income account to take the surplus into.',
          );
        }
        const want = balance < 0n ? AccountType.EXPENSE : AccountType.INCOME;
        const target = await m.findOne(Account, { where: { id: dto.accountId } });
        if (!target || target.type !== want || !target.isActive || !target.isPostable || target.partnerId || target.loanId || target.campaignId) {
          throw new BadRequestException(balance < 0n ? 'The shortfall goes to an expense account.' : 'The surplus goes to an income account.');
        }
        const amount = fromPaisa(balance < 0n ? -balance : balance);
        const entry = (await this.journal.post(
          {
            entryDate: closedOn,
            businessUnitId: c.businessUnitId,
            description: `${c.name} closed — ${balance < 0n ? 'shortfall carried by the unit' : 'surplus taken into income'}`,
            reference: 'CAMPAIGN',
            kind: JournalEntryKind.GENERAL,
            lines:
              balance < 0n
                ? [
                    { accountId: target.id, debit: amount, memo: c.name },
                    { accountId: c.fundAccountId as string, credit: amount, memo: 'Closed' },
                  ]
                : [
                    { accountId: c.fundAccountId as string, debit: amount, memo: 'Closed' },
                    { accountId: target.id, credit: amount, memo: c.name },
                  ],
          },
          user,
          { manager: m, source: JournalEntrySource.CAMPAIGNS },
        )) as JournalEntry;
        closingEntryId = entry.id;
        closeAccountId = target.id;
      }
      await m.update(Campaign, c.id, {
        status: CampaignStatus.CLOSED,
        closingEntryId,
        closeAccountId,
        closedOn,
        closedBy: user.id,
        endDate: c.endDate ?? closedOn,
        updatedBy: user.id,
      } as Partial<Campaign>);
    });
    return this.findOne(id, user);
  }

  /** Undoes the closing entry, so more can be recorded. */
  async reopen(id: string, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (m) => {
      const c = await this.lock(m, id, user);
      if (c.status !== CampaignStatus.CLOSED) throw new ConflictException('It isn’t closed.');
      if (c.closingEntryId) {
        await this.journal.reverseWithin(
          m,
          c.closingEntryId,
          { reason: `${c.name} reopened`, entryDate: businessDate() },
          user,
          { fromCampaigns: true, source: JournalEntrySource.CAMPAIGNS },
        );
      }
      await m.update(Campaign, c.id, {
        status: CampaignStatus.OPEN,
        closingEntryId: null,
        closeAccountId: null,
        closedOn: null,
        closedBy: null,
        updatedBy: user.id,
      } as Partial<Campaign>);
    });
    return this.findOne(id, user);
  }

  // --- Internals ---------------------------------------------------------------------------

  private lines(entries: CampaignEntry[]) {
    return entries.map((e) => ({ date: e.entryDate, type: e.type, category: e.category, amount: e.amount }));
  }

  private fundName(name: string) {
    return `Campaign — ${name}`.slice(0, 120);
  }

  /** The campaign's own fund, one code apart in the host unit's payable range (like a loan's account). */
  private async createFund(m: EntityManager, c: Campaign, unit: BusinessUnit, actorId: string) {
    const cls = await m.findOne(AccountClass, { where: { key: SystemAccountClass.PAYABLE } });
    if (!cls) throw new BadRequestException('The payable account class is missing — run the seed.');
    const settings = await getChartSettings(m);
    const codes = (await m.find(Account, { select: { code: true }, withDeleted: true })).map((a) => a.code);
    const taken = codes.map((code) => parseNumber(settings.unitCodePattern, code, unit.code)).filter((n): n is number => n !== null);
    const num = nextNumber(taken, cls.codeStart + 1, cls.codeEnd, 1);
    if (num === null) {
      throw new BadRequestException(`No free codes left in ${cls.name}'s range for ${unit.name} — widen it in Accounts → Settings.`);
    }
    return m.save(
      m.create(Account, {
        code: buildCode(settings.unitCodePattern, num, unit.code),
        name: this.fundName(c.name),
        type: cls.type,
        classId: cls.id,
        businessUnitId: unit.id,
        parentId: null,
        isPostable: true,
        isSystem: true,
        systemKey: null,
        isReserveOffset: false,
        partnerId: null,
        loanId: null,
        campaignId: c.id,
        description: 'Money raised for the campaign less money spent on it — posted only from the Campaigns screen.',
        createdBy: actorId,
      }),
    );
  }

  private async lock(m: EntityManager, id: string, user: AuthenticatedUser) {
    const c = await m.findOne(Campaign, { where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!c) throw new NotFoundException('Campaign not found');
    assertUnitAccess(user, c.businessUnitId);
    return c;
  }

  private async activeUnit(m: EntityManager, id: string, user: AuthenticatedUser) {
    assertUnitAccess(user, id);
    const unit = await m.findOne(BusinessUnit, { where: { id } });
    if (!unit) throw new BadRequestException('Business unit not found');
    if (!unit.isActive) throw new BadRequestException(`${unit.name} is inactive.`);
    return unit;
  }

  private assertPeriod(start: string, end: string | null) {
    if (!isIsoDate(start)) throw new BadRequestException('startDate is not a real date');
    if (end !== null && (!isIsoDate(end) || end < start)) throw new BadRequestException('The end date must be a real date on or after the start.');
  }

  private async assertNameFree(m: EntityManager, name: string, exceptId?: string) {
    const clash = await m.findOne(Campaign, { where: { name, ...(exceptId ? { id: Not(exceptId) } : {}) } });
    if (clash) throw new ConflictException(`There's already a campaign called ${name}.`);
  }

  private checkBudget(lines: { label: string; amount: string }[]) {
    return lines.map((l) => ({ label: l.label.trim(), amount: fromPaisa(toPaisa(l.amount)) })).filter((l) => l.label && toPaisa(l.amount) > 0n);
  }

  private async entries(ids: (string | null)[]) {
    const wanted = ids.filter(Boolean) as string[];
    return wanted.length ? this.dataSource.manager.find(JournalEntry, { where: { id: In(wanted) } }) : [];
  }

  private entryRef(entries: JournalEntry[], id: string | null) {
    const e = id ? entries.find((x) => x.id === id) : null;
    return e ? { id: e.id, displayNo: formatEntryNo(e.entryNo) } : null;
  }

  private shapeCampaign(c: Campaign) {
    return {
      id: c.id,
      name: c.name,
      businessUnit: { id: c.businessUnit?.id ?? c.businessUnitId, code: c.businessUnit?.code ?? '?', name: c.businessUnit?.name ?? '?' },
      startDate: c.startDate,
      endDate: c.endDate,
      status: c.status,
      budget: c.budget,
      notes: c.notes,
      closedOn: c.closedOn,
    };
  }
}

