# Module 6 — Loans, Utilities & Cost Centres

**Status: ✅ backend complete and verified (39 new engine/parity unit tests, a 134-check API run against the dev database). Frontend built, type-checked, lint-clean, and every screen exercised in the browser against real data. Browser click-through by each role still pending (see checklist).**

Architecture plan references: Part 02 ("Holding & partners": personal
ledgers migrate as first-class loan accounts), Part 03 §4 (loans, advances &
counterparty ledgers), §8 (utility sub-meter allocation), §10 (cost-centre
cross-charges), Part 05 (LoanAccount, Advance, UtilityMeter & Reading,
Transaction cost-centre tag), Part 06 (M4, M8, M10), Part 08 (Loan &
payable/receivable statement; Utility bill allocation sheet), Part 10
(roles: *"Approve loans & inter-unit transfers — Partner ✓, Accountant
initiate only"*), Part 11 Phase 5, Fig. 5, 10 and 12.

## What this module is

- **Loans & counterparties (M4)**: every loan the group gives or takes —
  partners lending to a unit, a partner or officer borrowing, an officer's
  cash float, outside people and companies — as its own account with a
  running balance and full history. Money between units runs through a
  current account between each pair. Staff salary advances (Module 5) sit on
  the same ledger, and what a leaver can't repay is written off here.
- **Utility allocation (M8)**: shared bills split between units, by
  sub-meter readings or fixed weights, each unit charged its share.
- **Cost centres (M10)**: a tag on spending; a centre charged to a partner
  routes the spending off the unit's P&L onto the partner's profit.

## What the workbook actually does

`Sample cash flow.xlsx`, all hidden sheets, read cell by cell:

**Loans.**

- `Qasim Khan Loan Account`: MQK lending to the Zoo, mostly by paying
  suppliers directly ("China rides purchased by ZD", "boxing machine
  carriage") and repaid in cash, some of it "from Joyland profit reserve".
  `E4 = E3 + C4 − D4`, closing at −5,984,270 (the Zoo owes him).
- `Loan Dir to Mik`: 8,650,000 taken (a breakdown of five drawdowns in
  A4:A8), returned in eight amounts, most "Rifaqat cash taken from Mik
  Profit". `H = A$2 − SUM(E$2:E2)`, 500,000 left.
- `Officers Expenses Sheet`: Saad Khan's and Yousaf sb's floats. Cash given
  to them, company bills they paid out of it, running balance.
- `Ismail Khan`, `Yousaf Khan`: personal funds and cafe bills charged to a
  person.
- `Payable & Receiveable`: receivables by counterparty (loans to Joy Land,
  Z & Co, Col Ibrahim, an employee) and supplier payables, by `SUMIFS` on a
  typed title.

**Utilities** (`Sub Meters Details`) has two mechanisms.

- *Zoo Green Meter*, per billing cycle:
  - consumed = end − start;
  - rate = bill ÷ units on the bill;
  - charge = units × rate;
  - what the sub-meters don't cover is charged to the Zoo.
  - The first cycle (Jul–Aug 2023) differs: meters installed mid-cycle were
    pro-rated (`G9/26*30`, `G10/13*30`), the remainder split 70% Zoo / 30%
    Panda Cafe, and it used a typed rate of 78.83 against a true
    78.8281. That over-charges the 378,848 bill by 8.98.
- *Admin Block IESCO Bill Division*:
  - each of ten offices is owned by Z & Co, the Zoo, or half each;
  - Z & Co 5.5 / Zoo 4.5, so 87,271 splits 47,999.05 / 39,271.95.

**Cost centres** (`342 Expense`, `342 Expense Media`). The media office's
spending is "Paid from Zoo MIK Profit": each row's description starts
"MIK(… 342 …)". The right-hand block totals it by category (Transport &
Food 26,750 · Development 496,000 · Assets 549,500 = 1,072,250). The
left-hand block totals 1,058,250: the two disagree (−35,000 on one bill,
−20,000 on the laptop, +69,000 chairs missing).

## Design decisions

1. **A loan is its own account, and its movements are its history.**
   - Each loan gets an account in its unit's books: "Loan from MQK" in
     the payable class, or "Loan to Col Ibrahim" in the receivable class,
     numbered one apart in the class range (ZOO-2101, ZOO-1401 …).
   - The account is posted to only from the Loans screens (source
     `LOANS`). A manual entry to it, or reversing one of its entries from
     Entries, is refused, so the loan's movements and its ledger always
     agree.
   - Balance = everything added − everything paid back (Fig. 5), and
     can swing negative (over-repaid).
2. **Movements are recorded in plain words**, each mapped to an effect
   (adds to / pays back) and the other side of the entry:

   | Lent (they owe us) | Borrowed (we owe them) | Other side |
   |---|---|---|
   | Lent more / They repaid | Borrowed more / We repaid | cash, bank, wallet (repayments may come *out of a reserve*) |
   | Charged to them | They paid a bill for us | an income/asset or expense account — no cash |
   | They spent it for us (an officer's float) | Charged against it | an expense or income account |
   | Set off against their profit | Left their profit with us | the partner's capital & current (+ releases their profit reserve in the unit, like a drawing) |
   | Write off | — | Loans & Advances Written Off (5960) |
   | Opening balance | Opening balance | Opening Balance Equity |
3. **Approval follows the roles table.**
   - An Accountant's new loan waits for a Partner, together with its first
     movement; a Partner's is approved as they make it.
   - Paying down never waits: cash coming back, or an officer spending
     their float on company bills.
   - An advance within the loan's **approved ceiling** posts straight
     away; past it, or with no ceiling, it waits.
   - Write-offs, set-offs against profit and every inter-unit transfer
     always wait.
   - The one who asked can withdraw; only a Partner changes an approved
     loan's ceiling.
4. **Between units, a mirrored current account.**
   - The first transfer between two units opens a pair: "Due from Joy
     Land" in Multi Zoo's books and "Due to Multi Zoo" in Joy Land's.
   - Every transfer posts both halves (one entry per unit, since an entry
     never spans units).
   - Approving, rejecting or reversing either half acts on both.
5. **Staff advances stay Module 5's records**, read onto the ledger.
   - The Loans screen lists outstanding advances, and an employee's
     statement shows them beside any loans.
   - A leaver's advance can be **written off by a Partner once their
     settlement is paid**, since the settlement recovers what it can first
     and can't then reopen. The entry is Dr Loans & Advances Written Off /
     Cr Staff Salary Advances; the advance becomes `WRITTEN_OFF`, and the
     write-off can be undone.
6. **Utility bills are allocated, then charged through the inter-unit
   accounts.**
   - The unit the bill comes to pays it. Each other unit's share posts
     Dr its Utilities / Cr what it owes the payer, and the payer's side
     Dr Due from / Cr Utilities. So each unit's P&L carries its own
     electricity and the payer is owed the rest.
   - Posting can also record the bill's payment (optionally out of the
     Utilities reserve) when it hasn't been entered already.
   - Unposting reverses everything.
7. **The bill's own rate, exact to the paisa.**
   - Charges are computed as exact fractions of bill × units ÷ units on
     the bill, rounded once, with the leftover paisa to the largest
     remainders, so they always add up to the bill.
   - A reading can say how many days it covers; it's then pro-rated to
     the connection's standard cycle (30). New bills suggest this for
     meters installed mid-cycle.
   - Start readings come from the last bill's end readings. Readings,
     the unmetered split and shared weights are copied onto each bill, so
     editing the connection never rewrites a past cycle.
8. **Cost centres are routed by the ledger.**
   - Tagging a money-out or general entry marks its expense lines.
   - For a centre charged to a partner, the ledger adds:
     - Dr the partner's capital & current;
     - Cr each tagged expense (both lines flagged `crossCharge`);
     - on money out, the release of their profit reserve in the unit.
   - The unit's P&L nets to zero, but the centre's spending still reports
     by category.
   - Reversals carry the tags and routing.
   - Only a Partner can point a centre at a partner's profit, or change one
     that does.

## Data model

| Entity | Key columns | Notes |
|---|---|---|
| `Counterparty` | `name`, `kind` (PARTNER / EMPLOYEE / BUSINESS_UNIT / PERSON / ORGANISATION), `partnerId` / `employeeId` / `businessUnitId` (each unique), `phone`, `notes` | Partners are added automatically; a unit's row is created with its first inter-unit movement |
| `Loan` | `loanNo` (LN-0001), `counterpartyId`, `businessUnitId`, `direction` (RECEIVABLE / PAYABLE), `purpose`, `limit`, `status` (PENDING_APPROVAL / ACTIVE / REJECTED / CLOSED), `accountId`, `mirrorLoanId`, reviewed by/at/note, `closedAt` | |
| `LoanMovement` | `loanId`, `movementDate`, `effect`, `method` (CASH / ON_ACCOUNT / PROFIT_SETOFF / OPENING), `amount`, `description`, `otherAccountId`, `reserveAccountId`, `status` (PENDING_APPROVAL / POSTED / REJECTED / REVERSED), `journalEntryId`, `reversalEntryId`, `mirrorMovementId`, `utilityBillId`, reviewed by/at/note | |
| `UtilityConnection` | `name`, `utility`, `provider`, `reference`, `businessUnitId` (pays), `method` (SUB_METERED / SHARED), `standardDays`, `expenseAccountId`, `remainderSplit` jsonb, `shares` jsonb | |
| `SubMeter` | `connectionId`, `name`, `businessUnitId` (charged to), `installedOn`, `sortOrder`, `isActive` | Retired, never deleted |
| `UtilityBill` | `connectionId` + `periodTo` (unique), `periodFrom`, `billAmount`, `totalUnits`, `status` (DRAFT / POSTED), `readings` / `remainderSplit` / `shares` jsonb, `result` jsonb, `paymentEntryId`, `paidOn`, posted by/at | |
| `CostCentre` | `code` (unique), `name`, `description`, `chargeTo` (UNIT / PARTNER), `partnerId`, `businessUnitId` (only that unit's entries) | |
| `Account` (+1) | `loanId` | A loan's own account |
| `JournalLine` | `costCentre` varchar → `costCentreId` uuid, + `crossCharge` | |
| `SalaryAdvance` (+3, +1 status) | `writtenOff`, `writeOffEntryId`, `writeOffReason`; status `WRITTEN_OFF` | |
| Journal | kind `LOAN`; sources `LOANS`, `UTILITIES` | Undone only from their screens |

## Permissions

One new claim, `utilities.manage` (Accountant). Loans use the two claims
seeded since Module 1.

| Permission | Partner | Accountant | Branch Manager | Branch Staff |
|---|:-:|:-:|:-:|:-:|
| `loans.initiate`: counterparties, loans, movements, transfers (subject to approval) | — | ✓ | — | — |
| `loans.approve`: approve / reject; ceilings; write-offs; posts at once | ✓ | — | — | — |
| `utilities.manage`: connections, bills, post / unpost | — | ✓ | — | — |
| `pnl.view_consolidated`: read utilities | ✓ | ✓ | — | — |
| `accounts.manage` / `rules.edit_allocation`: set up cost centres (partner routing: Partners only) | ✓ | ✓ | — | — |
| Tag spending with a cost centre (anyone who posts entries) | — | ✓ | ✓ | ✓ |

## API (all under `/api/v1`)

| Method & path | Permission | Purpose |
|---|---|---|
| `GET /loans/stats`, `GET /loans/approvals` | initiate / approve | Banner figures; everything waiting for a Partner |
| `GET/POST /loans/counterparties`, `GET/PATCH /loans/counterparties/:id` | initiate / approve | List (with position); add; statement; edit |
| `GET /loans?…`, `POST /loans`, `GET/PATCH /loans/:id` | initiate / approve | List; open (with a first movement); statement; purpose / ceiling |
| `POST /loans/:id/{approve,reject,close,reopen}` | approve / initiate | |
| `POST /loans/:id/movements` | initiate | Record — posted, or waiting |
| `POST /loans/movements/:id/{approve,reject,withdraw,reverse}` | approve / initiate | Both halves of an inter-unit movement together |
| `GET /loans/inter-unit`, `POST /loans/inter-unit/transfers` | initiate | Who owes whom; move money between units |
| `GET /loans/staff-advances`, `POST /loans/staff-advances/:id/{write-off,undo-write-off}` | view / approve | |
| `GET/POST /utilities/connections`, `GET/PATCH /utilities/connections/:id` | view / manage | |
| `GET/POST /utilities/bills`, `GET/PATCH/DELETE /utilities/bills/:id`, `POST /utilities/bills/:id/{post,unpost}` | view / manage | Live draft allocation |
| `GET/POST /cost-centres`, `GET/PATCH /cost-centres/:id`, `GET /cost-centres/:id/report` | pick / manage / report | Report: by category, month, unit, who bore it |
| `GET /journal-entries?costCentreId=`; `costCentreId` on `POST /journal-entries` | | |

## Screens

- **Finance → Loans**: banner (owed to the group, the group owes, between
  units, awaiting approval) and five tabs.
  - **Loans**: filtered by status and unit, each with its balance in words
    and its ceiling.
  - **Inter-unit**: who owes whom, *Transfer between units*.
  - **Staff advances**: advances outstanding or written off, *Write off*
    for a leaver whose settlement is paid.
  - **Awaiting approval**: each with why it waits; *Approve* / *Reject*,
    or *Withdraw*.
  - **Counterparties**: each one's position, *New counterparty*.
- **Loan** page:
  - the statement, every movement with the balance after it, its entry
    and status;
  - *Record movement*, where the verbs change with the loan's direction;
  - *Approve* / *Reject* / *Withdraw* / *Reverse*, *Edit* (purpose,
    ceiling), *Close* at zero, *Reopen*, *Print*.
- **Counterparty** page: position, loans, a combined statement, and an
  employee's salary advances.
- **Finance → Utilities**:
  - **Bills**: rate, what was charged to others, status.
  - **Connections**: sub-meters, unmetered split or weights, *New bill*,
    and an editor for all of it.
- **Bill** page: the Utility Cost Allocation Sheet.
  - Readings are editable in draft. Each sub-meter shows consumed, days
    read, units charged and amount; below them come the unmetered rows and
    the total.
  - *What each unit pays*, the ledger postings, *Post allocation* (with
    the payment, optionally), *Unpost*, *Delete*, previous / next cycle,
    *Print*.
- **Finance → Cost centres**: list with spending to date, *New* / *Edit*.
  The report page shows by category, by month × category, who bore it,
  and the entries.
- **New Entry** panel (money out, general journal): a *Cost centre* picker.
  A partner-charged centre explains the routing, and the preview shows the
  expense netted, the partner's capital debited and their profit reserve
  released. Loan accounts are no longer offered.
- **Entries**: a centre's code on tagged entries. The entry modal links to
  the centre and marks routed lines. Loan and utility entries point to
  their screens instead of *Reverse*.
- **Payroll**: advances can be *Written off* (filter, pill, employee Pay
  tab).

## Seed

`api:seed` adds:
- 5960 Loans & Advances Written Off, and every partner as a counterparty;
- cost centre **342 Media Office, charged to MIK**;
- **Zoo Green Meter** (paid by Multi Zoo, Utilities 5300, 30-day
  standard). Its sub-meters are:
  - Incubator and Brooder rooms → MBF;
  - Zoo workers and staff rooms → Zoo;
  - Panda Cafe → Panda Cafe;
  - Z & Co Store and Engineers Room → Z & Co;
  - Cafe Bonanza (retired).

  The unmetered rest goes 100% to the Zoo, the rule from Sep 2023;
- **Admin Block IESCO**, shared by the ten offices exactly as on the sheet.

## Deliberately deferred

- **Migrating the workbooks' balances.** The loans, floats and supplier
  balances come in at cutover (Part 09) as opening balances. The movement
  type exists; the scripted import doesn't.
- **Supplier payables** (`Payable & Receiveable`'s right-hand block) stay
  on Module 2's Accounts Payable. They can become ORGANISATION counterparty
  loans if the accountant prefers per-supplier statements.
- **Interest.** Nothing in the workbooks charges any.
- **Repayment schedules** for loans, beyond the salary-advance instalments
  Module 5 already runs.
- **Cost centres on loan movements** (e.g. MQK paying for 342 equipment
  personally). Tag the expense when it's entered instead.
- **PDF statements, the utility allocation sheet and the cost-centre
  report** are Module 8. Today's pages print from the browser.

## Where things live

```
apps/api/src/app/modules/loans/
  loans-math.ts (+ .spec)   running balance, principal / repaid / outstanding, the ceiling rule
  loans.service.ts          counterparties, loans, movements & approvals, inter-unit pairs, recharges, staff-advance write-offs
  loans-accounts.ts         loan accounts, 5960 write-off account, unit & partner counterparties
  loans.controller.ts, loans.module.ts, dto/, entities/
apps/api/src/app/modules/utilities/
  utility-math.ts (+ .spec) sub-metered and shared allocation + Sub Meters Details parity
  utilities.service.ts      connections, bills, post / unpost through the inter-unit accounts
  utilities.controller.ts, utilities.module.ts, dto/, entities/
apps/api/src/app/modules/cost-centres/
  cost-centre-math.ts (+ .spec)  the report rollup + 342 parity
  cost-centres.service.ts        setup, partner-routing guard, report
apps/api/src/app/modules/journal/journal.service.ts   routeCostCentre(); loan / utility posting guards
apps/api/src/database/seeds/loans-utilities.seed.ts
apps/frontend/src/
  app/(dashboard)/loans/{page.tsx, [id]/page.tsx, counterparties/[id]/page.tsx}
  app/(dashboard)/utilities/{page.tsx, bills/[id]/page.tsx}
  app/(dashboard)/cost-centres/{page.tsx, [id]/page.tsx}
  components/{loans,utilities,cost-centres}/   modals and the movement form
  lib/api/{loans,utilities,cost-centres}.ts
```

## Verification checklist

- [x] Unit tests: 39 new, 174 in total.
  - **Sub Meters Details parity, ten cycles** (Sep 2023 – Jun 2024):
    every room's charge within a paisa of the sheet, the remainder within
    a paisa, and the charges adding up to the bill exactly.
  - Sep 2023 consumption (297 · 231.7 … G47 1,032.9, G48 2,653.1) and
    rate (76.0396).
  - **Aug 2023** with mid-cycle meters: deserving units 672 / 118.85 /
    209.31 / 107.54 / 118.38, remainder 3,579.92 → 2,505.95 / 1,073.98.
    Priced at the true rate, and the sheet's 78.83 is shown to over-charge
    by 8.98.
  - **Admin Block**: all five bills split 55 / 45 to the paisa
    (47,999.05 / 39,271.95 …).
  - **Loan Dir to Mik**: A2 = 8,650,000; column H after each return;
    500,000 left.
  - **Qasim Khan**: every row of column E; 5,984,270 owed.
  - **342**: Transport & Food 26,750 · Development 496,000 · Assets
    549,500 = 1,072,250; reversals net out.
  - Guards: over-read sub-meters, end below start, splits ≠ 100%, the
    ceiling rule.
- [x] API run against the dev database: 134 of 134 checks passed. The run
  created, verified and then removed its own records (journal entries,
  accounts, counterparties, a test employee), leaving the database in its
  seeded state. It covered:
  - **Scope**: Branch Staff / Manager → 403 on loans and utilities;
    Partner reads utilities; staff can list cost centres but not report.
  - **Qasim Khan's loan, end to end**:
    - the Accountant opens it, and it waits;
    - a movement on the pending loan → 409;
    - the Partner approves and the first movement posts
      (Dr Development / Cr Loan from MQK, account ZOO-21xx);
    - with no ceiling an advance waits; the Accountant setting a ceiling
      → 403; the Partner sets 10,000,000 and approves;
    - the other 19 rows post at once, closing at 5,984,270, principal
      9,384,270, repaid 3,400,000, and the account's ledger agrees;
    - a repayment out of the Capital reserve releases the earmark;
    - a manual entry to the loan account → 400; reversing its entry from
      Entries → 400.
  - **Loan to MIK**:
    - the Partner's loan is approved on creation, with drawdowns to the
      8,650,000 ceiling;
    - one rupee over waits and is withdrawn;
    - the set-off against profit waits; approved, it posts Dr MIK capital
      / Cr Loan to MIK and releases MIK's Zoo profit reserve by 1,000,000;
    - cash returns give column H exactly, and 500,000 left;
    - wrong-way set-offs → 400; closing with a balance → 409.
  - **Write-off, close, reverse**:
    - a write-off waits and is rejected with a note;
    - repaid in full, then closed;
    - a movement on a closed loan → 409, and reversing one → 409;
    - reopened, the repayment reversed, and 10,000 outstanding again.
  - **Saad Khan's float**: given, then spent on company bills, each
    posting at once, with column E's balances (9,789 → 1,074). Writing
    the rest off waits.
  - **Inter-unit**:
    - the Accountant's 250,000 Zoo → Joy Land transfer waits, as one
      approval shown from → to;
    - the Accountant approving → 403; the Partner approves and both units
      post;
    - Joy Land owes 250,000; a Partner's 100,000 back posts at once;
    - same unit → 400; a direct movement on the pair → 400;
    - reversing one half reverses both.
  - **Utilities**:
    - the seeded connections load;
    - a bill waits for readings, then allocates live within a paisa of
      the sheet;
    - end < start → 400; Partner editing → 403; duplicate or overlapping
      cycle → 409;
    - posted with its payment out of the Utilities reserve: three
      recharge pairs;
    - MBF's P&L carries its share, the Zoo only its own, and MBF owes
      the Zoo;
    - reversing a recharge from Loans or Entries → 400;
    - unpost reverses all of it, and re-posting works;
    - the next cycle starts from last cycle's ends;
    - the Admin Block posts Z & Co's 47,999.05;
    - a future cycle can't post; a draft deletes;
    - a split ≠ 100% → 400; a removed sub-meter is retired.
  - **Cost centres**:
    - the Accountant can add a unit centre, but routing one to a partner
      or editing 342 → 403; a duplicate code → 409;
    - a 160,000 entry tagged 342 keeps the expense, routes it to MIK's
      capital, releases his Zoo profit reserve, and leaves Development
      netting to 0;
    - reserve + routing → 400; transfer / money-in tags → 400;
    - the report gives 171,000 by category, all MIK;
    - a reversal keeps the tags and nets the report to 11,000;
    - a unit centre only tags; filtering entries by centre works.
  - **Staff advance write-off**:
    - a test leaver's 50,000 advance: writing it off while they work
      there → 400, and by the Accountant → 403;
    - after exit but before the settlement → 400;
    - the settlement nets to 0 and closes as paid, and the rest is
      writable-off;
    - the Partner writes it off (Dr 5960 / Cr Staff Salary Advances);
    - payroll shows it written off; it can't be reversed from Entries;
    - it can be undone and written off again;
    - their counterparty statement shows it.
  - **Statements & stats**: MQK is owed 5,984,270, MIK owes 500,000, and
    the banner figures include both.
- [x] Frontend and API type-check. Lint is clean in both. In the browser,
  as the Accountant, then a Partner:
  - the loans hub, a loan statement and the utilities list rendered the
    API's figures;
  - a posted bill's allocation sheet matches Sep 2023;
  - the October 2023 readings, entered and saved on a draft bill,
    reproduce the sheet's figures;
  - the cost-centre list and report render;
  - the New Entry panel's cost centre shows the routing to MIK;
  - the Partner's approvals tab shows the write-off with its reason;
  - there were no console errors, and no horizontal scroll at phone
    width.
- [ ] Browser click-through by role: the Accountant opens a loan, a
  Partner approves it, a transfer between units, a bill posted and unposted,
  a 342 expense entered by Branch Staff. This needs a person to sign in.
- [ ] Phase 0 sign-off:
  - **the approval rule**: whether cash repayments and officer float
    spending should post without a Partner, and whether new loans should
    default to a ceiling;
  - which unit receives and pays the **Admin Block IESCO** bill (seeded
    as Multi Zoo), and which unit each sub-meter belongs to (Brooder /
    Incubator → MBF, Store / Engineers → Z & Co);
  - the unmetered split (100% Zoo since Sep 2023, not Aug 2023's 70 / 30);
  - the **typed 78.83 rate** in Aug 2023: the system uses the bill's own
    rate;
  - that 342's spending releases MIK's profit reserve, as a drawing does;
    and which of the two 342 totals (1,058,250 or 1,072,250) is right;
  - which personal ledgers (Saad Khan, Yousaf, Ismail Khan, Col Ibrahim,
    Top City) come across as counterparties, and at what opening balances.
