# Module 3 — Income Allocation Engine

**Status: ✅ complete. Backend verified (22 engine/parity unit tests, 74-check API run against the dev database). Frontend built, type-checked, lint-clean, and every route compiles.**

Architecture plan references: Part 03 §1 (two-stage waterfall), Part 04
("Safe to experiment with", "Guardrails scale with impact"), Part 05
(AllocationRule, Partner & ProfitShareRule, PolicyRule), Part 07 §08 and
Fig. 16 (Rules & Policy Engine), Part 10 (roles table: *Edit allocation /
profit-share rules — Partner ✓, Accountant approval only*), Part 11 Phase 2,
Fig. 3 (waterfall). Plain-language model: *Follow the Rupee* steps 2, 3 and 5.
Sprint plan demo for this phase: *"Enter a day's income, watch it split live
per the waterfall."*

## What this module is

Every day, each unit's income is split by that unit's rule into reserve
buckets (Feed, Salary, Stock …) and partner shares, the way the hidden
`Formula` sheet does today. Here the rule is **data**, not formula text. It is
versioned by effective date, a Partner approves every change, and the split
is posted to the ledger. You can see what a change would do before saving it.

## What the workbook actually computes

Read from the formulas in `Sample cash flow.xlsx → Formula`, not from its
column headers. The headers have drifted. Multi Zoo's header says "Salary
Reserve 40%" and "Feed 33%", but the formula in force says 30% and 25%.
The rule changed at least nine times between rows 3 and 1534, and each
change was made by editing formulas in place.

| Unit | Current formula (row 1534+, from 1 Jan 2026) | As a rule here |
|---|---|---|
| Multi Zoo | `=(B*30%)`, `=(B*3%)` … `=(B*11%*70%)`, `=(B*11%*30%)` — single stage, 89% to reserves | Reserves 89% by parts (30, 3, 3, 11, 7, 25, 1, 3, 5, 1) · Partners 11%: MIK 70% / MQK 30% |
| Panda Cafe | `=(Q*90%)*19%` … `=Q*2%` relief · `=(Q*8/100)*50%` | Ops 90% (Salary 19, Marketing 1, Fuel 7, Utilities 3, Rent 5, Stock 43, Oil 7, Transport 2, Maintenance 5, Capital 8) · Relief 2% · Partners 8%: 50/50 |
| Jungle Joys | `=(AG*90%)*25%` … `=(AG*10%)/3` ×3 | Ops 90% · Partners 10%: MIK : MQK : Haider = 1 : 1 : 1 |
| Joy Land | `=AV*0.8*0.25` … capital `=(AV*0.8*0.35)+AV*0.2` | Ops 80% · "Capital (development)" 20% → Capital again (a bucket can appear in two tranches) |
| Pets, MBF, Z & Co | no Formula block | no rule. Income is recorded but not earmarked until one is set up |

Every shape above is **tranches × lines**. A tranche takes a % of the day's
income, and all tranches together take exactly 100%. Each tranche splits its
share among its lines in one of two ways:
- by % of the tranche, which must total 100%;
- by a ratio of parts (25 : 40), which always splits exactly.

## Design decisions

1. **Reserves are earmarks, not extra cash.** Follow the Rupee step 2 says
   "Cash itself doesn't move." Each unit gets one system account,
   **Earmarked Funds (offset)**, in the reserve class. Allocating Rs 100 to
   Feed posts `Dr Feed Reserve 100 / Cr Earmarked Funds 100`. The unit's
   assets don't change and Cash in Hand stays put. The offset's balance is
   always minus the sum of the unit's reserves, so:
   - total assets still equal cash + bank + wallet;
   - **not yet earmarked = money on hand − reserves**. This is the workbook's
     "Expected Cash Division" check, now computed.
2. **Spending from a reserve is one entry.** A money-out entry can say
   "Paid out of: Stock Reserve". The ledger itself adds the release lines
   (`Dr Earmarked Funds / Cr Stock Reserve`), so the cash leaves and the
   earmark is released together. Branch staff can do this for their own unit.
   A reserve may go negative, because the workbook's do (Development Reserve
   −15,800). The form warns but doesn't block.
3. **Partners' shares are profit reserves, and drawings release them.** A
   partner line fills that partner's profit reserve in the unit, replacing
   the workbook's "Ismail Khan Profits Reserve (25% of 34%)" block. Cash a
   partner takes is a **Partner drawing**, which does three things:
   - debits their group-wide *Capital & Current* account (equity);
   - credits cash;
   - releases their profit reserve in that unit, all in one entry.
   A money-out entry to a partner's account is refused, so a drawing is never
   recorded as an expense.
4. **Rules are versions, never edits** (Fig. 16). Each approved version
   applies from its effective date until the next one starts. A new version
   can't start on or before a day that's already allocated, so history is
   never re-split. To re-split a past day, undo it first; the undo stays
   visible. If a version is approved for the same start date as one that
   never applied, the old one is marked *replaced before use*.
5. **Who can do what, per the roles table.**
   - The Accountant drafts a change and submits it (`rules.propose_allocation`).
   - A Partner approves or rejects it (`rules.edit_allocation`).
   - A Partner can also make a change and approve it in one step, since
     Partners hold that authority outright.
   - Every approval re-checks the rule against the ledger as it is at that
     moment.
6. **Paisa-exact splits, no leakage.** The workbook keeps unrounded values
   (8821.692308). Here each line is floored to the paisa, and the leftover
   paisa go to the largest remainders, earliest line first on a tie. So
   every line is within one paisa of the workbook, and the lines always add
   up to the day's income exactly. The engine (`allocation-math.ts`) is pure
   BigInt code: no floats, and no framework.
7. **One allocation per unit per day, tied to the income it was based on.**
   - A run records the income it split and the rule version it used.
   - If that day's income later changes (a late sale, a reversal), the day
     is flagged **changed** and can be re-run: the old entry is reversed and
     a new one posted, both dated that day.
   - Two people clicking at once are serialised by a per-unit advisory lock,
     and a partial unique index backs it up.
   - Allocation entries can only be reversed from the Allocation screen,
     which keeps the run record in step.
8. **Allocation is a deliberate act.** Nothing runs automatically. The
   Accountant (`allocation.run`) allocates a day, or "all up to yesterday".
   Today shows as *in progress* and can be allocated early; if more income
   arrives, the day shows as changed and is re-run.
9. **Opening reserves for cutover.** The workbook's reserve balances (the
   "From New Formulation" opening rows) come in as one entry per unit:
   reserves up, offset down. Correcting it reverses and reposts, the same
   way a unit's opening balances work.

## Data model

| Entity | Key columns | Notes |
|---|---|---|
| `Partner` | `name`, `shortName` (unique, e.g. MIK), `userId` (nullable, unique), `notes` | `BaseEntity`. `employeeId` arrives with the Employee master (Module 4) |
| `AllocationRule` | `businessUnitId`, `version` (unique per unit), `effectiveFrom` (`date`), `status` (DRAFT / PENDING_APPROVAL / APPROVED / REJECTED / WITHDRAWN / SUPERSEDED), `note`, `submittedBy/At`, `reviewedBy/At`, `reviewNote` | `AuditableEntity`, never deleted. `effectiveTo` is derived from the next approved version |
| `AllocationTranche` | `ruleId`, `sortOrder`, `name`, `share` `NUMERIC(7,4)`, `method` (PERCENT / PARTS) | |
| `AllocationLine` | `trancheId`, `targetType` (RESERVE / PARTNER), `accountId` or `partnerId`, `weight` `NUMERIC(10,4)` | `CHECK`: exactly the right target column set; weight > 0 |
| `AllocationRun` | `businessUnitId`, `allocationDate`, `ruleId`, `grossIncome`, `journalEntryId`, `status` (POSTED / REVERSED), `reversalEntryId`, `breakdown` (jsonb) | Partial unique index: one POSTED run per unit per day |
| `Account` (+2 columns) | `partnerId` (partner equity / profit reserve), `isReserveOffset` | |

New entry kinds: `ALLOCATION` (engine, and opening reserves), `RESERVE_TRANSFER`, `PARTNER_DRAWING`. New source: `ALLOCATION`.

## Permissions added

| Permission | Partner | Accountant | Branch Manager | Branch Staff |
|---|:-:|:-:|:-:|:-:|
| `rules.edit_allocation` (existing): approve / reject / publish rule versions | ✓ | — | — | — |
| `rules.propose_allocation`: draft and submit versions, add partners | ✓ | ✓ | — | — |
| `allocation.run`: allocate days, re-run, undo | — | ✓ | — | — |

Existing claims pick up meaning:
- `ledger.reconcile` covers partner drawings, reserve transfers and opening
  reserves.
- `transactions.create_own_unit` covers paying out of a reserve.
- `ledger.view` covers the Allocation screens (a Branch Manager sees only
  their own units).

## API (all under `/api/v1`)

| Method & path | Permission | Purpose |
|---|---|---|
| `GET /allocation/overview` | `ledger.view` | Per unit: rule, today so far, days outstanding, earmarked / not earmarked; count awaiting approval |
| `GET /allocation/units/:id/days?from&to` | `ledger.view` | Each day: income, run, state (ALLOCATED / PENDING / CHANGED / NO_RULE / NO_INCOME) |
| `POST /allocation/units/:id/allocate` `{date}` | `allocation.run` | Allocate or re-run one day |
| `POST /allocation/units/:id/allocate-outstanding` `{upTo?}` | `allocation.run` | Every outstanding day up to yesterday, oldest first, one transaction per day |
| `POST /allocation/runs/:id/undo` | `allocation.run` | Reverse a day's allocation |
| `GET /allocation/units/:id/reserves` | `ledger.view` | Reserve balances; money on hand vs earmarked |
| `PUT /allocation/units/:id/opening-reserves` | `ledger.reconcile` | Set or correct opening reserve balances |
| `GET /allocation-rules?businessUnitId&status`, `GET /allocation-rules/:id` | `ledger.view` or rule author | Versions, each line with its effective % of income |
| `POST /allocation-rules` `{…, submit?, publish?}` | propose / edit | New version (draft, submitted, or — Partner — published) |
| `PATCH /allocation-rules/:id` | propose / edit | Edit a draft |
| `POST /allocation-rules/:id/{submit,withdraw}` | propose / edit | |
| `POST /allocation-rules/:id/{approve,reject}` | `rules.edit_allocation` | |
| `POST /allocation-rules/preview` | view / propose / edit | Split a sample amount, and replay the last N days of income against the rules actually in force |
| `GET/POST /partners`, `PATCH /partners/:id` | view / propose | Partners with equity balance, profit reserves, which units they share in |
| `POST /journal-entries` | as before | Adds `reserveAccountId` (money out) and the `PARTNER_DRAWING` / `RESERVE_TRANSFER` kinds |

## Screens

- **Allocation** (new nav item):
  - banner totals;
  - *rule changes in progress* (the Partner's approval queue, and the
    Accountant's drafts);
  - a card per unit: its rule as a share bar, days to allocate, today so
    far, earmarked / not earmarked;
  - **Partners**: shares, profit reserves, capital & current balance,
    add / edit.
- **Allocation → unit**:
  - **Days**: allocate, allocate all, re-run changed days, undo. A row
    expands to show the split, and the entry number opens the entry.
  - **Reserves**: balances, money on hand vs earmarked, *move between
    reserves*, *set / correct opening reserves*.
  - **Rule & history**:
    - the waterfall in force;
    - upcoming versions;
    - the full version history (who, why, reviewer's note);
    - *propose / change the rule*.
- **Rule editor**:
  - tranches and lines, split by % or parts, each line showing its % of
    income;
  - live checks in the API's own words;
  - *start from another unit's rule* (reserves matched by bucket name);
  - a **preview** of a sample day plus the last 7 / 30 / 90 days replayed
    against the rules actually in force;
  - Save draft / Submit for approval / (Partner) Approve & publish.
- **Review**: the proposal, its preview, and Approve / Reject with a note.
- **New Entry**:
  - money out gains **Paid out of reserve**, with a warning when it takes
    the reserve below zero;
  - the Accountant gains **Partner drawing** and **Reserve transfer**;
  - the preview shows the earmark being released.

## Seed

- `api:seed` adds three partners: Ismail Khan (MIK) and Qasim Khan (MQK),
  each with a capital & current account, and Haider (Jungle Joys only).
- Every unit with reserves gets an Earmarked Funds offset.
- The four rules in the table above are seeded as **v1, effective
  2026-01-01, approved**, with notes naming the workbook cells they came
  from.
- These are starting values, not fixed policy. Every percentage — each
  tranche's share of income, each reserve line, and each partner's share
  (by % or by parts) — is configurable per unit in the rule editor, as a
  new effective-dated version a Partner approves.

## Deliberately deferred

- **Historical workbook import.** The plan puts it in Phase 2. It needs the
  Phase 0 decisions first: which rule version applied when (the formulas
  changed at rows 29, 33, 48, 240, 254, 316, 494, 1293 and 1534), and what to
  do about the `#REF!` / stale `IMPORTRANGE` rows. The engine is ready for
  it: import income, approve the historical versions with their dates, set
  opening reserves, then *allocate all*. The parity tests already cover the
  2021 and 2026 rules.
- **Monthly profit entitlement and the partner statement** (Fig. 6: P&L ×
  share ratio − drawings). This belongs with the P&L and period close. The
  equity accounts and drawings it needs exist now.
- **Scheduled nightly allocation.** It's manual for now, with "allocate all
  up to yesterday".
- **Inter-unit transfers and loans:** Module 6.
- **Asking whether to copy a rule in the Add Business Unit wizard.** The
  rule editor's *start from another unit's rule* covers this for now.

## Where things live

```
apps/api/src/app/modules/allocation/
  allocation-math.ts (+ .spec)   the pure waterfall + formula-parity suite
  allocation-rules.service.ts    versions, validation, approval, preview
  allocation.service.ts          days, allocate / re-run / undo, reserves, opening reserves
  partners.service.ts            partners and their accounts
  allocation.controller.ts       /allocation, /allocation-rules, /partners
  entities/                      Partner, AllocationRule/Tranche/Line, AllocationRun
apps/api/src/app/modules/accounts/reserves.ts   offset, partner reserve & equity provisioning
apps/api/src/app/modules/journal/journal.service.ts   paid-out-of-reserve, drawings, reserve transfers
apps/api/src/database/seeds/allocation.seed.ts
apps/frontend/src/
  app/(dashboard)/allocation/{page.tsx,[unitId]/page.tsx}
  components/allocation/{RuleWaterfall,RuleEditorPanel,RulePreviewPanel,RuleReviewModal,PartnerFormModal,OpeningReservesModal}.tsx
  lib/api/allocation.ts
```

## Verification checklist

- [x] Unit tests: 22 new tests (54 total).
  - Scaled-percentage parsing and rule validation.
  - Exact totals on uneven splits; zero-income and negative (correction)
    days; a bucket appearing in two tranches; a seven-figure day.
  - **Formula parity** against 12 real workbook rows: Multi Zoo 2021
    (rows 3, 5, 12) and 2026 (row 1786), Panda Cafe 2021 (row 3) and 2026
    (row 1786), Jungle Joys (rows 3, 4 — including the 1240/3 split),
    Joy Land (rows 3, 5). Every bucket is within one paisa of the workbook
    and the total is exact.
- [x] API run against the dev database: 72 of 74 checks passed on the first
  run. The two failures were the test sending two fields the preview
  endpoint doesn't accept. It was re-checked with the right body and passed.
  The run covered:
  - Seeded offset and partner reserves.
  - Scope: a Branch Manager sees only CAFE.
  - Rs 20,441 CAFE income allocated. The posted split matches Formula row
    1786 and cash in hand is unchanged.
  - Double allocation → 409.
  - Direct reversal of an allocation entry → 400.
  - Late income → CHANGED → re-run reverses the old entry and posts
    21,441 × 38.7% = 8,297.67 to Stock.
  - Undo → PENDING.
  - Two concurrent allocations of one day → exactly one 201 and one 409.
  - Paid out of reserve: cash −5,000, reserve −5,000, offset +5,000. Paying
    out of another unit's reserve, a partner's reserve, or on money in →
    400.
  - A general journal touching a reserve → 400.
  - Reserve transfer: works; staff → 403; into a partner reserve → 400.
  - Partner drawing: releases the MQK profit reserve by 300 and equity by
    300. A drawing entered as an expense → 400.
  - Offset = −Σ reserves, and not yet earmarked = money on hand −
    earmarked.
  - Rule workflow:
    - rules that don't total 100%, that point at another unit's reserve, or
      that start on an allocated day → 400;
    - draft → edit → submit → Accountant approve 403 → Partner reject with a
      note;
    - propose → preview (Rs 100,000 → Stock 37,800; the 60-day replay shows
      Stock −237.97 / Salary +237.97) → approve → upcoming, and v1's end
      date set;
    - a Partner publishing the same date supersedes it;
    - withdraw.
  - Partners: duplicate short name → 409; deactivating a partner who holds a
    live share → 400.
  - Opening reserves: set; again → 409; correct → reverse and repost; Branch
    Manager → 403.
  - Allocate all outstanding days → nothing left.
  - Trial balance still balances.
- [x] Frontend and API type-check. Lint is clean in both. Every new route
  compiles and returns 200.
- [x] Partner and reserve percentages are configurable per unit through the
  rule editor (propose → Partner approval, effective-dated), so no separate
  sign-off on the seeded values is needed. A browser click-through is not
  required for this module.
