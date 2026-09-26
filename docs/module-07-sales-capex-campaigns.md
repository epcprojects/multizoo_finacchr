# Module 7 — Sales, Capex & Campaigns

**Status: ✅ backend complete and verified (41 new engine/parity unit tests, a 95-check API run against the dev database). Frontend built, type-checked, lint-clean, and every screen exercised in the browser against real data. Browser click-through by each role still pending (see checklist).**

Architecture plan references: Part 03 §9 (ticketing & retail sales, with
comparative rollups) and §11 (capex tracker & seasonal campaign P&L),
Part 05 (SalesRecord, CapexItem & CampaignLedger), Part 06 (M9, M11),
Part 08 (Sales & ticketing report incl. YoY; Capex register & campaign
P&L), Part 10 (roles: *"Enter daily sales / expenses for own unit —
Accountant, Branch Manager, Branch staff"*), Part 11 Phase 6, Fig. 11.
Sprint plan demo for this phase: *"Ticket entry rolling up into a live YoY
comparison."*

## What this module is

- **Sales & ticketing (M9)**: each unit's price list. Staff fill in a day
  item by item (Qty × Rate), or with the day's total where that's all the
  sheet keeps. Posting the day is one money-in entry, so the allocation
  engine splits it like any other income. The day × month grid, the
  category breakup, year on year and the Eid comparison are all live
  queries over the posted lines.
- **Capex register (M11)**: every capital purchase, investment to date,
  and, when its takings show on the price list, how far it is to paying
  for itself against its expected ROI window.
- **Campaigns (M11)**: a seasonal drive with its own P&L. Money raised for
  it, money spent on it, its balance and its budget, kept outside the
  unit's income and expenses until it's closed.

## What the workbooks actually do

**`sample income.xlsx`** (read cell by cell):

- `Ticket sales`:
  - A row per ticket type per day: Month, Date, Day, Ticket Type,
    Category, Description ("System"), Qty, Rate, `Total = H × G`.
  - The grid L4:X39: `SUMIFS` by typed date string, 31 rows × 12 months.
  - "Total Sales" is `SUM`; "MonthlyAvg Sale" is `M37/31`, the month's
    calendar days (`/28` for February).
  - "Yearly Avg Sale Per Day" is `U1/COUNTIF(M5:X35,">1")`, over the days
    that have sales.
  - The breakup Z4:AX40: `SUMIFS` of amount and qty per ticket type per
    month, 33 types.
  - Jan 2026: 35,514 on the 1st, 3,952,935 on the 2nd (623 @ 6,345, a
    typed total that happens to equal the product); 3,988,449 in all.
- `Cafe Sales`, `Joy Land`, `Jungle Joy (Gift shop)` keep only a day's
  total in the same grid. Averages are `C36/31` and `K1/COUNT(C4:N34)`.
  August's total row has no formula on any of them.

**`Sample cash flow.xlsx`**:

- `Eid Sales Comperison`:
  - Eid-ul-Fitr 2022–2024 and Eid-ul-Azha 2022–2023, day 1 to day 10.
    For each: income, adult footfall and kid footfall, then Total and
    "Avarage/Day".
  - Its quirks:
    - `F22` divides a 7-day 2024 by 10 (653,770.6), while the Panda Cafe
      column's `S22` uses `COUNT` (158,729.86).
    - `G30` says "44% more sales in 2024". That is (2024 − 2023) ÷ 2024;
      against 2023 it is +78.0%.
    - Panda Cafe's footfall columns copy the Zoo's.
    - Some footfalls are derived from revenue (`=93000/150`).
- `Dir Invst Zoo`:
  - Date, Amount, Purpose, "Roi Time Expct" (8 Months …), Nature;
    `F2 = SUM(B2:B1000)` = 5,966,000.
  - The last row ("Madam kiran", nature "Ismail", 27,000) looks like a
    personal payment rather than capex.
- `Ramazan 2023`:
  - Received C5:C10, total 735,500. Issued D13:D46, 865,563.
    `C3 = C2 − D2` = −130,063.
  - An itemised block F:H totals 865,562, 1 short of what was issued.
  - A budget, O7:O12: 30 days @ 25,000, plus ration, cash and gas =
    841,313.
  - Its "Net Remaining" O20 (355,813) misses the 250,000 received on
    20 Apr.
  - Column T is unrelated scratch figures.
- `Pricing` is an empty "Cost / Price" header.

## Design decisions

1. **A day's sheet, posted as one entry.**
   - `SalesDay` (one per unit per day) holds `SalesLine`s. Each line copies
     the item's name, category, income account and footfall, and keeps the
     rate it was sold at, so editing the price list never changes a past day.
   - The day is a draft until posted. Posting checks that the takings
     received into cash, bank and wallet equal the sales. It then posts
     **one money-in entry** (source `SALES`): Dr each receiving account /
     Cr each line's income account, memo "421 × Entry Ticket Adult @ 24.00".
   - **The allocation engine needs no change**: it reads income accounts,
     so a posted day is that day's income.
2. **Corrections go through the day.**
   - Unposting reverses the entry (dated today) and returns the day to
     draft, so the Allocation screen shows the day as *changed*.
   - It needs `transactions.reverse`, the Accountant's.
   - Reversing a sales entry from Entries is refused, and so is editing or
     deleting a posted day.
3. **Two kinds of item.** *Quantity × rate* (tickets, feed, rides, with an
   optional default rate) and *just the day's amount* (the cafe, Joy Land
   and gift-shop sheets).
4. **Footfall comes from the price list.** An item can count as an adult
   or a child through the gate (Entry Ticket Adult, School Kids Entry …).
   The Eid comparison's footfall is the quantity of those, never typed or
   derived from revenue.
5. **Averages.**
   - The grid's monthly average is the month's total over its calendar
     days, as the sheet does.
   - "Per day with sales" and the Eid "average/day" are over days that had
     sales. This follows `S22`/`S39` rather than `F22`'s fixed ÷10.
   - Rounding is half-up to the paisa, once.
6. **Events are data.** `SalesEvent` (name, days compared, and each year's
   first day). Eid moves every year, so each occurrence is recorded. The
   comparison shows day N across years, with totals, average/day, and the
   change on the year before (amount, %, adults, kids).
7. **Year on year** compares each month with the same month last year. While
   a year is running, "to date" compares 1 Jan–today with the same days
   last year.
8. **Capex purchases reach the ledger one of three ways.**
   - **Paid here**: Dr the chosen asset or expense account (default 5800
     Development & Capital Expenditure) / Cr cash, bank or wallet,
     optionally out of a reserve. Source `CAPEX`; removing the item
     reverses it, and its cost and date can't be edited.
   - **Linked** to an entry already on the ledger (e.g. a partner paid for
     it on their loan). An entry can be linked once, same unit, not
     reversed.
   - **Register only** (history). Nothing is posted.
9. **Payback.**
   - The ROI window becomes a date: purchase + N months.
   - Link price-list items (a machine's rides) and the register counts
     their takings since purchase. Its state is *paid back* (with the day),
     *on track* (at least the straight-line share for the time gone),
     *behind*, *overdue* (past the date), *no target*, or *not tracked*.
10. **Campaigns run through their own fund.**
    - Each campaign gets a liability account in its host unit ("Campaign —
      Ramazan 2023", payable range, `campaignId` set).
    - Raised: Dr cash / Cr fund. Spent: Dr fund / Cr cash. Source
      `CAMPAIGNS`, and the fund can't be posted to from anywhere else.
    - The fund's balance *is* the campaign's balance (C3). A donation never
      becomes unit income for the waterfall to split, and the drive's
      spending never lands in the unit's expenses.
    - **Closing** charges a shortfall to a chosen expense (default
      Miscellaneous), or takes a surplus into income (default Other
      Income). It is one entry, and the fund ends at zero. Reopening
      reverses it.
    - A mistaken receipt or payment is reversed from the campaign.
11. **Qualifying sales for commission pools** (Module 5) can now come from
    the records. The pool form has *Use this month's total* for a sales
    category (e.g. School). It fills in the figure and a basis saying where
    it came from.

## Data model

| Entity | Key columns | Notes |
|---|---|---|
| `SalesItem` | `businessUnitId`, `name` (unique per unit), `category`, `incomeAccountId`, `pricing` (PER_UNIT / AMOUNT), `defaultRate`, `footfall` (NONE / ADULT / KID), `sortOrder` | `BaseEntity` — deactivated, never deleted |
| `SalesDay` | `businessUnitId` + `salesDate` (unique), `status` (DRAFT / POSTED), `total`, `receipts` jsonb (`accountId`, `amount`), `note`, `journalEntryId`, posted by/at | |
| `SalesLine` | `dayId`, `lineNo`, `itemId`, copied `itemName` / `category` / `incomeAccountId` / `footfall`, `quantity` (null = amount-only), `rate`, `amount` | `CHECK amount ≥ 0` |
| `SalesEvent` | `name` (unique), `days`, `occurrences` jsonb (`year`, `startDate`), `notes` | |
| `CapexItem` | `businessUnitId`, `purchaseDate`, `name`, `nature`, `amount`, `paybackMonths`, `funding` (PAID_HERE / LINKED_ENTRY / NOT_RECORDED), `accountId`, `journalEntryId`, `earningItemIds` jsonb, `status` (ACTIVE / RETIRED), `retiredOn`, `note` | `BaseEntity` — removing soft-deletes |
| `Campaign` | `name` (unique), `businessUnitId`, `startDate`, `endDate`, `status` (OPEN / CLOSED), `budget` jsonb, `fundAccountId`, `notes`, `closeAccountId`, `closingEntryId`, `closedOn`, `closedBy` | |
| `CampaignEntry` | `campaignId`, `entryDate`, `type` (INCOME / EXPENSE), `category`, `description`, `amount`, `accountId`, `status` (POSTED / REVERSED), `journalEntryId`, `reversalEntryId` | |
| `Account` (+1) | `campaignId` | A campaign's fund |
| Journal | sources `SALES`, `CAPEX`, `CAMPAIGNS` | Undone only from their screens |

## Permissions

Two new claims, both the Accountant's.

| Permission | Partner | Accountant | Branch Manager | Branch Staff |
|---|:-:|:-:|:-:|:-:|
| `transactions.create_own_unit`: enter, save, post a day (own units) | — | ✓ | ✓ | ✓ |
| `transactions.reverse`: unpost a day | — | ✓ | — | — |
| `sales.manage`: price lists, peak events | — | ✓ | — | — |
| `ledger.view` / `pnl.view_consolidated`: the grid, breakup, YoY, Eid comparison (own units unless `units.access_all`) | ✓ | ✓ | ✓ | — |
| `capex.manage`: the capex register, campaigns and their money | — | ✓ | — | — |
| `pnl.view_consolidated`: read the register and campaigns | ✓ | ✓ | — | — |
| Qualifying sales for a pool (`ledger.view`, `pnl.view_consolidated` or `payroll.run`) | ✓ | ✓ | ✓ | — |

## API (all under `/api/v1`)

| Method & path | Permission | Purpose |
|---|---|---|
| `GET/POST /sales/items`, `PATCH /sales/items/:id` | view / `sales.manage` | Price list |
| `GET /sales/stats` | view | Today, month, year, year-to-date vs last year, drafts |
| `GET /sales/days?businessUnitId&from&to&status`, `POST /sales/days` | view / enter | List; open (or return) a unit's day |
| `GET/PATCH/DELETE /sales/days/:id` | view / enter | The sheet; save lines + receipts; delete a draft |
| `POST /sales/days/:id/post`, `POST /sales/days/:id/unpost` | enter / `transactions.reverse` | |
| `GET /sales/reports/{grid,breakup,year-over-year}?year&businessUnitId` | report | The rollups |
| `GET /sales/reports/compare?eventId&businessUnitId` | report | A peak event across years |
| `GET /sales/reports/total?businessUnitId&from&to&category` | report or `payroll.run` | Qualifying sales |
| `GET/POST /sales/events`, `PATCH /sales/events/:id` | report / `sales.manage` | |
| `GET/POST /capex`, `GET/PATCH/DELETE /capex/:id`, `POST /capex/:id/{retire,reinstate}` | view / `capex.manage` | Register with summary and payback |
| `GET/POST /campaigns`, `GET/PATCH /campaigns/:id` | view / `capex.manage` | List with balances; detail with the statement |
| `POST /campaigns/:id/entries`, `POST /campaigns/:id/entries/:entryId/reverse` | `capex.manage` | Money raised / spent |
| `POST /campaigns/:id/{close,reopen}` | `capex.manage` | |

## Screens

- **Finance → Sales**: a banner (today, this month, this year, year to
  date vs last year), *Enter sales* and six tabs:
  - **Days**: a month's days per unit: lines, adults, kids, sales, status,
    entry; the month's posted total.
  - **Daily grid**: the sheet's 31 × 12 grid with total sales, monthly
    average, grand total and average per day with sales. It can show one
    unit or every unit together.
  - **By item**: amount and count per item per month, in price-list order.
  - **Year on year**: month by month against last year, with % and the
    year to date.
  - **Eid & events**: day 1–N of an event, income / adults / kids for each
    year, then totals, average/day and the change on the year before.
    *Edit dates* and *New event*.
  - **Price list**: a unit's items, their income account, default rate and
    visitor flag. *New item* and *Edit*.
- **Sales day** (`/sales/days/:id`):
  - Every active item, with Qty and Rate (the default shown as a
    placeholder) and a live total.
  - Where the takings went: *All into Cash in Hand*, or split across
    accounts.
  - *Save draft*, *Post to the ledger*, *Delete draft*, *Unpost to
    correct*, previous / next day, and the entry.
- **Finance → Capex**:
  - A banner (total investment, this year, paid back, behind or overdue).
  - The register, each item with its payback date, earned-back progress
    and state, and its ledger link.
  - *Record a purchase* (pay now / already on the ledger / register only),
    *Edit*, *Retire*, *Reinstate*, *Remove*.
  - Totals by nature and by year.
- **Finance → Campaigns**: the list with raised, spent, balance and budget.
  A campaign's page shows:
  - total income, expenses, balance and budget, still to raise, budget
    left;
  - raised from / spent on by category, and the budget lines;
  - every receipt and payment with the running balance;
  - *Money raised*, *Money spent*, *Reverse*, *Edit*, *Close* (shortfall to
    an expense / surplus to income) and *Reopen*.
- **Payroll → New commission pool**: *Or take it from the sales records*,
  a category plus *Use this month's total*.
- **Entries**: sales, capex and campaign entries point to their screens
  instead of *Reverse*. The New Entry panel and loan movements no longer
  offer campaign funds.
- **Roles**: the two new claims are in the permission editor.

## Seed

`api:seed` adds:

- **Multi Zoo's price list**: the 33 ticket types of `Ticket sales`,
  categorised as Entry, Membership, School, Deals, Animal feed, Rides,
  Rentals and Fees.
  - Entry and school tickets and animal feed are credited to 4100 Ticket
    Sales, rides to 4400, rentals and fees to 4900.
  - Default rates are seeded only where they're known: adult 290 and kids
    190 (the Eid sheet's 2024 rates), and the priced names (Jumbo 370,
    School 180 / 450 / 150).
  - Adult and child entry tickets count footfall.
- **One amount-only item** each for Panda Cafe, Joy Land, the gift shop,
  Pets Accessories and MBF.
- **Eid-ul-Fitr and Eid-ul-Azha**, 10 days each, with Pakistan's first
  day of Eid for 2022–2026.
- **Outside production only**: the `Dir Invst Zoo` log as nine
  register-only capex items (5,966,000). The "Madam kiran / Ismail" row is
  flagged in its note.

## Deliberately deferred

- **Importing sales history** (the income sheets, the Eid figures for
  2022–2024) is cutover work (Part 09). Past years' Eid columns stay empty
  until then. The sales-day model takes them as posted days.
- **The Ramazan 2023 campaign itself.** It would post ledger entries in
  2023, so it comes in with the historical import. Its figures are in the
  parity suite.
- **Linking sales to a till or ticketing system.** Days are keyed in. The
  sheet's "System" description suggests an export exists, which could be
  imported per day later.
- **Depreciation** of capitalised purchases. Nothing in the workbooks
  depreciates. Capex is charged to 5800 by default, or to a fixed-asset
  account the Accountant adds.
- **Cost of sales / stock** for the cafe and shops. The sheets record
  takings only.
- **PDF sales report, capex register and campaign P&L** are Module 8.
  Today's pages print from the browser.

## Where things live

```
apps/api/src/app/modules/sales/
  sales-math.ts (+ .spec)   Qty × Rate, the day × month grid, the breakup, event comparison, YoY + parity
  sales.service.ts          price list, days (open / save / post / unpost), rollups, events, qualifying sales
  sales.controller.ts, sales.module.ts, dto/, entities/
apps/api/src/app/modules/capex/
  capex-math.ts (+ .spec)   register summary, payback, campaign statement + Dir Invst Zoo / Ramazan parity
  capex.service.ts          the register: paid here / linked / register only, retire, remove
  campaigns.service.ts      campaigns, their fund, entries, close / reopen
  capex.controller.ts (CapexController, CampaignsController), capex.module.ts, dto/, entities/
apps/api/src/app/modules/journal/journal.service.ts   SALES / CAPEX / CAMPAIGNS reversal guards; campaign-fund guard
apps/api/src/database/seeds/sales-capex.seed.ts
apps/frontend/src/
  app/(dashboard)/sales/{page.tsx, days/[id]/page.tsx}
  app/(dashboard)/capex/page.tsx
  app/(dashboard)/campaigns/{page.tsx, [id]/page.tsx}
  components/{sales,capex,campaigns}/   price-list, event, purchase and campaign modals
  components/payroll/BonusPoolModal.tsx  "Use this month's total"
  lib/api/{sales,capex}.ts
```

## Verification checklist

- [x] Unit tests: 41 new, 215 in total.
  - **Ticket sales parity**:
    - lines `H × G` (10,104, 3,952,935, 3,234, 2,156, 20,020);
    - M5 35,514, M37 3,988,449, M38 128,659.65 (÷31), S39 1,994,224.50
      (÷ days with sales);
    - February ÷28.
  - **Cafe / Joy Land / Jungle Joy**: totals 661,145 / 251,761 / 154,817;
    averages 21,327.26 / 8,121.32 / 4,994.10; per sales day 220,381.67 /
    83,920.33 / 77,408.50.
  - **Category breakup**: Entry Ticket Adult 3,963,039 / 1,044, Birds Feed
    20,020 / 130, total 3,988,449 / 1,209.
  - **Eid Sales Comperison**:
    - Fitr totals 3,209,240 / 3,672,286 / 6,537,706; adults 10,689 /
      10,223 / 13,721; kids 6,722 / 4,514 / 8,147; averages 320,924 /
      367,228.60;
    - 2024 over its 7 days (933,958; the sheet's F22 ÷10 is noted);
      +3,498 adults, +78.0%;
    - Panda Cafe S22 158,729.86; Azha 2,132,210 → 2,177,130, +44,920.
  - **Dir Invst Zoo**: 5,966,000; Entertainment 4,119,000, Food 1,220,000,
    Service 600,000, "Ismail" 27,000; ROI text to months.
  - **Payback**: due dates, the straight line, paid-back day, overdue,
    pre-purchase takings excluded.
  - **Ramazan 2023**: 735,500 / 865,563 / −130,063, the running balance,
    budget 841,313, still to raise 105,813 (O20's stale figure noted).
  - Year on year and year to date; rounding and percentages; the takings =
    sales check.
- [x] API run against the dev database: 95 of 95 checks passed. The run
  created, verified and then removed its own records, leaving the database
  in its seeded state. It covered:
  - **Price list & scope**:
    - the 33 seeded types and their accounts;
    - Branch Staff see only their unit (403 on the Zoo's list, on
      reports, on adding items);
    - a Partner can't enter a day;
    - a duplicate name → 409; an expense account as income → 400.
  - **Ticket sales, January 2026**:
    - 1 Jan's four lines = 35,514;
    - takings ≠ sales → 400;
    - a rate-less item with no rate, another unit's item, and another
      unit's cash → 400;
    - posted as one money-in entry from SALES, Dr cash / Cr Ticket Sales ×4
      with the sheet's memo;
    - editing, deleting or reversing from Entries → 409 / 409 / 400;
    - 2 Jan's 3,952,935 split between cash and Easypaisa;
    - the grid, breakup and days list match the sheet (M5, M6, M37, M38,
      S39, AA/AB).
  - **Unpost & repost**:
    - Branch Staff → 403;
    - the Accountant unposts: reversed, back to draft, off the grid;
    - with no rate the price list's 290 is used (122,090); reposted as a
      new entry.
  - **Branch Staff at the Cafe**:
    - posts a 21,327.25 day total, and the allocation engine's day income
      rises by exactly that;
    - the Branch Manager's all-units grid shows only the Cafe; the Zoo →
      403.
  - **Eid & YoY**:
    - Eid-ul-Fitr 2025 vs 2026: 1,155,000 → 1,814,500, +57.1%, +1,800
      adults, 604,833.33 a day;
    - March year on year +371.3%, April 2025's 770,000 against nothing;
    - March school trips = 4,500 for a commission pool.
  - **Events**: Partner → 403; add; duplicate name → 409; a year twice or a
    date outside its year → 400.
  - **Capex**:
    - the seeded log totals 5,966,000;
    - paid here from Zoo cash out of the Capital reserve (Dr 5800 / Cr
      cash, reserve released);
    - payback from Jumbo tickets (3,234, 1.5%, overdue), then re-targeted
      to 12 months (behind);
    - reversing from Entries → 400; changing a paid-here cost → 409;
    - linking once only (409), same unit only (400);
    - retire / reinstate; removing reverses a paid-here payment and leaves
      a linked entry alone.
  - **Campaign**:
    - its own fund account;
    - six receipts and three payments give 735,500 / 865,563 / −130,063
      and a budget of 841,313 with 105,813 still to raise;
    - the Zoo's income over those weeks is unchanged;
    - before the start → 400; a manual entry to the fund → 400; reversing
      from Entries → 400;
    - reversed from the campaign (−64,500), then re-recorded;
    - closing a shortfall without an account, or into income → 400;
    - closed to Miscellaneous (Dr 130,063 / Cr fund, fund at zero);
      recording when closed → 409;
    - reopened (closing reversed);
    - the Partner reads it but can't record; the Branch Manager → 403.
  - The trial balance still balances.
- [x] Frontend and API type-check, and lint is clean in both. In the
  browser, as the Accountant:
  - the sales banner, days list, the Zoo's daily grid (1–2 Jan, the Eid
    days in March, totals and averages) and a posted day's sheet;
  - a new day opened with *Enter sales*: 100 adults + 50 kids at the
    default rates = 38,500, *All into Cash in Hand*, posted as a new
    entry;
  - the Eid-ul-Fitr comparison; the capex register and its *Record a
    purchase* form; a campaign's P&L;
  - no console errors, and no horizontal page scroll at phone width.
- [ ] Browser click-through by role: Branch Staff enter and post a day, the
  Accountant unposts and corrects it, a Partner reads the reports, the
  register and a campaign. This needs a person to sign in.
- [ ] Phase 0 sign-off:
  - each ticket type's **income account** and **default rate**, and which
    count as visitors (Deals and Jumbo tickets include entry but aren't
    counted);
  - the **Eid dates** seeded for 2022–2026;
  - the **average/day** rule (days with sales, not ÷10);
  - whether capex should be **capitalised** to a fixed-asset account
    rather than 5800;
  - the "Madam kiran / Ismail" row — capex, or MIK's loan;
  - where a campaign's **shortfall** is charged (seeded default:
    Miscellaneous).
