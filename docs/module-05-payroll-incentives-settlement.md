# Module 5 — Payroll, Incentives & Settlement

**Status: ✅ backend complete and verified (55 new engine/parity unit tests, an 80-check API run against the dev database). Frontend built, type-checked, lint-clean, and every screen exercised in the browser against real data. Browser click-through by each role still pending (see checklist).**

Architecture plan references: Part 03 §6 (payroll gross → net) and §7
(bonus / commission pool), Part 05 (Advance, PayrollRun & Payslip,
BonusPool, FullFinalSettlement, StatutoryProfile), Part 06 (M6 Payroll,
M7 Incentive Engine, M16 Full & Final Settlement), Part 07 §04–08, Part 10
(roles table), Part 11 Phase 4, Fig. 8, 9, 14, 15 and 16. Sprint plan demo
for this phase: *"A full payroll run produces real payslips; a mock exit
produces a settlement."* Client input: *confirm statutory rates with the
accountant.*

## What this module is

The pay layer on top of Module 4's HR records:

- **payroll runs**: one per unit per month, the salary sheet's blocks, from
  draft to finalised to paid;
- **salary advances**: paid out of a unit's cash and recovered by payroll;
- **commission pools**: the Bonus Calculator, split by bonus tier;
- **full & final settlement**: what someone is owed on their last day;
- **the payroll policy**: the ÷30 divisor, EOBI, income tax, provident fund
  and the pool's tiers, versioned like every other rule.

Expense capture, the other half of the plan's Phase 4, was delivered with
the ledger in Module 2 (money-out entries with an enforced category chart).

## What the workbook actually does

`Sample cash flow.xlsx → Nov 2024 Salary Sheet ZOO` (hidden):

- `G = D − (D/30 × E) − F` (Gross = Salary − Salary/30 × Absent − Advance)
- `K = G + H − I − J` (Net = Gross + Bonus − Fine − Food)
- The Remarks column explains bonus figures: *"5K Transport and 3K food
  allowance"*, *"2000 Food Zoo"*.
- Three rows are typed, not calculated: Majid Husain (19,150 where the
  formula gives 19,166.67), Azhar (11,666 vs 11,666.67) and Shafaqat (Gross
  26,000 and Net 0 with an advance equal to the salary; the formula gives 0
  and 0). The parity tests pin the formula's figures and flag these three.

`Sample cash flow.xlsx → Bonus Calculator` (hidden) differs from the plan's
Fig. 9 in one respect, and the build follows the sheet:

- Pool = `FLOOR(Total School Sale × 5%, 1)`: 702,860 → 35,143.
- **Supervisors 38%, divided by trips** (`per visit = G4 / SUM(trips)`:
  580.62 a trip; G1 6 trips → 3,483.74).
- Ticketers 38%, divided by three (`G5/3` → 4,451.45 each).
- Workers 14% (`CEILING(…/count, 1)`, a broken reference on the sheet).
- Managers 10%, not paid to anyone on that sheet.

## Design decisions

1. **The formula doesn't change; its inputs get sources** (Part 07 §05).
   - Absent: the attendance register's `payrollAbsentDays`.
   - Advance: outstanding salary advances.
   - Bonus: approved commission-pool shares plus allowances entered on the
     run.
   - Fine: approved fines not yet collected.
   - Food and other deductions: entered on the run, each with its reason.

   Parity tests feed every row of the Nov 2024 sheet (ZOO, Panda Cafe and
   MBF blocks) through the engine and get the sheet's Gross and Net to the
   paisa.
2. **Salary for part of a month.**
   - A full month on one rate is the salary.
   - A raise part-way through is weighted by days.
   - Joining or leaving part-way is Salary/30 per day employed, never more
     than a month.
   - Daily-wage staff are paid the day rate for days worked or on paid leave
     (half days half), with no deduction on top.
   - A month is paid on the basis in force on the last day employed.
3. **A draft is live; finalising freezes it.**
   - A draft run recalculates on every open, so a late attendance
     correction or a newly approved fine just shows up.
   - Finalising (from the month's last day) takes a snapshot of every
     payslip, records the fines and advance recoveries against it, posts the
     cost to the ledger and **locks that month's attendance** for those
     people.
   - Warnings (unmarked days paid as worked, pending leave, fines awaiting
     approval, advances left for later) must be confirmed; errors (no
     salary, deductions exceeding pay) block it.
   - Reopening is allowed until anything is paid: the posting is reversed,
     fines and recoveries are handed back, attendance unlocks. A paid run is
     corrected in the next month's run.
4. **The lock** (deferred from Module 4) covers every way a paid month could
   change after the fact:
   - saving the attendance sheet (the sheet shows which rows are locked, and
     why);
   - approving or cancelling leave on those days;
   - a salary revision starting in that month;
   - an exit date before the end of a paid month;
   - reinstating someone whose settlement exists.
5. **Posting to the ledger** (all group-wide system accounts, found by
   system key; Module 2's Salaries & Wages and Bonus & Employee Relief are
   adopted, not duplicated):
   - Finalise: Dr Salaries & Wages, Bonus & Employee Relief, Employer
     EOBI & PF / Cr Salaries Payable (net), Staff Salary Advances
     (recovered), Staff Fines & Recoveries (fines, food, deductions), EOBI /
     Tax / PF payable. The entry is dated the month's last day.
   - Pay: money out, Dr Salaries Payable / Cr the unit's cash, bank or
     wallet, **optionally out of the Salary reserve** the allocation engine
     fills, releasing the earmark in the same entry. Everyone at once, or
     just the people selected.
   - Advance: money out, Dr Staff Salary Advances / Cr cash.
   - These entries carry source `PAYROLL` and can only be undone from the
     Payroll screens, like allocation entries from the Allocation screen.
6. **Advances** are recovered oldest first: a set amount a month, or (the
   sheet's habit) everything at the next payroll. A recovery never takes
   more than the month's pay leaves room for; the rest waits. A per-run
   override ("recover exactly this", 0 to skip) handles hardship. An advance
   can be cancelled, which reverses its payment, only while none of it has
   been recovered.
7. **Commission pools.**
   - The pool is qualifying sales × commission %, **rounded down** to the
     rupee.
   - Each tier takes its % (the tiers must total 100%), divided per head or
     **by a count such as trips**.
   - A "round up" tier pays each person a whole rupee rounded **up** (the
     sheet's CEILING). Otherwise shares split to the paisa and always add
     back to the tier exactly.
   - A tier with nobody in it leaves its share visibly unshared.
   - The rules are copied from the policy when the pool is created.
     Approved shares land in each person's Bonus / Incentive for the pool's
     month. A pool can't be approved into a month already finalised for its
     members, or moved back to draft once it's on a payslip.
   - Qualifying sales are typed in until sales capture (Module 7) supplies
     them.
8. **Full & final settlement.**
   - Salary not yet paid through a payroll run, from the month after their
     last payslip to the exit date, each month calculated exactly as a
     payslip would be.
   - **Leave encashment** for leave types the HR policy marks encashable
     (annual, by default): carried + adjusted + the year's entitlement
     earned to the exit date (pro-rated, rounded down to a half day) −
     taken, at Salary/30 a day.
   - Commission-pool shares for those months, plus anything else owed.
   - Less: every uncollected approved fine, other deductions, statutory
     deductions, and **all** outstanding advances as far as what's owed
     covers them. Any excess stays outstanding and is shown in red.
   - People covered by a settlement drop out of those months' payroll runs.
     Same life as a run: a live draft, finalise (from the exit date),
     reopen until paid, pay.
9. **Statutory deductions ship off** (Part 07 §07, Delivery risks). Payroll
   policy v1 loads:
   - EOBI at 5% employer / 1% employee of the PKR 40,700 minimum wage (on
     the wage, not the salary), for permanent and contract staff;
   - FBR salaried slabs for tax year 2026, progressive, withheld as a
     twelfth of the tax on the month's pay × 12;
   - provident fund at 0%.

   All three are **off**, because the workbook deducts none of them and
   the plan leaves switching them on to the accountant. When they're on,
   they appear as extra columns on the sheet and lines on the payslip.
10. **The payroll policy is versioned** (Fig. 16) exactly like the HR
    policy.
    - A new version starts today or later.
    - A month is paid on the version in force on its last day.
    - A same-date version replaces one that hasn't started.
    - Editors: `rules.edit_hr_policy` (roles table: *"Edit leave,
      bonus-tier & statutory rate policies — Accountant ✓, Partner
      oversight"*).

## Data model

| Entity | Key columns | Notes |
|---|---|---|
| `PayrollPolicy` | version, `effectiveFrom`, `status`, `daysPerMonth`, EOBI (`eobiEnabled`, `eobiMinimumWage`, employee/employer %, `eobiEmploymentTypes[]`), tax (`taxEnabled`, `taxBands` jsonb), PF (enabled, %), `commissionPct`, `bonusTiers` jsonb | The PolicyRule instance for statutory rates and the pool |
| `PayrollRun` | `businessUnitId` + `month` (unique), `status` (DRAFT / FINALIZED / PAID), `policyId`, `accrualEntryId`, finalised by/at | |
| `PayrollAdjustment` | `runId`, `employeeId`, `kind` (ALLOWANCE / FOOD / DEDUCTION / ADVANCE_RECOVERY), `amount`, `description` | Hand-entered figures, kept across recalculation |
| `Payslip` | `runId` + `employeeId` (unique), `month`, a snapshot of name/designation, every sheet column (salary, absentDays, earned, absenceDeduction, advance, gross, poolBonus, allowances, bonus, fines, food, otherDeductions, EOBI ×2, tax, PF ×2, net, cost), `details` jsonb, `paymentEntryId`, `paidOn` | Written on finalise; its existence is what locks the month |
| `SalaryAdvance` | `employeeId`, `businessUnitId`, `issueDate`, `amount`, `installment`, `reason`, `status` (OUTSTANDING / RECOVERED / CANCELLED), `journalEntryId` | Module 6 folds it into the counterparty ledger |
| `AdvanceRecovery` | `advanceId`, `amount`, `month`, `payslipId` xor `settlementId` | |
| `BonusPool` + `BonusPoolMember` | unit, `month`, `title`, `basis`, `qualifyingSales`, `commissionPct` + `tiers` (copied from the policy), `status`; member `tier`, `units` | |
| `FinalSettlement` | `employeeId` (unique), unit, `exitDate`, `fromMonth`, `status`, `adjustments` jsonb, `snapshot` jsonb, `net`, accrual & payment entries | |
| `DisciplinaryRecord` (+3 columns) | `deductedMonth`, `payslipId`, `settlementId` | Each fine is collected once |
| Journal (+1 kind, +1 source) | `PAYROLL` | |

## Permissions

No new claims; `payroll.run` (seeded on the Accountant since Module 1) now
does something:

| Permission | Partner | Accountant | Branch Manager | Branch Staff |
|---|:-:|:-:|:-:|:-:|
| `payroll.run`: runs, adjustments, finalise / reopen / pay, advances, pools, settlements | — | ✓ | — | — |
| `employee.view`: read runs, payslips, advances, pools, settlements | ✓ | — | — | — |
| `rules.edit_hr_policy`: publish payroll policy versions | — | ✓ | — | — |

Branch Managers and staff never see pay (as in Module 4).

## API (all under `/api/v1/payroll`)

| Method & path | Permission | Purpose |
|---|---|---|
| `GET /stats` | viewers | Unpaid net, last month's cost, advances outstanding |
| `GET /overview?month` | viewers | Every unit's run for a month, started or not |
| `GET /runs?year`, `POST /runs` `{businessUnitId, month}` | viewers / run | List; start a draft |
| `GET /runs/:id`, `DELETE /runs/:id` | viewers / run | The sheet (live or frozen), totals, warnings, errors, postings; delete a draft |
| `GET /runs/:id/payslips/:employeeId` | viewers | One payslip |
| `POST /runs/:id/adjustments`, `DELETE /runs/:id/adjustments/:adjId` | run | Allowance, food, deduction, advance override |
| `POST /runs/:id/finalize` `{acknowledgeWarnings}` | run | Snapshot, post, lock |
| `POST /runs/:id/reopen` `{reason}` | run | Until anything is paid |
| `POST /runs/:id/pay` `{paymentDate, accountId, reserveAccountId?, employeeIds?}` | run | Pay everyone unpaid, or those chosen |
| `GET /employees/:id/payslips` | viewers | An employee's payslip history |
| `GET /policies`, `POST /policies` | viewers + policy editors / `rules.edit_hr_policy` | Versions; publish |
| `GET /advances?…`, `POST /advances`, `POST /advances/:id/cancel` | viewers / run | |
| `GET /bonus-pools?…`, `POST /bonus-pools`, `GET/PATCH/DELETE /bonus-pools/:id` | viewers / run | |
| `PUT /bonus-pools/:id/members`, `POST /bonus-pools/:id/{approve,unapprove}` | run | |
| `GET /settlements?…`, `GET /settlements/awaiting`, `POST /settlements` `{employeeId}` | viewers / run | |
| `GET/PATCH/DELETE /settlements/:id`, `POST /settlements/:id/{finalize,reopen,pay}` | viewers / run | |

## Screens

- **HR → Payroll** (new nav item): banner figures and four tabs.
  - **Salary runs**: a month picker and a row per unit (people, status,
    net, still to pay), with *Start draft* / *Open*.
  - **Advances**: outstanding / recovered / cancelled, each recovery by
    month, *New advance*, and *Cancel* while nothing is recovered.
  - **Commission pools**: every pool with its sales, pool and unshared
    amount; *New pool*, which previews the rounded-down pool.
  - **Settlements**: people who have left with no settlement (*Prepare
    settlement*), then every settlement.
- **Run** page: the salary sheet's columns (Salary, Absent, Advance, Gross,
  Bonus, Fine, Food, Net, plus Other / EOBI / Tax / PF when in use) and a
  totals row.
  - Clicking a row shows where each figure came from: the attendance
    breakdown, pool shares, allowances, each fine, and each advance recovery
    with what's left.
  - A draft has *+ Allowance / deduction*, warnings and errors, *Finalise*
    (from the month's last day) and *Delete draft*.
  - A finalised run has checkboxes to *Pay selected* or *Pay everyone
    unpaid* (from cash, bank or wallet, out of the Salary reserve by
    default), and *Reopen* while nothing is paid.
  - Its ledger postings open in the entry modal.
- **Payslip** page: earnings and deductions, each with its reason, the
  attendance behind the Absent figure, and *Print*.
- **Commission pool** page: the pool, each tier's amount (and its per-trip
  rate), and the people with their tier and trip count. *Approve* /
  *Back to draft*.
- **Settlement** page: the statement (salary by month, leave encashed,
  shares, anything else owed, less fines, deductions and advances = net),
  *Anything else owed* with reasons, *Finalise*, *Pay*, *Reopen* and *Print*.
- **Settings → Payroll setup**: the policy in force in plain language,
  version history, and *New version*: EOBI, tax bands, PF, the pool and
  tiers, with a "what changes" list before publishing.
- **Employee** page: a new **Pay** tab with payslips, advances (*New
  advance*) and, once they've left, their settlement.
- **Attendance** sheet: rows locked by a finalised payroll say so.
- **Fines**: approved fines show *"Deducted from November 2026 pay"* or
  *"To come off the next payroll"*.

## Seed

`api:seed` adds:

- the payroll accounts: 1450 Staff Salary Advances, 2200 Salaries Payable,
  2210 EOBI Payable, 2220 Income Tax Withheld, 2230 Provident Fund
  Payable, 4910 Staff Fines & Recoveries and 5210 Employer EOBI &
  Provident Fund; 5200 and 5850 are adopted;
- **payroll policy v1** from 2000-01-01, as in decision 9 with the Bonus
  Calculator's tiers (Supervisors 38% by trips, Ticketers 38% per head,
  Workers 14% per head rounded up, Managers 10%).

## Deliberately deferred

- **PDF payslips, payroll register and settlement statement, archived.**
  These are Module 8. Today's pages print from the browser.
- **Advances as counterparty loans.** Module 6 brings staff advances onto the
  loans & counterparty ledger with director and inter-unit loans; the
  `SalaryAdvance` records are what it reads. Write-offs of an advance a
  leaver can't cover come with it.
- **Undoing a payment.** Paid runs and settlements are final; a mistake is
  corrected in the next month's run (or by a manual entry and adjustment).
- **Recurring allowances** (the same transport allowance every month). Each
  run's allowances are entered on it for now.
- **Qualifying sales from sales records.** Module 7.
- **Remitting EOBI and tax** to the authorities, and the returns. Their
  payable accounts accumulate until then.
- **Statutory confirmation.** The rates are loaded and off; switching them
  on is a policy version for the accountant.

## Where things live

```
apps/api/src/app/modules/payroll/
  payroll-math.ts (+ .spec)    pure engine: salary for the month, statutory, advances, payslip, bonus pool, encashment + sheet parity
  payroll-engine.service.ts    live HR records → payslips for a month
  payroll.service.ts           runs: overview, draft, adjustments, finalise / reopen / pay, stats
  advances.service.ts          salary advances
  bonus.service.ts             commission pools
  settlements.service.ts       full & final settlement
  policies.service.ts          payroll policy versions
  payroll-accounts.ts          the system accounts payroll posts to
  payroll-common.ts            viewers, policy lookup, locks, paying-account checks
  payroll.controller.ts, payroll.module.ts, dto/, entities/
apps/api/src/app/modules/hr/hr-common.ts   closedPayMonths / assertPayOpen — the lock
apps/api/src/database/seeds/payroll.seed.ts
apps/frontend/src/
  app/(dashboard)/payroll/{page.tsx, runs/[id]/page.tsx, runs/[id]/payslip/[employeeId]/page.tsx,
                           bonus/[id]/page.tsx, settlements/[id]/page.tsx, settings/page.tsx}
  components/payroll/          pay, adjustment, advance, pool and policy modals; the employee Pay tab
  lib/api/payroll.ts
```

## Verification checklist

- [x] Unit tests: 55 new, 135 in total.
  - **Salary-sheet parity, every row** of the Nov 2024 ZOO, Panda Cafe and
    MBF blocks: Gross and Net to the paisa, including Qasim (−1 → 28,416.67),
    Shahid Imran (−2), Sabtain (advance = salary → 0), Younas (−1, advance
    300, bonus 8,000 → 75,900). The ZOO block's Advance (41,150) and Bonus
    (13,000) totals match; the three typed rows are flagged.
  - Part months: a joiner (15 days → 15,000); a leaver in a 31-day month;
    a mid-month raise weighted by days (31,548.39); a full month absent
    floors at 0; daily wage (23 days paid).
  - Advances: instalments oldest first, never more than the pay, an
    override and a 0 skip.
  - Statutory: tax band arithmetic (1.2M → 6,000; 3M → 300,000; 5M →
    931,000), EOBI on the minimum wage (407 / 2,035), PF, all off by
    default, net and cost with EOBI on.
  - **Bonus Calculator parity**: pool 35,143; tiers 13,354.34 / 13,354.34 /
    4,920.02 / 3,514.30; 580.62 a trip; G1–G4 3,483.74 / 8,709.35 / 0 /
    1,161.25; ticketers 4,451.45 / 4,451.45 / 4,451.44; round-up tiers
    (1,641 each, 2.98 over); a pool that rounds to zero.
  - Leave encashment: pro-rated to the exit date; nothing before
    eligibility; never negative.
- [x] API run against the dev database: 80 of 80 checks passed. The run
  created, verified and then removed its own records (journal entries
  included), leaving the database in its seeded state. It covered:
  - **Scope**: Branch Staff and Branch Manager → 403; a Partner reads the
    overview but can't start a run.
  - **Policy**: a Partner publishing → 403; tiers totalling 90% → 400;
    starting yesterday → 400; v2 from 1 Oct.
  - **Inputs**: 31 daily sheets for CAFE's August, casual leave approved by
    the Branch Manager, a fine approved and one left pending, an advance of
    5,000 at 2,000 a month (posted Dr Staff Salary Advances / Cr cash; a
    reserve as the paying account → 400; reversing it from Entries → 400).
  - **Pool**: 5,000 on 100,000; workers 234 each rounded up; supervisor and
    ticketer 1,900; managers' share unshared; approved, then editing → 409.
  - **Draft run**: a duplicate → 409; next month → 400. Shahid 2.5 absent →
    27,234; Usman −1 → 27,100.67; Bilal's covered leave → no deduction;
    Hamza's instalment → 24,900; Ahsan's allowance and food → 38,900; totals
    141,368.67 net and 144,868.67 cost; warnings for the pending fine and the
    advance left over; a Branch Manager opening it → 403.
  - **Finalise**: without confirming the warnings → 400. The accrual
    balances (Dr 137,366.67 + 7,502 = Cr 141,368.67 + 2,000 + 1,500). The
    fine is marked deducted, the advance shows 3,000 outstanding, and
    cancelling it → 409.
  - **The lock**: the sheet → 409 and says why; cancelling the August leave
    → 409; reversing the accrual from Entries → 400; unapproving the pool →
    409; adjusting a finalised run → 409.
  - **Reopen**: the accrual is reversed, the fine and advance are handed
    back, the sheet is editable, and finalising again gives the same net.
  - **Pay**: before the month's end → 400; one person out of the Salary
    reserve, with the earmark released; a part-paid run can't reopen → 409;
    the rest → PAID; a Partner reads a payslip; payslip history.
  - **September**: the next instalment is planned; finalising before
    30 Sep → 400; a 0 override skips it; the draft is deleted.
  - **Settlement**: before the exit is recorded → 400. Exit on 10 Sep; an
    exit inside paid August → 400. Bilal is listed as awaiting, and the
    draft runs from September: 7,666.67 salary, 7 days annual leave encashed
    (5,366.67), warnings, a 500 deduction → 12,533.34. He drops off the
    September run; reinstating → 409. Finalised and posted, his September
    locked → 409, paid, reopening → 409.
  - **Stats**: nothing unpaid, 3,000 outstanding.
- [x] Frontend and API type-check. Lint is clean in both. In the browser, as
  the Accountant:
  - the hub, a draft run (an allowance added from the row detail updates the
    sheet), the paid August run, a payslip, the pool, the settlement,
    payroll setup with the policy editor, and the employee Pay tab all
    rendered the API's figures with no console errors;
  - no horizontal scroll at phone width.
- [ ] Browser click-through by role: the Accountant runs a month end to end
  and pays it, a Partner reads (no action buttons), a Branch Manager sees a
  locked sheet. This needs a person to sign in.
- [ ] Phase 0 sign-off:
  - **statutory rates**: EOBI registration and minimum wage, tax slabs, and
    whether to offer provident fund;
  - the bonus tiers, especially supervisors by trips and the managers' 10%,
    which the sheet never paid;
  - the part-month rule (Salary/30 per day, capped at a month);
  - annual leave encashment on exit.
