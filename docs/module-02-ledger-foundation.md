# Module 2 — Ledger Foundation

**Status: ✅ backend complete and verified (57/57 API checks, 14/14 unit tests) — frontend built, type-checked and lint-clean; browser click-through pending (see checklist).**

Architecture plan references: Part 03 §2 (running-balance ledgers), Part 05
(BusinessUnit, Account, Transaction), Part 06 (M1 Cash & Bank Ledger, and the
business-unit wizard + chart of accounts parts of M13), Part 11 Phase 1,
Fig. 4 (ledger posting mechanic). Plain-language model: *Follow the Rupee*
Parts 1–3.

## What this module is

The floor every later module stands on. After this module, a rupee can be
recorded once — as a balanced, double-entry transaction against a real chart
of accounts — and every cash, bank and wallet ledger in every business unit
shows the same `Date · Description · Deposit · Withdraw · Balance` view the
workbooks show today, except the balance is computed, never typed.

It deliberately does **not** move money between reserve buckets (Module 3's
allocation engine), handle loans or inter-unit transfers (Module 6), or
compute payroll. It gives those modules somewhere correct to post to.

## What the audit says this must replace

Taken directly from `Sample cash flow.xlsx` / `Sample daily exp.xlsx`, not
from the plan's summary:

| Workbook evidence | What it becomes here |
|---|---|
| `ZOO Cash New`, `Cafe Cash New`, `Jungle Joys`, `Joy Land`, `Pets Accessories`, `MBF Cash Flow` — one tab per unit, each a row of side-by-side `Date/Description/Deposit/Withdraw/Balance` blocks, balance `=I5+G6-H6` | `BusinessUnit` + one `Account` per block; ledger view computes the running balance with a SQL window function |
| `Bank Balance`, `Easy Paissa`, `Z & Co Pvt Ltd Bank Balance` — one physical account, balance split by a `Head` column (`Zoo`, `Cafe`, `MBF`, `Jungle Joy`) via `SUMIFS` | Per-unit `BANK` / `WALLET` accounts — each unit's share of the physical account is its own ledger, so no `SUMIFS` by head |
| Reserve blocks differ per unit (Zoo has Feed/Medicine, Cafe has Oil/Fuel/Stock, MBF has Assets/Feed) | Per-unit reserve account set, seeded from the real headers below; **held at zero** until Module 3 |
| Daily-expense sheets: `Account Title → Sub Title → Department` (e.g. `Animals Feed & Medicine → Carnivores → Feed`) and the Google Form's `Company / Account Title` | Group-level income/expense accounts with parent → child hierarchy; business unit is a *dimension on the line*, not a separate copy of the expense tree per unit |
| `Weekly Report Closing` — `Opening Balance ON <date> / Cash in Hand` | Opening balance entries against `Opening Balance Equity`, plus a date-ranged ledger with an opening-balance row |

Real reserve buckets per unit (the Formula sheet's row-2 headers):

- **Multi Zoo** — Salary, Marketing, Medicine, Development, Utilities, Feed, Transport, Maintenance, Capital, Employee Relief
- **Panda Cafe** — Salary, Marketing, Fuel, Utilities, Rent, Stock, Oil, Transport, Maintenance, Capital, Employee Relief
- **Jungle Joys / Joy Land / Pets Accessories** — Salary, Utilities, Stock, Rent, Transport, Maintenance, Capital, Employee Relief, Marketing
- **MBF** — Assets, Utilities, Stock, Salary, Maintenance, Feed

Partner profit reserves (`Ismail Khan Profits Reserve (25% of 34%)` etc.),
`Ibrahim Khan Debt Account`, `Zoo Loan Return`, `Party Fund` and
`Employees Mess Account` are **not** seeded here — they are partner equity
(Module 3) or loans (Module 6).

## Design decisions

1. **Double-entry, balanced to the paisa.** A `JournalEntry` has ≥ 2
   `JournalLine`s; each line is a debit *or* a credit, never both, never
   zero; Σdebit = Σcredit. The line shape is enforced by a Postgres `CHECK`
   constraint (`CHK_journal_lines_one_side` — verified to reject a raw SQL
   insert). Σdebit = Σcredit spans rows, so it's enforced by
   `JournalService` (BigInt paisa, no floats) inside the same DB transaction
   that writes the lines — `JournalService.post` is the only writer.
2. **Money is `NUMERIC(18,2)` in the database and a string on the wire.**
   Seven-figure balances, years of history — no JS `number` ever holds a
   currency amount. `@multizoo/utils` gets `toPaisa` / `formatPaisa`.
3. **Balances are computed, never stored.** Totals are `SUM`s over journal
   lines; the ledger's running balance is `runningBalances()` in
   `journal/ledger-math.ts` applied to rows ordered by `entryDate, entryNo,
   lineNo` — the same tested function the formula-parity suite drives with
   workbook rows. The sign is flipped for credit-normal accounts (liability,
   equity, income) so every screen shows a plain positive balance.
4. **Posted entries are immutable.** No edit, no delete. A mistake is
   corrected by a **reversal** — a new entry with debits and credits
   swapped, linked both ways — exactly the "a mistake is a new correcting
   entry, never a lost one" rule in the architecture plan.
5. **Business unit is a dimension on every line.** Cash/bank/wallet/reserve
   accounts are *owned* by a unit; income and expense accounts are
   group-wide and the line carries the unit. Per-unit P&L (Module 4) is then
   a `GROUP BY businessUnitId`, and adding an expense category once adds it
   everywhere.
6. **One entry, one unit.** Every line of an entry must belong to the same
   business unit. Moving money *between* units is an inter-unit loan, which
   the roles table puts behind Partner approval — that's Module 6, and it
   gets a proper due-to/due-from pair rather than an unbalanced unit.
7. **Reserve accounts are read-only to people.** They exist (so the wizard
   provisions a complete unit and Module 3 has targets), but a manual entry
   that touches a `RESERVE` account is rejected: only the allocation engine
   moves them.
8. **Only leaf accounts are postable.** `Animal Feed & Medicine` is a group;
   `Carnivores` is where the rupee lands. Enforced by `isPostable`.
9. **Unit-scoped access.** A new `user_business_units` join records which
   units a user works in. Holding `units.access_all` (Partner, Accountant)
   means every unit; everyone else is limited to their assigned units — the
   "own unit" in `transactions.create_own_unit` finally means something.

## Data model

| Entity | Key columns | Notes |
|---|---|---|
| `BusinessUnit` | `code` (unique, e.g. `ZOO`), `name`, `type` (`WILDLIFE_PARK`, `FOOD_BEVERAGE`, `RETAIL`, `ENTERTAINMENT`, `LIVESTOCK`, `HOLDING`), `description` | `BaseEntity` (soft delete, isActive, audit) |
| `AccountClass` | `key`, `name`, `type` (bucket), `unitRule`, `codeStart`/`codeEnd`, `isLiquid`, `isReserve`, `isReconcilable`, `provisionForNewUnits`, `defaultAccountName`, `sortOrder`, `isSystem` | Configurable — see "Configurable chart of accounts" |
| `ChartSettings` | `unitCodePattern`, `groupCodePattern`, `codeStep` | Single row |
| `Account` | `code` (unique, editable), `name`, `type` (copied from the class), `classId`, `businessUnitId` (nullable = group-wide), `parentId` (nullable), `isPostable`, `isSystem`, `systemKey` | `BaseEntity`. System accounts (Opening Balance Equity) can't be renamed/deactivated |
| `JournalEntry` | `entryNo` (serial, shown as `JE-000123`), `entryDate` (`date`), `businessUnitId`, `description`, `kind` (`MONEY_IN`, `MONEY_OUT`, `TRANSFER`, `OPENING_BALANCE`, `GENERAL`, `REVERSAL`), `source` (`MANUAL`, `SYSTEM`, `IMPORT` — later modules add `ALLOCATION`, `PAYROLL`…), `reversalOfId`, `reversedById`, `reference` | `AuditableEntity` — no soft delete, by design |
| `JournalLine` | `entryId`, `lineNo`, `accountId`, `businessUnitId`, `debit`, `credit` (`NUMERIC(18,2)`, default 0), `memo`, `costCentre` (nullable, reserved for Module 6's cross-charges) | `CHECK (debit >= 0 AND credit >= 0 AND (debit = 0) <> (credit = 0))` |
| `UserBusinessUnit` | `userId`, `businessUnitId` (composite PK), `assignedBy` | `JoinEntity` |
| `CashReconciliation` | `accountId`, `asOfDate`, `systemBalance`, `countedBalance`, `variance`, `note` | A cash count vs. the computed balance. Recording one never posts anything — the accountant decides whether a correcting entry is needed |

## Seeded chart of accounts

Group-wide (unit on the line):

- **Assets** — `1400 Accounts Receivable`
- **Liabilities** — `2100 Accounts Payable (Suppliers)`
- **Equity** — `3900 Opening Balance Equity` *(system)*
- **Income** — `4100 Ticket Sales`, `4200 Cafe Sales`, `4300 Retail Sales`, `4400 Ride & Attraction Sales`, `4500 Livestock Sales`, `4900 Other Income`
- **Expenses** — `5100 Animal Feed & Medicine` → Carnivores, Herbivores, Birds, Monkeys, Fish, Medicine · `5200 Salaries & Wages` · `5300 Utilities` · `5400 Maintenance` · `5500 Transport & Fuel` → Transport, Fuel · `5600 Marketing` · `5700 Stock & Purchases` → Stock, Cooking Oil · `5750 Rent` · `5800 Development & Capital Expenditure` · `5850 Bonus & Employee Relief` · `5900 Bank Charges` · `5950 Miscellaneous` · `5990 Cash Over / Short`

Per unit (`<UNIT>-xxxx`): `1100 Cash in Hand`, `1200 Bank Account`,
`1300 Easypaisa Wallet` (holding company: bank only), then reserves from
`1510` in steps of 10. Reserves own the whole `1500–1999` band — Panda Cafe
alone has eleven, which overflowed a 100-wide band (caught by the e2e run).

Seeded result: 7 units, 105 accounts (32 group-wide).

Business units: `ZOO` Multi Zoo, `CAFE` Panda Cafe (both outlets, as the
plan groups them), `GIFT` Jungle Joys Gift Shop, `JOYLAND` Joy Land, `PETS`
Pets Accessories, `MBF` MBF Breeding Unit, `ZCO` Z & Co (holding). PC NUST
is not created — eliminated by decision (plan Part 02).

Bank/wallet names are deliberately generic — the Phase 0 chart-of-accounts
workshop renames them to the real institutions from the Accounts screen.

## Permissions added

| Permission | Partner | Accountant | Branch Manager | Branch Staff |
|---|:-:|:-:|:-:|:-:|
| `ledger.view` — see accounts, balances, ledgers (own units unless below) | ✓ | ✓ | ✓ | — |
| `units.access_all` — every business unit, not just assigned ones | ✓ | ✓ | — | — |
| `business_units.manage` — add / edit a business unit (wizard) | ✓ | ✓ | — | — |
| `accounts.manage` — edit the chart of accounts | — | ✓ | — | — |
| `transactions.reverse` — reverse a posted entry | — | ✓ | — | — |

Existing claims pick up real meaning: `transactions.create_own_unit` (post
entries in your units), `ledger.reconcile` (record cash counts, post opening
balances and general journals).

## API (all under `/api/v1`)

| Method & path | Permission | Purpose |
|---|---|---|
| `GET /business-units` | any authenticated | Units visible to the caller |
| `POST /business-units` | `business_units.manage` | Wizard: create unit + standard accounts + reserve set (copied from a unit or picked) + optional opening balances |
| `PATCH /business-units/:id` | `business_units.manage` | Rename / retype / deactivate |
| `GET /accounts` | `ledger.view` or `transactions.create_own_unit` | Chart of accounts (filter by unit/type/search), with balances |
| `POST /accounts`, `PATCH /accounts/:id` | `accounts.manage` | Add / edit account |
| `GET /accounts/:id/ledger?from&to` | `ledger.view` | Opening balance + rows with running balance |
| `GET/POST /accounts/:id/reconciliations` | `ledger.view` / `ledger.reconcile` | Cash-count history / record one |
| `GET /journal-entries` | `ledger.view` or `transactions.create_own_unit` | Paged list, filter by unit/date/account/search |
| `GET /journal-entries/:id` | same | Entry with lines |
| `POST /journal-entries` | `transactions.create_own_unit` | Post a balanced entry |
| `POST /journal-entries/:id/reverse` | `transactions.reverse` | Reversing entry |
| `GET /ledger/cash-position?asOf` | `ledger.view` | Daily cash position per unit (cash/bank/wallet) + the day's in/out |
| `GET /ledger/trial-balance?asOf&businessUnitId` | `ledger.view` | Σdebit = Σcredit proof |
| `PUT /users/:id/business-units` | `users.invite` | Assign a user's units |

## Screens

- **Dashboard** → Daily cash position: group totals (cash / bank / wallet)
  in the banner, one card per unit, the day's money in/out, recent entries.
- **Units** → business-unit cards + *Add Business Unit* wizard (details →
  reserve set → opening balances).
- **Accounts** → chart of accounts grouped into the five buckets
  (Assets, Liabilities, Equity, Income, Expenses), balances inline, click
  through to the ledger.
- **Account ledger** (`/accounts/:id`) → `Date · Entry · Description ·
  Deposit · Withdraw · Balance`, opening-balance row, date range, cash count.
- **Transactions** → list + *New Entry* panel in plain language: **Money
  in**, **Money out**, **Transfer**, and (Accountant) **Opening balance** /
  **General journal**. The user never has to pick "debit" or "credit" for
  the first three — the form shows a before → after preview.
- **Users** → invite / edit now includes business-unit assignment.

## Deliberately deferred

- Moving reserve balances — Module 3 (allocation engine).
- Inter-unit transfers, loans, partner drawings — Modules 3 & 6.
- Period close / locking a month — with the P&L in Module 4.
- Historical workbook import — Module 3 imports history against these
  ledgers (plan Phase 2 "historical import & reconciliation").
- Migrations instead of `synchronize` — before first staging deploy.

## Configurable chart of accounts (Accounts → Settings)

Added after the first review, so that nothing about the chart's structure
is hard-coded. The **five buckets stay fixed** (Assets, Liabilities, Equity,
Income, Expenses) — balance direction and every report depend on them.
Everything beneath them is data the Accountant (`accounts.manage`) edits:

- **Account classes** (`account_classes`) replace the old fixed "subtype"
  enum. Each class has a bucket, a **unit rule** (`UNIT_REQUIRED` /
  `GROUP_ONLY` / `EITHER`), a **code range**, and behaviour flags:
  - **Money on hand**: shows on the cash-position dashboard (as its own
    column) and can be used in money in/out/transfers.
  - **Reserve**: only the allocation engine posts to it.
  - **Reconcilable**: can be checked against a count or statement.
  - **Create for new units**: the wizard pre-ticks it, using a default
    account name.

  Nine built-in classes are seeded (Cash, Bank, Mobile wallet, Receivable,
  Reserve, Payable, Equity, Income, Expense). They can be renamed and
  re-ranged, but their bucket is fixed. New classes (e.g. *Fixed Asset*,
  *Petty Cash*) are added freely. The ledger never checks a class's name
  or key; it only reads the flags.
- **Guard rails** (`classRuleViolation`):
  - Money-on-hand and reserve classes must be unit-owned Assets, and a
    class can't be both.
  - A class's bucket can't change once accounts use it.
  - A unit-rule change that would break existing accounts is rejected.
  - A class can't be deactivated while active accounts use it.
- **Numbering** (`chart_settings`, one row):
  - A unit pattern (default `{UNIT}-{NUM}`, must contain `{UNIT}`), a group
    pattern (default `{NUM}`), and a step (default 10).
  - Codes are generated inside the class's range; a sub-account is
    numbered in the 99 numbers after its heading.
  - Changing the pattern affects new codes only.
- **Codes are labels.** Journal lines reference account ids, so an
  account's code can be edited at any time (unique across the chart).
  An account can also move to another class in the same bucket.
- **System accounts** are found by `systemKey` (e.g.
  `OPENING_BALANCE_EQUITY`), never by code, since codes are now editable.

## Editing a business unit

Edit uses the same three parts as the Add wizard:

- **Details**: name, type, description and active flag. The **short code
  is editable**, because account codes are only labels. An optional
  "re-letter" swaps the old code for the new one in the unit's existing
  account codes (`relabelUnitCode`, whole-segment match: `JOYLAND-1100` →
  `JL-1100`, but `CAFETERIA-…` is untouched).
- **Accounts**: the unit's accounts with balances. You can add standard
  accounts it lacks and reserve buckets (`POST /business-units/:id/accounts`,
  same rules as the wizard). With `accounts.manage` you can also add any
  other account or edit one.
- **Opening balances**: `GET`/`PUT /business-units/:id/opening-balances`.
  Posting a second opening balance is refused (409). *Correct opening
  balance* reverses the existing entry, dated as the original and with the
  reason, and posts the corrected one in a single transaction. The change
  stays visible in the ledger and the trial balance still balances.

## Where things live

```
apps/api/src/app/modules/
  business-units/   entity, wizard service (unit + accounts + opening balances in one transaction)
  accounts/         Account, AccountClass, ChartSettings; chart-of-accounts.ts (seed + provisioning),
                    account-codes.ts (pattern numbering, + .spec), account-classes service
  journal/          JournalEntry/JournalLine, JournalService.post/reverse, ledger-math.ts (+ .spec)
  ledger/           balances, running ledger, cash position, trial balance, CashReconciliation
apps/api/src/common/scope/unit-scope.ts   who may see / post to which unit
apps/api/src/database/seeds/ledger.seed.ts
libs/shared/utils/src/lib/{money,dates}.ts   BigInt paisa helpers, Asia/Karachi business date
apps/frontend/src/
  app/(dashboard)/{dashboard,transactions,accounts,accounts/[id],business-units}
  components/ledger/{NewEntryPanel,EntryDetailModal}.tsx
  components/accounts/AccountFormModal.tsx, components/business-units/AddUnitWizard.tsx
  lib/api/ledger.ts, lib/money.ts
```

Run the unit tests with `npx jest -c apps/api/jest.config.js`.

## Verification checklist

- [x] Unit tests (14): paisa arithmetic incl. 6,000-row sums, balance
      validation, running balance and normal-balance sign — including the
      `Bank Balance` sheet's own `=G9+E10-F10` rows (1453 → 1587 → 3951)
- [x] API boots; tables created; `CHK_journal_lines_one_side` exists and
      rejects a raw two-sided insert; `entryNo` is a Postgres sequence
- [x] `api:seed` creates 7 units and 105 accounts; re-run creates 0
- [x] Role claim counts: Partner 10, Accountant 16, Branch Manager 6,
      Branch Staff 2, SUPER_ADMIN 23
- [x] Rejected with 400: unbalanced, reserve account, group heading, future
      date, impossible date (2026-02-30), 3-decimal amount, wrong shape for
      "money in", a line from another unit
- [x] Rejected with 403: staff opening balance, staff posting to another
      unit, Partner posting (the roles table gives Partners no entry rights),
      Branch Manager reversing / reconciling / adding units, Partner editing
      the chart
- [x] Money in / money out / transfer: CAFE cash ledger runs
      15,000 → 32,515 → 32,015 → 27,015; date-ranged view carries the
      15,000 opening; income shows positive
- [x] Cash position: day in/out excludes transfers and opening balances
- [x] Trial balance: debits = credits
- [x] Reversal restores the balance, links both ways; double reversal,
      reversal-of-reversal → 400; two concurrent reversals → exactly one wins
      (row lock)
- [x] Cash count records a −15 variance without posting anything
- [x] Wizard: unit + 3 liquid + deduped reserves + opening balance entry in
      one transaction; duplicate code → 409; can't deactivate a unit or
      account that still holds money
- [x] Branch Manager assigned to CAFE sees one unit, only CAFE entries,
      no Zoo accounts, 403 on the Zoo ledger; reassigning a user's units
      takes effect on their next request
- [x] Frontend type-checks and lints clean; every new route compiles and
      serves 200
- [x] Configurable chart: 30 unit tests (patterns, numbering, class rules)
      and a 64-check e2e run — custom classes, bucket/unit-rule guards,
      pattern switch to `{NUM}.{UNIT}` with step 5 generating `1150.CAFE` →
      `1155.CAFE`, code edits leaving the ledger untouched, reclassify
      within a bucket, a new Petty Cash class appearing as a cash-position
      column, and the wizard provisioning chosen classes
- [ ] Frontend click-through in a browser as Accountant, Branch Manager and
      Branch Staff — needs a human to sign in
