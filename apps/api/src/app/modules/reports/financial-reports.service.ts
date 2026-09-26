import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not } from 'typeorm';
import { AccountType, JournalEntryKind, Permission } from '@multizoo/types';
import { businessDate, fromPaisa, toPaisa } from '@multizoo/utils';
import type { AuthenticatedUser } from '../users/users.service';
import { assertUnitAccess, hasPermission, visibleUnitIds } from '../../../common/scope/unit-scope';
import { Account } from '../accounts/entities/account.entity';
import { BusinessUnit } from '../business-units/entities/business-unit.entity';
import { Partner } from '../allocation/entities/partner.entity';
import { LedgerService } from '../ledger/ledger.service';
import { formatEntryNo } from '../journal/journal.service';
import { buildPnl, partnerShares, partnerStatement, shareOf, type PartnerShare, type PnlAccount, type PnlMovement, type StatementMonthInput } from './report-math';
import { monthEnd } from './report-periods';

export interface UnitRef {
  id: string;
  code: string;
  name: string;
}

interface MovementRow {
  accountId: string;
  unitId: string;
  month: string;
  debit: string;
  credit: string;
}

/**
 * The ledger queries the reporting suite adds: profit & loss by unit or
 * month, expense lines by category, the partner statement and headcount &
 * payroll cost. Everything is summed from journal lines (and finalised
 * payslips) at the moment the report is generated — nothing is stored.
 */
@Injectable()
export class FinancialReportsService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
  ) {}

  /** The units a report covers: one (checked), or every unit the caller can see. */
  async scopeUnits(user: AuthenticatedUser, businessUnitId?: string): Promise<UnitRef[]> {
    if (businessUnitId) assertUnitAccess(user, businessUnitId);
    const scope = businessUnitId ? [businessUnitId] : visibleUnitIds(user);
    if (scope && !scope.length) return [];
    const units = await this.dataSource.manager.find(BusinessUnit, {
      where: scope ? { id: In(scope) } : {},
      order: { code: 'ASC' },
    });
    if (businessUnitId && !units.length) throw new NotFoundException('Business unit not found');
    return units.map((u) => ({ id: u.id, code: u.code, name: u.name }));
  }

  private async plAccounts(): Promise<PnlAccount[]> {
    const accounts = await this.dataSource.manager.find(Account, {
      where: { type: In([AccountType.INCOME, AccountType.EXPENSE]) },
      withDeleted: true,
    });
    return accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type, parentId: a.parentId }));
  }

  /** Income and expense movements per account × unit × month. */
  private async movements(from: string, to: string, unitIds: string[]): Promise<MovementRow[]> {
    if (!unitIds.length) return [];
    return this.dataSource.query(
      `SELECT l."accountId", l."businessUnitId" AS "unitId", to_char(e."entryDate", 'YYYY-MM') AS month,
              COALESCE(SUM(l.debit), 0)::text AS debit, COALESCE(SUM(l.credit), 0)::text AS credit
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l."entryId"
         JOIN accounts a ON a.id = l."accountId"
        WHERE a.type IN ('INCOME', 'EXPENSE')
          AND e."entryDate" BETWEEN $1 AND $2
          AND l."businessUnitId" = ANY($3)
        GROUP BY 1, 2, 3`,
      [from, to, unitIds],
    );
  }

  /**
   * Each unit's partner shares from its allocation rule in force on a date —
   * the partner lines' weights (MIK 70 / MQK 30 on the Zoo).
   */
  async sharesOn(dateIso: string, unitIds: string[]): Promise<Map<string, PartnerShare[]>> {
    if (!unitIds.length) return new Map();
    const rows: { unitId: string; ruleId: string; partnerId: string | null; weight: string | null }[] = await this.dataSource.query(
      `WITH in_force AS (
         SELECT DISTINCT ON (r."businessUnitId") r.id, r."businessUnitId"
           FROM allocation_rules r
          WHERE r.status = 'APPROVED' AND r."effectiveFrom" <= $1 AND r."businessUnitId" = ANY($2)
          ORDER BY r."businessUnitId", r."effectiveFrom" DESC, r.version DESC)
       SELECT f."businessUnitId" AS "unitId", f.id AS "ruleId", l."partnerId", l.weight::text AS weight
         FROM in_force f
         JOIN allocation_tranches t ON t."ruleId" = f.id
         JOIN allocation_lines l ON l."trancheId" = t.id AND l."partnerId" IS NOT NULL`,
      [dateIso, unitIds],
    );
    const byUnit = new Map<string, { partnerId: string; weight: string }[]>();
    for (const r of rows) {
      if (!r.partnerId || !r.weight) continue;
      byUnit.set(r.unitId, [...(byUnit.get(r.unitId) ?? []), { partnerId: r.partnerId, weight: r.weight }]);
    }
    return new Map([...byUnit.entries()].map(([u, w]) => [u, partnerShares(w)]));
  }

  async partnersById(): Promise<Map<string, Partner>> {
    const partners = await this.dataSource.manager.find(Partner, { withDeleted: true });
    return new Map(partners.map((p) => [p.id, p]));
  }

  /**
   * Profit & loss for a period with a column per unit (units with nothing
   * in the period are dropped when there are several), and each unit's
   * partner shares of its net from the rule in force on the last day.
   */
  async pnlByUnit(user: AuthenticatedUser, from: string, to: string, businessUnitId?: string) {
    const units = await this.scopeUnits(user, businessUnitId);
    const accounts = await this.plAccounts();
    const rows = await this.movements(from, to, units.map((u) => u.id));
    const active = new Set(rows.map((r) => r.unitId));
    const shown = units.length > 1 ? units.filter((u) => active.has(u.id)) : units;
    const statement = buildPnl(
      accounts,
      rows.map<PnlMovement>((r) => ({ accountId: r.accountId, column: r.unitId, debit: r.debit, credit: r.credit })),
      shown.map((u) => u.id),
    );
    return { units: shown, statement, shares: await this.sharesOn(to, shown.map((u) => u.id)), partners: await this.partnersById() };
  }

  /** One unit (or the units together) across the twelve months of a year. */
  async pnlByMonth(user: AuthenticatedUser, year: number, businessUnitId?: string) {
    const units = await this.scopeUnits(user, businessUnitId);
    const accounts = await this.plAccounts();
    const rows = await this.movements(`${year}-01-01`, `${year}-12-31`, units.map((u) => u.id));
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
    const statement = buildPnl(
      accounts,
      rows.map<PnlMovement>((r) => ({ accountId: r.accountId, column: r.month, debit: r.debit, credit: r.credit })),
      months,
    );
    // Partner shares apply unit by unit, month by month (a rule can change mid-year).
    const plIds = new Set(accounts.map((a) => a.id));
    const partnerRows = new Map<string, Map<string, bigint>>();
    for (const month of months) {
      const shares = await this.sharesOn(monthEnd(month), units.map((u) => u.id));
      for (const u of units) {
        // Net = income (credit − debit) − expenses (debit − credit) = Σ (credit − debit).
        const net = rows
          .filter((r) => r.unitId === u.id && r.month === month && plIds.has(r.accountId))
          .reduce((s, r) => s + toPaisa(r.credit) - toPaisa(r.debit), 0n);
        for (const share of shares.get(u.id) ?? []) {
          const cells = partnerRows.get(share.partnerId) ?? new Map<string, bigint>();
          cells.set(month, (cells.get(month) ?? 0n) + toPaisa(shareOf(fromPaisa(net), share)));
          partnerRows.set(share.partnerId, cells);
        }
      }
    }
    const partners = await this.partnersById();
    return {
      units,
      months,
      statement,
      partnerShares: [...partnerRows.entries()].map(([partnerId, cells]) => ({
        partner: partners.get(partnerId)?.name ?? 'Partner',
        amounts: Object.fromEntries(months.map((m) => [m, fromPaisa(cells.get(m) ?? 0n)])),
        total: fromPaisa([...cells.values()].reduce((s, v) => s + v, 0n)),
      })),
    };
  }

  /** Every expense line in a period, with its heading, unit, entry and cost centre. */
  async expenses(user: AuthenticatedUser, from: string, to: string, businessUnitId?: string) {
    const units = await this.scopeUnits(user, businessUnitId);
    const ids = units.map((u) => u.id);
    const accounts = await this.plAccounts();
    const rows = await this.movements(from, to, ids);
    const statement = buildPnl(
      accounts,
      rows.map<PnlMovement>((r) => ({ accountId: r.accountId, column: r.unitId, debit: r.debit, credit: r.credit })),
      ids,
    );
    const lines: {
      date: string;
      entryNo: number;
      description: string;
      memo: string | null;
      accountId: string;
      unitId: string;
      debit: string;
      credit: string;
      costCentre: string | null;
      crossCharge: boolean;
    }[] = ids.length
      ? await this.dataSource.query(
          `SELECT to_char(e."entryDate", 'YYYY-MM-DD') AS date, e."entryNo" AS "entryNo", e.description, l.memo,
                  l."accountId", l."businessUnitId" AS "unitId", l.debit::text AS debit, l.credit::text AS credit,
                  cc.code AS "costCentre", l."crossCharge"
             FROM journal_lines l
             JOIN journal_entries e ON e.id = l."entryId"
             JOIN accounts a ON a.id = l."accountId"
             LEFT JOIN cost_centres cc ON cc.id = l."costCentreId"
            WHERE a.type = 'EXPENSE'
              AND e."entryDate" BETWEEN $1 AND $2
              AND l."businessUnitId" = ANY($3)
            ORDER BY e."entryDate", e."entryNo", l."lineNo"`,
          [from, to, ids],
        )
      : [];
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const unitById = new Map(units.map((u) => [u.id, u]));
    return {
      units: units.filter((u) => Object.prototype.hasOwnProperty.call(statement.totalExpenses.amounts, u.id)),
      statement,
      lines: lines.map((l) => {
        const account = byId.get(l.accountId);
        const parent = account?.parentId ? byId.get(account.parentId) : null;
        return {
          date: l.date,
          entryNo: formatEntryNo(Number(l.entryNo)),
          description: l.memo ? `${l.description} — ${l.memo}` : l.description,
          category: parent ? parent.name : (account?.name ?? ''),
          subCategory: parent ? (account?.name ?? '') : '',
          unit: unitById.get(l.unitId)?.code ?? '',
          amount: fromPaisa(toPaisa(l.debit) - toPaisa(l.credit)),
          costCentre: l.costCentre,
          crossCharge: l.crossCharge,
        };
      }),
    };
  }

  /**
   * A partner's year (Profit & Loss Statement sheet): each month's share of
   * each unit's net, what they drew against each unit (net debits to their
   * capital & current account, opening balances aside), and the balance.
   */
  async partnerStatement(user: AuthenticatedUser, partnerId: string, year: number) {
    const m = this.dataSource.manager;
    const partner = await m.findOne(Partner, { where: { id: partnerId }, withDeleted: true });
    if (!partner) throw new NotFoundException('Partner not found');
    if (!hasPermission(user, Permission.PNL_VIEW_CONSOLIDATED) && partner.userId !== user.id) {
      throw new ForbiddenException('You can only see your own profit-share statement.');
    }
    const today = businessDate();
    if (`${year}-01-01` > today) throw new BadRequestException(`${year} hasn't started yet.`);
    const through = `${year}-12-31` < today ? `${year}-12-31` : today;
    const lastMonth = Number(through.slice(5, 7));
    const months = Array.from({ length: lastMonth }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

    const units = await this.scopeUnits(user);
    const unitIds = units.map((u) => u.id);
    const accounts = await this.plAccounts();
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const rows = await this.movements(`${year}-01-01`, through, unitIds);

    const net = new Map<string, bigint>();
    for (const r of rows) {
      const a = byId.get(r.accountId);
      if (!a) continue;
      const key = `${r.month}|${r.unitId}`;
      net.set(key, (net.get(key) ?? 0n) + toPaisa(r.credit) - toPaisa(r.debit));
    }

    const equity = await m.findOne(Account, { where: { partnerId, businessUnitId: IsNull() }, withDeleted: true });
    const drawings = new Map<string, bigint>();
    let movements: { date: string; entryNo: string; description: string; unit: string; debit: string; credit: string; drawn: string }[] = [];
    if (equity && unitIds.length) {
      const lines: { date: string; entryNo: number; description: string; memo: string | null; unitId: string; debit: string; credit: string }[] =
        await this.dataSource.query(
          `SELECT to_char(e."entryDate", 'YYYY-MM-DD') AS date, e."entryNo" AS "entryNo", e.description, l.memo,
                  l."businessUnitId" AS "unitId", l.debit::text AS debit, l.credit::text AS credit
             FROM journal_lines l
             JOIN journal_entries e ON e.id = l."entryId"
            WHERE l."accountId" = $1
              AND e.kind <> $2
              AND e."entryDate" BETWEEN $3 AND $4
              AND l."businessUnitId" = ANY($5)
            ORDER BY e."entryDate", e."entryNo", l."lineNo"`,
          [equity.id, JournalEntryKind.OPENING_BALANCE, `${year}-01-01`, through, unitIds],
        );
      const unitById = new Map(units.map((u) => [u.id, u]));
      let running = 0n;
      movements = lines.map((l) => {
        const amount = toPaisa(l.debit) - toPaisa(l.credit);
        const key = `${l.date.slice(0, 7)}|${l.unitId}`;
        drawings.set(key, (drawings.get(key) ?? 0n) + amount);
        running += amount;
        return {
          date: l.date,
          entryNo: formatEntryNo(Number(l.entryNo)),
          description: l.memo ? `${l.description} — ${l.memo}` : l.description,
          unit: unitById.get(l.unitId)?.code ?? '',
          debit: l.debit,
          credit: l.credit,
          drawn: fromPaisa(running),
        };
      });
    }

    const monthInputs: StatementMonthInput[] = [];
    const pctByUnit = new Map<string, string>();
    for (const month of months) {
      const end = monthEnd(month) < through ? monthEnd(month) : through;
      const all = await this.sharesOn(end, unitIds);
      const shares: Record<string, PartnerShare> = {};
      for (const [unitId, list] of all) {
        const mine = list.find((s) => s.partnerId === partnerId);
        if (mine) {
          shares[unitId] = mine;
          pctByUnit.set(unitId, mine.pct);
        }
      }
      monthInputs.push({
        month,
        shares,
        net: Object.fromEntries(unitIds.map((u) => [u, fromPaisa(net.get(`${month}|${u}`) ?? 0n)])),
      });
    }
    const statement = partnerStatement(monthInputs, {}, drawings);

    const reserves = await m.find(Account, { where: { partnerId, businessUnitId: Not(IsNull()) }, withDeleted: true });
    const visibleReserves = reserves.filter((a) => a.businessUnitId && unitIds.includes(a.businessUnitId));
    const reserveBalances = await this.ledger.balancesFor(visibleReserves, { asOf: through });

    return {
      partner: { id: partner.id, name: partner.name, shortName: partner.shortName },
      year,
      through,
      units: units.filter((u) => statement.units.includes(u.id)),
      pctByUnit: Object.fromEntries(pctByUnit),
      statement,
      movements,
      equityBalance: equity ? ((await this.ledger.balancesFor([equity], { asOf: through })).get(equity.id) ?? '0.00') : null,
      reserves: visibleReserves.map((a) => ({
        unit: units.find((u) => u.id === a.businessUnitId)?.code ?? '',
        name: a.name,
        balance: reserveBalances.get(a.id) ?? '0.00',
      })),
    };
  }

  /**
   * People on the books at the end of a month (by their current unit and
   * designation), who joined and left in it, and the month's payroll cost
   * from finalised payslips.
   */
  async headcount(user: AuthenticatedUser, month: string, businessUnitId?: string) {
    const units = await this.scopeUnits(user, businessUnitId);
    const ids = units.map((u) => u.id);
    const end = monthEnd(month);
    const start = `${month}-01`;
    if (!ids.length) return { units, month, rows: [], runs: [] as { unit: UnitRef; status: string | null }[], totals: null };

    const people: { unitId: string; designation: string; onBooks: string; joined: string; left: string }[] = await this.dataSource.query(
      `SELECT e."businessUnitId" AS "unitId", d.name AS designation,
              COUNT(*) FILTER (WHERE e."joinDate" <= $1 AND (e."exitDate" IS NULL OR e."exitDate" >= $1))::text AS "onBooks",
              COUNT(*) FILTER (WHERE e."joinDate" BETWEEN $2 AND $1)::text AS joined,
              COUNT(*) FILTER (WHERE e."exitDate" BETWEEN $2 AND $1)::text AS left
         FROM employees e
         JOIN designations d ON d.id = e."designationId"
        WHERE e."deletedAt" IS NULL AND e."businessUnitId" = ANY($3)
        GROUP BY 1, 2`,
      [end, start, ids],
    );
    const pay: { unitId: string; designation: string; slips: string; salary: string; gross: string; bonus: string; net: string; cost: string }[] =
      await this.dataSource.query(
        `SELECT p."businessUnitId" AS "unitId", COALESCE(p.designation, '—') AS designation, COUNT(*)::text AS slips,
                SUM(p.salary)::text AS salary, SUM(p.gross)::text AS gross, SUM(p.bonus)::text AS bonus,
                SUM(p.net)::text AS net, SUM(p.cost)::text AS cost
           FROM payslips p
          WHERE p.month = $1 AND p."businessUnitId" = ANY($2)
          GROUP BY 1, 2`,
        [month, ids],
      );
    const runs: { unitId: string; status: string }[] = await this.dataSource.query(
      `SELECT "businessUnitId" AS "unitId", status FROM payroll_runs WHERE month = $1 AND "businessUnitId" = ANY($2)`,
      [month, ids],
    );

    const key = (u: string, d: string) => `${u}|${d}`;
    const keys = new Set([...people.map((p) => key(p.unitId, p.designation)), ...pay.map((p) => key(p.unitId, p.designation))]);
    const rows = [...keys]
      .map((k) => {
        const [unitId, designation] = k.split('|');
        const p = people.find((x) => key(x.unitId, x.designation) === k);
        const s = pay.find((x) => key(x.unitId, x.designation) === k);
        return {
          unit: units.find((u) => u.id === unitId) as UnitRef,
          designation,
          onBooks: Number(p?.onBooks ?? 0),
          joined: Number(p?.joined ?? 0),
          left: Number(p?.left ?? 0),
          paid: Number(s?.slips ?? 0),
          salary: s?.salary ?? '0.00',
          gross: s?.gross ?? '0.00',
          bonus: s?.bonus ?? '0.00',
          net: s?.net ?? '0.00',
          cost: s?.cost ?? '0.00',
        };
      })
      .filter((r) => r.onBooks || r.joined || r.left || r.paid)
      .sort((a, b) => a.unit.code.localeCompare(b.unit.code) || a.designation.localeCompare(b.designation));
    const total = (f: 'salary' | 'gross' | 'bonus' | 'net' | 'cost') => fromPaisa(rows.reduce((s, r) => s + toPaisa(r[f]), 0n));
    return {
      units,
      month,
      rows,
      runs: units.map((u) => ({ unit: u, status: runs.find((r) => r.unitId === u.id)?.status ?? null })),
      totals: {
        onBooks: rows.reduce((s, r) => s + r.onBooks, 0),
        joined: rows.reduce((s, r) => s + r.joined, 0),
        left: rows.reduce((s, r) => s + r.left, 0),
        paid: rows.reduce((s, r) => s + r.paid, 0),
        salary: total('salary'),
        gross: total('gross'),
        bonus: total('bonus'),
        net: total('net'),
        cost: total('cost'),
      },
    };
  }
}
