import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, In, Repository } from 'typeorm';
import {
  AccountType,
  JournalEntryKind,
  JournalEntrySource,
} from '@multizoo/types';
import { businessDate, fromPaisa, isIsoDate, toPaisa } from '@multizoo/utils';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalLine } from './entities/journal-line.entity';
import { Account } from '../accounts/entities/account.entity';
import { BusinessUnit } from '../business-units/entities/business-unit.entity';
import { User } from '../users/entities/user.entity';
import type { AuthenticatedUser } from '../users/users.service';
import {
  assertUnitAccess,
  visibleUnitIds,
} from '../../../common/scope/unit-scope';
import { assertBalanced, swapSides, UnbalancedEntryError } from './ledger-math';
import { ensureReserveOffset, isBucketReserve, reserveKind } from '../accounts/reserves';
import {
  ListJournalEntriesQueryDto,
  ReverseJournalEntryDto,
} from './dto/journal-entry.dto';

export interface PostEntryInput {
  entryDate: string;
  businessUnitId: string;
  description: string;
  reference?: string | null;
  kind: JournalEntryKind;
  lines: EntryLineInput[];
  reversalOfId?: string | null;
  /**
   * Money out only: the reserve this payment comes out of (e.g. feed paid
   * from Feed Reserve). The earmark is released in the same entry.
   */
  reserveAccountId?: string | null;
}

interface EntryLineInput {
  accountId: string;
  debit?: string | null;
  credit?: string | null;
  memo?: string | null;
}

export interface PostOptions {
  /** Run inside a caller's transaction (e.g. the business-unit wizard). */
  manager?: EntityManager;
  source?: JournalEntrySource;
  /** Only the allocation engine and reversals may touch reserve accounts freely. */
  allowReserve?: boolean;
  /** Reversals must still work after an account is deactivated. */
  allowInactiveAccounts?: boolean;
}

export interface ReverseOptions {
  /** Waterfall entries are undone from the Allocation screen, which keeps its run record in step. */
  fromAllocationEngine?: boolean;
  source?: JournalEntrySource;
}

export function formatEntryNo(entryNo: number): string {
  return `JE-${String(entryNo).padStart(6, '0')}`;
}

@Injectable()
export class JournalService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,

    @InjectRepository(JournalEntry)
    private readonly entryRepo: Repository<JournalEntry>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /** Posts a balanced entry. The only way anything is ever written to the ledger. */
  async post(
    input: PostEntryInput,
    user: AuthenticatedUser,
    opts: PostOptions = {},
  ) {
    if (opts.manager) return this.postWithin(opts.manager, input, user, opts);
    const saved = await this.dataSource.transaction((m) =>
      this.postWithin(m, input, user, opts),
    );
    return this.findOne(saved.id, user);
  }

  private async postWithin(
    m: EntityManager,
    input: PostEntryInput,
    user: AuthenticatedUser,
    opts: PostOptions,
  ): Promise<JournalEntry> {
    assertUnitAccess(user, input.businessUnitId);

    const unit = await m.findOne(BusinessUnit, {
      where: { id: input.businessUnitId },
    });
    if (!unit) throw new BadRequestException('Business unit not found');
    if (!unit.isActive) {
      throw new BadRequestException(
        `${unit.name} is inactive — entries can't be posted to it.`,
      );
    }

    if (!isIsoDate(input.entryDate)) {
      throw new BadRequestException('entryDate is not a real calendar date');
    }
    if (input.entryDate > businessDate()) {
      throw new BadRequestException('Entries cannot be dated in the future.');
    }

    try {
      assertBalanced(input.lines);
    } catch (err) {
      if (err instanceof UnbalancedEntryError)
        throw new BadRequestException(err.message);
      throw new BadRequestException((err as Error).message);
    }

    const byId = await this.loadAccounts(m, input.lines.map((l) => l.accountId));
    for (const line of input.lines) {
      if (!byId.has(line.accountId))
        throw new BadRequestException(`Account ${line.accountId} not found`);
    }

    this.assertKindShape(input, byId);

    // Reserve movements a person's entry implies (paying from a reserve, a
    // drawing releasing a partner's reserve) are added here, by the ledger —
    // never typed in — so the earmarks always follow the money.
    const { lines, allowedReserveIds } = opts.allowReserve
      ? { lines: input.lines, allowedReserveIds: new Set<string>() }
      : await this.withReserveMovements(m, unit, input, byId, user.id);

    for (const line of lines) {
      const account = byId.get(line.accountId) as Account;
      if (!account.isActive && !opts.allowInactiveAccounts) {
        throw new BadRequestException(`${account.name} is inactive.`);
      }
      if (!account.isPostable) {
        throw new BadRequestException(
          `${account.name} is a group heading — post to one of its sub-accounts.`,
        );
      }
      if (
        account.accountClass.isReserve &&
        !opts.allowReserve &&
        !allowedReserveIds.has(account.id)
      ) {
        throw new BadRequestException(
          `${account.name} is a reserve — reserves are filled only by the income allocation engine. To spend from one, choose it under “Paid out of reserve”.`,
        );
      }
      if (account.businessUnitId && account.businessUnitId !== unit.id) {
        throw new BadRequestException(
          `${account.name} (${account.code}) belongs to another business unit. Moving money between units is an inter-unit transfer, which needs Partner approval.`,
        );
      }
    }

    const entry = m.create(JournalEntry, {
      entryDate: input.entryDate,
      businessUnitId: unit.id,
      description: input.description.trim(),
      reference: input.reference?.trim() || null,
      kind: input.kind,
      source: opts.source ?? JournalEntrySource.MANUAL,
      reversalOfId: input.reversalOfId ?? null,
      reversedById: null,
      createdBy: user.id,
      updatedBy: null,
      lines: lines.map((line, i) =>
        m.create(JournalLine, {
          lineNo: i + 1,
          accountId: line.accountId,
          businessUnitId: unit.id,
          debit: fromPaisa(line.debit ? toPaisa(line.debit) : 0n),
          credit: fromPaisa(line.credit ? toPaisa(line.credit) : 0n),
          memo: line.memo?.trim() || null,
          costCentre: null,
        }),
      ),
    });

    return m.save(entry);
  }

  private async loadAccounts(m: EntityManager, ids: string[]) {
    const accounts = ids.length
      ? await m.find(Account, {
          where: { id: In([...new Set(ids)]) },
          relations: { accountClass: true },
        })
      : [];
    return new Map(accounts.map((a) => [a.id, a]));
  }

  /**
   * The earmark side of an everyday entry:
   *  - money out "paid out of" a reserve releases that much of the reserve;
   *  - a partner drawing releases the partner's profit reserve in the unit
   *    (the "Taken by …" withdrawals in the workbook's profit-reserve blocks);
   *  - a reserve transfer moves an earmark between two buckets.
   * Released lines go against the unit's Earmarked Funds offset, so cash is
   * counted once — see accounts/reserves.ts.
   */
  private async withReserveMovements(
    m: EntityManager,
    unit: BusinessUnit,
    input: PostEntryInput,
    byId: Map<string, Account>,
    actorId: string,
  ): Promise<{ lines: EntryLineInput[]; allowedReserveIds: Set<string> }> {
    const lines = [...input.lines];
    const allowed = new Set<string>();
    const sumSide = (side: 'debit' | 'credit', pick: (a: Account) => boolean) =>
      input.lines.reduce(
        (s, l) => (l[side] && pick(byId.get(l.accountId) as Account) ? s + toPaisa(l[side] as string) : s),
        0n,
      );

    const release = async (reserve: Account, amount: bigint, memo: string) => {
      const offset = await ensureReserveOffset(m, unit, actorId);
      const full = await m.findOneOrFail(Account, { where: { id: offset.id }, relations: { accountClass: true } });
      byId.set(full.id, full);
      byId.set(reserve.id, reserve);
      allowed.add(full.id).add(reserve.id);
      lines.push(
        { accountId: full.id, debit: fromPaisa(amount), memo },
        { accountId: reserve.id, credit: fromPaisa(amount), memo },
      );
    };

    if (input.reserveAccountId) {
      if (input.kind !== JournalEntryKind.MONEY_OUT) {
        throw new BadRequestException('Only a money-out entry can be paid out of a reserve.');
      }
      const reserve = await m.findOne(Account, {
        where: { id: input.reserveAccountId },
        relations: { accountClass: true },
      });
      if (!reserve || !isBucketReserve(reserve) || reserve.businessUnitId !== unit.id || !reserve.isActive) {
        throw new BadRequestException(`Choose one of ${unit.name}'s reserves to pay out of.`);
      }
      const paid = sumSide('credit', (a) => a.accountClass.isLiquid);
      await release(reserve, paid, `Paid out of ${reserve.name}`);
    }

    if (input.kind === JournalEntryKind.PARTNER_DRAWING) {
      const equity = input.lines
        .map((l) => byId.get(l.accountId) as Account)
        .find((a) => a.partnerId);
      const reserve = equity
        ? await m.findOne(Account, {
            where: { businessUnitId: unit.id, partnerId: equity.partnerId as string },
            relations: { accountClass: true },
          })
        : null;
      if (reserve?.isActive) {
        const drawn = sumSide('credit', (a) => a.accountClass.isLiquid);
        await release(reserve, drawn, `Drawn by ${equity?.name.replace(/ — .*$/, '')}`);
      }
    }

    if (input.kind === JournalEntryKind.RESERVE_TRANSFER) {
      input.lines.forEach((l) => allowed.add(l.accountId));
    }

    return { lines, allowedReserveIds: allowed };
  }

  /**
   * Keeps the plain-language kinds honest, so a report filtering on
   * "money in" can trust it: money in lands in cash/bank/wallet, money out
   * leaves from it, a transfer only moves between them.
   */
  private assertKindShape(input: PostEntryInput, byId: Map<string, Account>) {
    const isLiquid = (id: string) =>
      (byId.get(id) as Account).accountClass.isLiquid;
    const debits = input.lines.filter((l) => l.debit && toPaisa(l.debit) > 0n);
    const credits = input.lines.filter(
      (l) => l.credit && toPaisa(l.credit) > 0n,
    );

    switch (input.kind) {
      case JournalEntryKind.MONEY_IN:
        if (
          !debits.some((l) => isLiquid(l.accountId)) ||
          credits.some((l) => isLiquid(l.accountId))
        ) {
          throw new BadRequestException(
            'Money in must be received into a cash, bank or wallet account from a non-cash account (e.g. a sales account).',
          );
        }
        break;
      case JournalEntryKind.MONEY_OUT:
        if (
          !credits.some((l) => isLiquid(l.accountId)) ||
          debits.some((l) => isLiquid(l.accountId))
        ) {
          throw new BadRequestException(
            'Money out must be paid from a cash, bank or wallet account to a non-cash account (e.g. an expense).',
          );
        }
        if (debits.some((l) => (byId.get(l.accountId) as Account).partnerId)) {
          throw new BadRequestException(
            'Cash taken by a partner is a partner drawing, not an expense — use “Partner drawing”.',
          );
        }
        break;
      case JournalEntryKind.TRANSFER:
        if (!input.lines.every((l) => isLiquid(l.accountId))) {
          throw new BadRequestException(
            'A transfer can only move money between cash, bank and wallet accounts.',
          );
        }
        break;
      case JournalEntryKind.OPENING_BALANCE:
        if (
          !input.lines.some(
            (l) =>
              (byId.get(l.accountId) as Account).type === AccountType.EQUITY,
          )
        ) {
          throw new BadRequestException(
            'An opening balance must be offset against Opening Balance Equity.',
          );
        }
        break;
      case JournalEntryKind.PARTNER_DRAWING: {
        const partners = new Set(
          debits.map((l) => {
            const a = byId.get(l.accountId) as Account;
            return a.partnerId && a.type === AccountType.EQUITY ? a.partnerId : null;
          }),
        );
        if (
          !debits.length ||
          partners.has(null) ||
          partners.size !== 1 ||
          !credits.length ||
          !credits.every((l) => isLiquid(l.accountId))
        ) {
          throw new BadRequestException(
            "A drawing is paid from cash, bank or wallet to one partner's capital & current account.",
          );
        }
        break;
      }
      case JournalEntryKind.RESERVE_TRANSFER:
        if (!input.lines.every((l) => isBucketReserve(byId.get(l.accountId) as Account))) {
          throw new BadRequestException(
            "A reserve transfer moves an earmark between this unit's reserve buckets — nothing else.",
          );
        }
        break;
      case JournalEntryKind.ALLOCATION:
        if (!input.lines.every((l) => (byId.get(l.accountId) as Account).accountClass.isReserve)) {
          throw new BadRequestException('An allocation only moves earmarks between reserves.');
        }
        break;
      default:
        break;
    }
  }

  async reverse(
    id: string,
    dto: ReverseJournalEntryDto,
    user: AuthenticatedUser,
  ) {
    const reversalId = await this.dataSource.transaction((m) =>
      this.reverseWithin(m, id, dto, user),
    );
    return this.findOne(reversalId, user);
  }

  /** Reverses an entry inside a caller's transaction; returns the reversal's id. */
  async reverseWithin(
    m: EntityManager,
    id: string,
    dto: ReverseJournalEntryDto,
    user: AuthenticatedUser,
    opts: ReverseOptions = {},
  ): Promise<string> {
    // Row lock: two people clicking "Reverse" at once must not both succeed.
    const original = await m.findOne(JournalEntry, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!original) throw new NotFoundException('Entry not found');
    assertUnitAccess(user, original.businessUnitId);

    if (original.source === JournalEntrySource.ALLOCATION && !opts.fromAllocationEngine) {
      throw new BadRequestException(
        `${formatEntryNo(original.entryNo)} is a day's income allocation — undo or re-run it from the Allocation screen so the day's record stays in step.`,
      );
    }
    if (original.kind === JournalEntryKind.REVERSAL) {
      throw new BadRequestException(
        'A reversal cannot itself be reversed — post a new, correct entry instead.',
      );
    }
    if (original.reversedById) {
      throw new BadRequestException(
        `${formatEntryNo(original.entryNo)} has already been reversed.`,
      );
    }

    const entryDate = dto.entryDate ?? businessDate();
    if (entryDate < original.entryDate) {
      throw new BadRequestException(
        'A reversal cannot be dated before the entry it reverses.',
      );
    }

    const lines = await m.find(JournalLine, {
      where: { entryId: id },
      order: { lineNo: 'ASC' },
    });
    const reason = dto.reason?.trim();

    const reversal = await this.postWithin(
      m,
      {
        entryDate,
        businessUnitId: original.businessUnitId,
        description: `Reversal of ${formatEntryNo(original.entryNo)}${reason ? ` — ${reason}` : ''}`,
        reference: original.reference,
        kind: JournalEntryKind.REVERSAL,
        reversalOfId: original.id,
        lines: swapSides(
          lines.map((l) => ({
            accountId: l.accountId,
            debit: l.debit,
            credit: l.credit,
            memo: l.memo,
          })),
        ),
      },
      user,
      {
        allowReserve: true,
        allowInactiveAccounts: true,
        source: opts.source ?? original.source,
      },
    );

    await m.update(JournalEntry, original.id, {
      reversedById: reversal.id,
      updatedBy: user.id,
    });
    return reversal.id;
  }

  async findOne(id: string, user: AuthenticatedUser) {
    const entry = await this.entryRepo
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.businessUnit', 'bu')
      .leftJoinAndSelect('e.lines', 'l')
      .leftJoinAndSelect('l.account', 'a')
      .leftJoinAndSelect('a.accountClass', 'cls')
      .where('e.id = :id', { id })
      .orderBy('l.lineNo', 'ASC')
      .getOne();
    if (!entry) throw new NotFoundException('Entry not found');
    assertUnitAccess(user, entry.businessUnitId);

    const [shaped] = await this.shape([entry]);
    const related = await this.entryRepo.find({
      where: {
        id: In(
          [entry.reversalOfId, entry.reversedById].filter(Boolean) as string[],
        ),
      },
    });
    const noOf = (rid: string | null) => {
      const r = related.find((x) => x.id === rid);
      return r ? formatEntryNo(r.entryNo) : null;
    };
    return {
      ...shaped,
      reversalOfNo: noOf(entry.reversalOfId),
      reversedByNo: noOf(entry.reversedById),
    };
  }

  async list(query: ListJournalEntriesQueryDto, user: AuthenticatedUser) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;

    const qb = this.entryRepo
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.businessUnit', 'bu')
      .leftJoinAndSelect('e.lines', 'l')
      .leftJoinAndSelect('l.account', 'a')
      .leftJoinAndSelect('a.accountClass', 'cls')
      .orderBy('e.entryDate', 'DESC')
      .addOrderBy('e.entryNo', 'DESC')
      .addOrderBy('l.lineNo', 'ASC');

    const scope = visibleUnitIds(user);
    if (scope) {
      if (!scope.length) return { items: [], total: 0, page, limit };
      qb.andWhere('e.businessUnitId IN (:...scope)', { scope });
    }
    if (query.businessUnitId) {
      qb.andWhere('e.businessUnitId = :unitId', {
        unitId: query.businessUnitId,
      });
    }
    if (query.from) qb.andWhere('e.entryDate >= :from', { from: query.from });
    if (query.to) qb.andWhere('e.entryDate <= :to', { to: query.to });
    if (query.kind) qb.andWhere('e.kind = :kind', { kind: query.kind });
    if (query.accountId) {
      qb.andWhere(
        'e.id IN (SELECT jl."entryId" FROM journal_lines jl WHERE jl."accountId" = :accountId)',
        { accountId: query.accountId },
      );
    }
    const search = query.search?.trim();
    if (search) {
      const digits = search.replace(/^JE-?/i, '').replace(/^0+/, '');
      qb.andWhere(
        new Brackets((w) => {
          w.where('e.description ILIKE :q', { q: `%${search}%` }).orWhere(
            'e.reference ILIKE :q',
          );
          if (/^\d+$/.test(digits)) {
            w.orWhere('e.entryNo = :no', { no: Number(digits) });
          }
        }),
      );
    }

    const [entries, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { items: await this.shape(entries), total, page, limit };
  }

  /** Flattens an entry for the API: display number, total, author name. */
  private async shape(entries: JournalEntry[]) {
    const authorIds = [
      ...new Set(entries.map((e) => e.createdBy).filter(Boolean) as string[]),
    ];
    const authors = authorIds.length
      ? await this.userRepo.find({
          where: { id: In(authorIds) },
          withDeleted: true,
        })
      : [];
    const nameOf = new Map(authors.map((u) => [u.id, u.fullName]));

    return entries.map((e) => {
      const lines = [...(e.lines ?? [])].sort((a, b) => a.lineNo - b.lineNo);
      return {
        id: e.id,
        entryNo: e.entryNo,
        displayNo: formatEntryNo(e.entryNo),
        entryDate: e.entryDate,
        description: e.description,
        reference: e.reference,
        kind: e.kind,
        source: e.source,
        businessUnit: e.businessUnit
          ? {
              id: e.businessUnit.id,
              code: e.businessUnit.code,
              name: e.businessUnit.name,
            }
          : null,
        amount: fromPaisa(lines.reduce((sum, l) => sum + toPaisa(l.debit), 0n)),
        reversalOfId: e.reversalOfId,
        reversedById: e.reversedById,
        createdAt: e.createdAt,
        createdBy: e.createdBy,
        createdByName: e.createdBy ? (nameOf.get(e.createdBy) ?? null) : null,
        lines: lines.map((l) => ({
          id: l.id,
          lineNo: l.lineNo,
          accountId: l.accountId,
          accountCode: l.account?.code,
          accountName: l.account?.name,
          accountClassName: l.account?.accountClass?.name ?? null,
          isLiquid: l.account?.accountClass?.isLiquid ?? false,
          reserveKind: l.account ? reserveKind(l.account) : null,
          debit: l.debit,
          credit: l.credit,
          memo: l.memo,
        })),
      };
    });
  }
}
