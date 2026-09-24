import { BadRequestException } from '@nestjs/common';
import { EntityManager, IsNull } from 'typeorm';
import { SystemAccountClass } from '@multizoo/types';
import { Account } from './entities/account.entity';
import { AccountClass } from './entities/account-class.entity';
import { BusinessUnit } from '../business-units/entities/business-unit.entity';
import { generateAccountCode, reserveClass } from './chart-of-accounts';

/**
 * How reserves sit in a double-entry ledger (Module 3).
 *
 * A reserve is cash already earmarked for a purpose — "still real cash,
 * just labelled" (Follow the Rupee, Part 2). Earmarking Rs 100 for Feed
 * must therefore not reduce Cash in Hand. So every unit has one offset
 * account, "Earmarked Funds (offset)", in the reserve class:
 *
 *   allocate   Dr Feed Reserve 100   Cr Earmarked Funds (offset) 100
 *   spend      Dr Feed expense 100   Cr Cash 100          (the real payment)
 *              Dr Earmarked Funds 100 Cr Feed Reserve 100  (the earmark released)
 *
 * The offset's balance is always minus the sum of the unit's reserves, so
 * the unit's total assets are exactly its cash, bank and wallet — and
 * "cash not yet earmarked" is money on hand minus the reserves.
 */

export type ReserveKind = 'BUCKET' | 'PARTNER' | 'OFFSET';

type ReserveLike = Pick<Account, 'isReserveOffset' | 'partnerId'> & {
  accountClass?: Pick<AccountClass, 'isReserve'> | null;
};

export function reserveKind(a: ReserveLike): ReserveKind | null {
  if (!a.accountClass?.isReserve) return null;
  if (a.isReserveOffset) return 'OFFSET';
  if (a.partnerId) return 'PARTNER';
  return 'BUCKET';
}

/** A normal reserve bucket (Feed, Salary …) — not the offset, not a partner's. */
export function isBucketReserve(a: ReserveLike): boolean {
  return reserveKind(a) === 'BUCKET';
}

async function requireReserveClass(m: EntityManager): Promise<AccountClass> {
  const cls = await reserveClass(m);
  if (!cls) throw new BadRequestException('No active reserve class is configured (Accounts → Settings).');
  return cls;
}

/** The unit's offset account, created the first time it's needed. */
export async function ensureReserveOffset(
  m: EntityManager,
  unit: BusinessUnit,
  actorId: string | null = null,
): Promise<Account> {
  const existing = await m.findOne(Account, {
    where: { businessUnitId: unit.id, isReserveOffset: true },
    withDeleted: true,
  });
  if (existing) return existing;
  const cls = await requireReserveClass(m);
  return m.save(
    m.create(Account, {
      code: await generateAccountCode(m, cls, unit, null),
      name: 'Earmarked Funds (offset)',
      type: cls.type,
      classId: cls.id,
      businessUnitId: unit.id,
      parentId: null,
      isPostable: true,
      isSystem: true,
      systemKey: null,
      isReserveOffset: true,
      partnerId: null,
      description:
        'The other side of every reserve. Always minus the total of this unit’s reserves, so earmarking money never changes the cash on hand.',
      createdBy: actorId,
    }),
  );
}

export function partnerReserveName(partnerName: string) {
  return `${partnerName} Profit Reserve`;
}

export function partnerEquityName(partnerName: string) {
  return `${partnerName} — Capital & Current`;
}

/** A partner's profit reserve in a unit — where their waterfall share lands. */
export async function ensurePartnerReserve(
  m: EntityManager,
  unit: BusinessUnit,
  partner: { id: string; name: string },
  actorId: string | null = null,
): Promise<Account> {
  const existing = await m.findOne(Account, {
    where: { businessUnitId: unit.id, partnerId: partner.id },
    relations: { accountClass: true },
    withDeleted: true,
  });
  if (existing) {
    if (!existing.isActive || existing.deletedAt) {
      await m.update(Account, existing.id, { isActive: true, deletedAt: null, updatedBy: actorId });
    }
    return existing;
  }
  const cls = await requireReserveClass(m);
  return m.save(
    m.create(Account, {
      code: await generateAccountCode(m, cls, unit, null),
      name: partnerReserveName(partner.name),
      type: cls.type,
      classId: cls.id,
      businessUnitId: unit.id,
      parentId: null,
      isPostable: true,
      isSystem: true,
      systemKey: null,
      isReserveOffset: false,
      partnerId: partner.id,
      description: `${partner.name}'s share of this unit's daily income, set aside by the allocation waterfall. Drawings release it.`,
      createdBy: actorId,
    }),
  );
}

/** A partner's group-wide capital & current account (equity). Drawings are debited here. */
export async function ensurePartnerEquity(
  m: EntityManager,
  partner: { id: string; name: string },
  actorId: string | null = null,
): Promise<Account> {
  const existing = await m.findOne(Account, {
    where: { businessUnitId: IsNull(), partnerId: partner.id },
    withDeleted: true,
  });
  if (existing) return existing;
  const cls = await m.findOne(AccountClass, { where: { key: SystemAccountClass.EQUITY } });
  if (!cls) throw new BadRequestException('The Equity account class is missing — run the seed.');
  return m.save(
    m.create(Account, {
      code: await generateAccountCode(m, cls, null, null),
      name: partnerEquityName(partner.name),
      type: cls.type,
      classId: cls.id,
      businessUnitId: null,
      parentId: null,
      isPostable: true,
      isSystem: true,
      systemKey: null,
      isReserveOffset: false,
      partnerId: partner.id,
      description: `What belongs to ${partner.name}: capital put in, plus profit earned, minus drawings taken.`,
      createdBy: actorId,
    }),
  );
}
