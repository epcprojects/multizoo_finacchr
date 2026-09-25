import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BonusSplitMethod, EmploymentType, PayrollPolicyStatus } from '@multizoo/types';
import { businessDate, fromPaisa, toPaisa } from '@multizoo/utils';
import type { AuthenticatedUser } from '../users/users.service';
import { userNames } from '../hr/hr-common';
import { addDays } from '../hr/hr-math';
import { PayrollPolicy } from './entities/payroll.entity';
import { payrollPolicyOn } from './payroll-common';
import { toBasisPoints } from './payroll-math';
import { CreatePayrollPolicyDto } from './dto/payroll.dto';

/** "38.00" → "38", "8.33" → "8.33". */
export function pct(value: string): string {
  return String(Number(value));
}

export function presentPolicy(p: PayrollPolicy) {
  return {
    id: p.id,
    version: p.version,
    effectiveFrom: p.effectiveFrom,
    status: p.status,
    note: p.note,
    daysPerMonth: p.daysPerMonth,
    eobiEnabled: p.eobiEnabled,
    eobiMinimumWage: p.eobiMinimumWage,
    eobiEmployeePct: pct(p.eobiEmployeePct),
    eobiEmployerPct: pct(p.eobiEmployerPct),
    eobiEmploymentTypes: p.eobiEmploymentTypes,
    taxEnabled: p.taxEnabled,
    taxBands: p.taxBands,
    pfEnabled: p.pfEnabled,
    pfEmployeePct: pct(p.pfEmployeePct),
    pfEmployerPct: pct(p.pfEmployerPct),
    commissionPct: pct(p.commissionPct),
    bonusTiers: p.bonusTiers,
  };
}

/**
 * The payroll policy — statutory rates and the commission pool's tiers —
 * versioned like every PolicyRule (Fig. 16): a change is a new version
 * from today or later, so last March is still paid on last March's rules.
 * Edited by whoever edits HR policy (roles table: "Edit leave, bonus-tier &
 * statutory rate policies — Accountant ✓, Partner oversight").
 */
@Injectable()
export class PayrollPoliciesService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async list() {
    const m = this.dataSource.manager;
    const policies = await m.find(PayrollPolicy, { order: { effectiveFrom: 'DESC', version: 'DESC' } });
    const today = businessDate();
    const active = policies.filter((p) => p.status === PayrollPolicyStatus.ACTIVE).reverse();
    const current = payrollPolicyOn(active, today);
    const names = await userNames(m, policies.map((p) => p.createdBy));
    return policies.map((p) => {
      const next = active.find((a) => a.effectiveFrom > p.effectiveFrom);
      return {
        ...presentPolicy(p),
        effectiveTo: p.status === PayrollPolicyStatus.ACTIVE && next ? addDays(next.effectiveFrom, -1) : null,
        isCurrent: current?.id === p.id,
        isUpcoming: p.status === PayrollPolicyStatus.ACTIVE && p.effectiveFrom > today,
        createdAt: p.createdAt,
        createdByName: p.createdBy ? names.get(p.createdBy) ?? null : null,
      };
    });
  }

  async create(dto: CreatePayrollPolicyDto, user: AuthenticatedUser) {
    if (dto.effectiveFrom < businessDate()) {
      throw new BadRequestException('A policy change can start today at the earliest — months already paid are never recalculated.');
    }
    const tiers = dto.bonusTiers.map((t) => t.tier);
    if (new Set(tiers).size !== tiers.length) throw new BadRequestException('Each bonus tier can appear only once.');
    const tierTotal = dto.bonusTiers.reduce((s, t) => s + toBasisPoints(t.pct), 0n);
    if (tierTotal !== 10_000n) {
      throw new BadRequestException(`The bonus tiers must share out exactly 100% of the pool — they add up to ${fromPaisa(tierTotal)}%.`);
    }
    const bands = dto.taxBands.map((b) => ({ from: fromPaisa(toPaisa(b.from)), rate: pct(b.rate) }));
    if (toPaisa(bands[0].from) !== 0n) throw new BadRequestException('The first tax band must start at 0.');
    for (let i = 1; i < bands.length; i++) {
      if (toPaisa(bands[i].from) <= toPaisa(bands[i - 1].from)) throw new BadRequestException('Tax bands must go up in order.');
    }
    for (const p of [dto.eobiEmployeePct, dto.eobiEmployerPct, dto.pfEmployeePct, dto.pfEmployerPct, dto.commissionPct, ...bands.map((b) => b.rate)]) {
      if (toBasisPoints(p) > 10_000n) throw new BadRequestException('A percentage can’t be more than 100.');
    }

    return this.dataSource.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtext('payroll-policy'))`);
      const sameDay = await m.find(PayrollPolicy, { where: { effectiveFrom: dto.effectiveFrom, status: PayrollPolicyStatus.ACTIVE } });
      for (const p of sameDay) {
        p.status = PayrollPolicyStatus.SUPERSEDED;
        p.updatedBy = user.id;
      }
      await m.save(sameDay);
      const max = await m.createQueryBuilder(PayrollPolicy, 'p').select('MAX(p.version)', 'max').getRawOne<{ max: number | null }>();
      const policy = await m.save(
        m.create(PayrollPolicy, {
          version: (max?.max ?? 0) + 1,
          effectiveFrom: dto.effectiveFrom,
          status: PayrollPolicyStatus.ACTIVE,
          note: dto.note?.trim() || null,
          daysPerMonth: dto.daysPerMonth,
          eobiEnabled: dto.eobiEnabled,
          eobiMinimumWage: fromPaisa(toPaisa(dto.eobiMinimumWage)),
          eobiEmployeePct: dto.eobiEmployeePct,
          eobiEmployerPct: dto.eobiEmployerPct,
          eobiEmploymentTypes: [...new Set(dto.eobiEmploymentTypes)] as EmploymentType[],
          taxEnabled: dto.taxEnabled,
          taxBands: bands,
          pfEnabled: dto.pfEnabled,
          pfEmployeePct: dto.pfEmployeePct,
          pfEmployerPct: dto.pfEmployerPct,
          commissionPct: dto.commissionPct,
          bonusTiers: dto.bonusTiers.map((t) => ({
            tier: t.tier,
            pct: pct(t.pct),
            split: t.split,
            roundUp: t.roundUp,
            unitLabel: t.split === BonusSplitMethod.BY_UNITS ? t.unitLabel?.trim() || 'units' : null,
          })),
          createdBy: user.id,
        }),
      );
      return { id: policy.id, version: policy.version, replaced: sameDay.map((p) => p.version) };
    });
  }
}
