import { BadRequestException } from '@nestjs/common';
import { EntityManager, IsNull } from 'typeorm';
import { CounterpartyKind, LoanDirection, SystemAccountClass } from '@multizoo/types';
import { Account } from '../accounts/entities/account.entity';
import { AccountClass } from '../accounts/entities/account-class.entity';
import { BusinessUnit } from '../business-units/entities/business-unit.entity';
import { Partner } from '../allocation/entities/partner.entity';
import { buildCode, nextNumber, parseNumber } from '../accounts/account-codes';
import { generateAccountCode, getChartSettings } from '../accounts/chart-of-accounts';
import { Counterparty, Loan } from './entities/loan.entity';

/**
 * The accounts loans post to.
 *
 * Each loan gets its own account in its unit — "Loan from MQK" (payable
 * class) or "Loan to Col Ibrahim" (receivable class) — so its history is
 * that account's ledger. They're numbered one apart inside the class's
 * range: a unit can carry many small officer and staff accounts, more than
 * the chart's usual step of ten leaves room for.
 *
 *   lend / charge them      Dr Loan to X       Cr cash / income / expense
 *   borrow / they paid      Dr cash / expense  Cr Loan from X
 *   repayment               the reverse
 *   set off against profit  Dr Partner — Capital & Current  Cr Loan to X
 *   write off               Dr Loans & Advances Written Off  Cr Loan to X
 */
export const LOAN_WRITE_OFF_KEY = 'LOANS_WRITE_OFF';

export function loanAccountName(direction: LoanDirection, counterparty: Pick<Counterparty, 'name' | 'kind'>): string {
  const inter = counterparty.kind === CounterpartyKind.BUSINESS_UNIT;
  if (direction === LoanDirection.RECEIVABLE) return inter ? `Due from ${counterparty.name}` : `Loan to ${counterparty.name}`;
  return inter ? `Due to ${counterparty.name}` : `Loan from ${counterparty.name}`;
}

/** Creates the loan's own account (idempotent). */
export async function ensureLoanAccount(
  m: EntityManager,
  loan: Loan,
  counterparty: Counterparty,
  unit: BusinessUnit,
  actorId: string | null,
): Promise<Account> {
  if (loan.accountId) return m.findOneOrFail(Account, { where: { id: loan.accountId } });
  const key = loan.direction === LoanDirection.RECEIVABLE ? SystemAccountClass.RECEIVABLE : SystemAccountClass.PAYABLE;
  const cls = await m.findOne(AccountClass, { where: { key } });
  if (!cls) throw new BadRequestException(`The ${key.toLowerCase()} account class is missing — run the seed.`);
  const settings = await getChartSettings(m);
  const codes = (await m.find(Account, { select: { code: true }, withDeleted: true })).map((a) => a.code);
  const taken = codes
    .map((code) => parseNumber(settings.unitCodePattern, code, unit.code))
    .filter((n): n is number => n !== null);
  // One apart, after whatever's already there.
  const num = nextNumber(taken, cls.codeStart + 1, cls.codeEnd, 1);
  if (num === null) {
    throw new BadRequestException(
      `No free codes left in ${cls.name}'s range for ${unit.name} (${cls.codeStart}–${cls.codeEnd}) — widen it in Accounts → Settings.`,
    );
  }
  const account = await m.save(
    m.create(Account, {
      code: buildCode(settings.unitCodePattern, num, unit.code),
      name: loanAccountName(loan.direction, counterparty),
      type: cls.type,
      classId: cls.id,
      businessUnitId: unit.id,
      parentId: null,
      isPostable: true,
      isSystem: true,
      systemKey: null,
      isReserveOffset: false,
      partnerId: null,
      loanId: loan.id,
      description: `LN-${String(loan.loanNo).padStart(4, '0')} — ${loan.purpose}`.slice(0, 1000),
      createdBy: actorId,
    }),
  );
  await m.update(Loan, loan.id, { accountId: account.id });
  loan.accountId = account.id;
  return account;
}

/** Group-wide "Loans & Advances Written Off" (expense), found by system key. */
export async function ensureWriteOffAccount(m: EntityManager): Promise<Account> {
  const existing = await m.findOne(Account, { where: { systemKey: LOAN_WRITE_OFF_KEY }, withDeleted: true });
  if (existing) return existing;
  const cls = await m.findOne(AccountClass, { where: { key: SystemAccountClass.EXPENSE } });
  if (!cls) throw new BadRequestException('The expense account class is missing — run the seed.');
  const settings = await getChartSettings(m);
  const wanted = buildCode(settings.groupCodePattern, 5960);
  const taken = await m.findOne(Account, { where: { code: wanted }, withDeleted: true });
  return m.save(
    m.create(Account, {
      code: taken ? await generateAccountCode(m, cls, null, null) : wanted,
      name: 'Loans & Advances Written Off',
      type: cls.type,
      classId: cls.id,
      businessUnitId: null,
      parentId: null,
      isPostable: true,
      isSystem: true,
      systemKey: LOAN_WRITE_OFF_KEY,
      description: 'What a borrower or a leaving employee couldn’t repay, written off with a Partner’s approval.',
    }),
  );
}

/** The counterparty row standing for a unit in inter-unit loans (idempotent). */
export async function ensureUnitCounterparty(m: EntityManager, unit: BusinessUnit, actorId: string | null): Promise<Counterparty> {
  const existing = await m.findOne(Counterparty, { where: { businessUnitId: unit.id, deletedAt: IsNull() } });
  if (existing) return existing;
  return m.save(
    m.create(Counterparty, {
      name: unit.name,
      kind: CounterpartyKind.BUSINESS_UNIT,
      businessUnitId: unit.id,
      partnerId: null,
      employeeId: null,
      createdBy: actorId,
    }),
  );
}

/** Every partner is a counterparty (their personal loan accounts), created the first time it's needed. */
export async function ensurePartnerCounterparties(m: EntityManager): Promise<void> {
  const partners = await m.find(Partner, { where: { isActive: true } });
  for (const p of partners) {
    const existing = await m.findOne(Counterparty, { where: { partnerId: p.id, deletedAt: IsNull() } });
    if (!existing) {
      await m.save(
        m.create(Counterparty, { name: p.name, kind: CounterpartyKind.PARTNER, partnerId: p.id, employeeId: null, businessUnitId: null }),
      );
    } else if (existing.name !== p.name) {
      await m.update(Counterparty, existing.id, { name: p.name });
    }
  }
}
