# Module 8 — PDF Reporting Suite

**Status: ✅ backend complete and verified (20 new engine/parity unit tests, 235 in all; a 101-check API run against the dev database). Frontend built, type-checked, lint-clean, and exercised in the browser as the Accountant, a Branch Manager and Branch Staff. Report layout sign-off by the partners still pending (see checklist).**

Architecture plan references: Part 03 §3 (partner profit & drawings) and
§5 (categorised expense rollups), Part 04 ("PDF engine", "Jobs"), Part 05
(ReportArchive), Part 06 (M12 Reporting & PDF Suite), Part 08 (the report
table), Part 10 ("Generate & download PDF reports — Partner ✓, Accountant ✓,
Branch Manager own unit only, Branch staff own unit only"), Part 11 Phase 7.
Sprint plan demo for this phase: *"Every report in the catalogue, generated
on demand."* Client input: *"Report layout sign-off."*

## What this module is

- **A report catalogue**: every report in Part 08's table, plus the HR
  reports from Part 07 and the cost-centre report Module 6 deferred — 18 in
  all. Each is built from the same services as its screen, so the PDF and
  the page always agree.
- **Profit & loss, the category rollup, the expense report and the partner
  statement**, which had no screen before. Modules 2 and 3 deferred them
  here.
- **An archive**: every PDF ever produced, kept as generated, searchable by
  report, unit, period and text, with its headline figures.
- **Schedules**: reports produced on a timetable, with the period worked out
  on the day (nightly cash position, weekly expenses, monthly P&L seeded).
- **PDF buttons** on the record pages (payroll run, payslip, settlement,
  commission pool, utility bill, campaign, counterparty, cost centre) and the
  capex, sales, attendance and dashboard screens.

## What the workbooks actually do

**`Sample daily exp.xlsx` → `MULTIZOO!AB4:BF28`** (read cell by cell):

- AB4:AP19, "Multi ZOO EXPENSES 2026": `SUMIFS` of the day's expense rows
  by account title, sub-title and month name — thirteen headings (Animal's
  Feed, Medicine, Maintenence, Development, Assets, Transport, Utilities,
  Salaries, Stationary, Kitchen, Bonus & Relief, Birds Aviary, Village Zoo).
  - The month is matched by typed name, so `"MArch"` and `"*March*"` sit
    beside `"March"`; Feed is Feed & Medicine less `"medicine"`.
- AS8:BF28, "Profit and Loss Statement of MULTI ZOO for the Year 2026":
  - AT11 TOTAL SALES = `IMPORTRANGE` of the Ticket sales sheet's M37:X37.
  - AT12:AT24 each heading (`=AC8` …); AT25 TOTAL EXPENSES `=SUM(AT12:AT24)`.
  - AT26 NET EFFECT `=AT11-AT25`; AT27 MIK PROFIT 70% `=AT26*70/100`;
    AT28 MQK PROFIT 30% `=AT26*30/100`.
  - January: 14,739,810 − 71,230 = 14,668,580 → 10,268,006 / 4,400,574.
    Year: BF11 98,356,348.5, BF26 98,285,118.5, BF27 68,799,582.95,
    BF28 29,485,535.55.

**`Sample cash flow.xlsx`**:

- `Profit and loss of MQK & MIK`: a Debit / Credit / Balance ledger per
  partner (K:P, S:X, AA:AF), each row tagged with its unit ("Jungle Joy")
  and month ("May-2026") — bills charged to their profit, salary advances,
  cash transferred. B3:G60 is an older monthly block (`=E3*25/100`) that's
  now zeros.
- `Profit & Loss Statement`: one block per partner, a pair of columns per
  unit — Total Profit (an `IMPORTRANGE` of that unit's row 27/28 or 24) and
  Total Withdraw (`SUMIFS` over their ledger by unit and month).
  - Row 16 is the year, row 17 `=B16-C16` the balance.
  - Haider, Jungle Joy: V4:V15 one third of the gift shop's monthly net
    (56,551.33333 …); W8 2,477 (1,223 + 1,254), W9 154, W10 5,426;
    V16 127,367.3333, W16 8,057, V17 119,310.3333.
  - Its quirks: month keys are typed three ways ("Jan-2026", "January-2026",
    "Febraury-2026"), so C4:C15 all read 0; Joy Land's imports are blank.
- `Weekly Report`, `Weekly Report Closing`, `Daily Report`
  (`Sample daily exp.xlsx`): the day's and week's spending by account
  title, and cash in hand, typed up for the partners.

## Design decisions

1. **pdfmake, not a headless browser.** The plan (Part 04) proposed
   HTML rendered to PDF by a headless browser. Every report here is
   tabular, and pdfmake does what they need — header rows repeated on each
   page, page breaks, landscape A4, a common header and footer — in pure
   JavaScript, with no Chromium to install, patch or feed memory on the
   server. Roboto ships with it. It fetches nothing: URL access is refused
   and file access is limited to the fonts.
2. **Reports read the screens' services.** Each builder calls the service
   behind its page (payroll, settlements, utilities, sales, capex, loans …),
   so a report can never disagree with the screen, and the unit scoping and
   record checks those services already do apply unchanged.
3. **Who can generate what.**
   - `reports.generate` (Partner, Accountant) or `reports.generate_own_unit`
     (Branch Manager, Branch Staff) opens the Report centre.
   - Each report also needs one of the permissions its screen needs — the
     payroll register needs `payroll.run` or `employee.view`, the P&L
     `pnl.view_consolidated`, and so on. A Branch Manager gets six reports
     (cash position, expenses, cost centre, attendance, disciplinary,
     sales); Branch Staff get the expense report for their unit.
   - Own-unit users are held to their units by the same services: another
     unit is a 403, and "all units" means theirs.
   - The partner statement needs `pnl.view_consolidated`, or
     `pnl.view_own_share` and to be that partner's login.
4. **Profit & loss is income and expense accounts only.**
   - Income is credit − debit, expenses debit − credit, per line's unit. A
     refund or a reversal nets off.
   - Reserve earmarks, loans, drawings and campaign funds are balance-sheet
     movements and never appear. Spending a cost centre charges to a partner
     is taken off the paying unit (Module 6's cross-charge credits it back).
   - Headings are top-level accounts; sub-accounts show under them — the
     workbook's account title and sub-title, without its wildcard matching.
5. **Partner shares come from the allocation rule.**
   - A partner's share of a unit's net is their weight over the sum of every
     partner's weight in the unit's rule in force at the month's end — MIK
     70 / MQK 30 on the Zoo, 1∶1∶1 on Jungle Joys. No new rule data.
   - Rounded half away from zero to the paisa, per partner (the sheet's
     `=AT26*70/100`).
   - This is the Part 03 §3 statement, computed at report time. It posts
     nothing; the daily waterfall's profit reserves are shown beside it for
     reference.
6. **The partner statement** takes "drawn" as the net debit to the partner's
   capital & current account in each unit, opening balances aside: cash
   drawings, bills charged to their profit, set-offs. Balance = share of
   profit − drawn, per unit and in total (the sheet's row 17).
7. **Headcount** is by each person's current unit and designation (there's
   no transfer history), on the books at month end; payroll cost is from
   finalised payslips only, and units without a finalised run are named.
8. **The archive keeps the PDF.**
   - `report_archive` (the listing: report, title, params, units covered,
     period, headline figures, file name, size, SHA-256, who or which
     schedule) and `report_files` (the bytes) — in the database, so the daily
     backup covers them and no file store needs configuring.
   - Rows are never edited or deleted; a corrected figure is a new report.
   - `unitIds` is the units a report covers, empty for the whole group.
     Someone without every-unit access sees a report only when all its units
     are theirs, and only reports they could generate.
9. **Schedules.**
   - A schedule has a report, a cadence (daily / weekly on a weekday /
     monthly on day 1–28), a time in Pakistan time, a relative period
     (today, yesterday, last week Mon–Sun, the last 7 days, this month so
     far, last month, this month, this year, last year — whichever fit the
     report), and fixed params (a unit, a partner).
   - A minute ticker generates what's due. It claims each run by moving
     `nextRunAt` on first, so two API processes never produce the same
     report twice, and a missed run (server down) runs once, not per miss.
   - Scheduled reports run with the whole group in view, so managing them
     needs `reports.generate` and the report's data permission. Record
     reports (a payroll run, a bill) can't be scheduled.
   - A failed run is recorded with its reason and shown on the screen.
10. **PDF buttons** appear only for reports in the viewer's own catalogue,
    so nobody sees a button that would give them a 403.

## Data model

| Entity | Key columns | Notes |
|---|---|---|
| `ReportArchive` | `reportKey`, `title`, `subtitle`, `params` jsonb, `unitIds` uuid[], `periodFrom`, `periodTo`, `highlights` jsonb, `fileName`, `sizeBytes`, `sha256`, `generatedBy`, `scheduleId`, `createdAt` | Never edited or deleted |
| `ReportFile` | `archiveId` (PK), `content` bytea | The PDF, one per archive row |
| `ReportSchedule` | `name`, `reportKey`, `cadence` (DAILY / WEEKLY / MONTHLY), `runAt` (HH:MM PKT), `weekday`, `dayOfMonth`, `period`, `params` jsonb, `nextRunAt`, `lastRunAt`, `lastStatus` (OK / FAILED), `lastError`, `lastArchiveId` | `BaseEntity` — removing soft-deletes |

## The catalogue

| Report | Period | Needs (any of) | Page |
|---|---|---|---|
| Daily cash position | a day | `ledger.view` | portrait |
| Expense report by category | from–to | `ledger.view`, `transactions.create_own_unit` | portrait |
| Monthly category rollup | a year | `pnl.view_consolidated` | landscape |
| Profit & loss | from–to | `pnl.view_consolidated` | landscape |
| Partner profit & drawings statement | a year, a partner | `pnl.view_consolidated`, `pnl.view_own_share` | portrait |
| Loan & payable/receivable statement | a counterparty, or all | `loans.initiate`, `loans.approve` | portrait |
| Cost-centre report | a centre, from–to | `ledger.view`, `pnl.view_consolidated` | portrait |
| Payroll register | a run | `payroll.run`, `employee.view` | landscape |
| Payslips | a run (or one person) | `payroll.run`, `employee.view` | portrait, a page each |
| Bonus / incentive calculation sheet | a pool | `payroll.run`, `employee.view` | portrait |
| Attendance & leave summary | a month, a unit | HR viewers | landscape |
| Headcount & payroll cost | a month | `payroll.run`, `employee.view` | portrait |
| Disciplinary / fine register | from–to | HR viewers | landscape |
| Full & final settlement statement | a settlement | `payroll.run`, `employee.view` | portrait, signature lines |
| Utility bill allocation sheet | a bill | `utilities.manage`, `pnl.view_consolidated` | portrait |
| Sales & ticketing report | a year (+ an event) | `ledger.view`, `pnl.view_consolidated` | landscape |
| Capex register | as it stands | `capex.manage`, `pnl.view_consolidated` | landscape |
| Campaign P&L | a campaign | `capex.manage`, `pnl.view_consolidated` | portrait |

## API (all under `/api/v1`)

| Method & path | Permission | Purpose |
|---|---|---|
| `GET /reports/catalogue` | `reports.generate` or `reports.generate_own_unit` | The reports this caller can generate, with params and schedulable periods |
| `POST /reports/generate` `{ reportKey, params }` | same, plus the report's data permission | Build, render, archive; returns the archive entry |
| `GET /reports/archive?reportKey&businessUnitId&from&to&search&page&limit` | same | The archive, scoped to the caller |
| `GET /reports/archive/:id/file[?download=1]` | same | The PDF, inline or as an attachment |
| `GET/POST /reports/schedules`, `PATCH/DELETE /reports/schedules/:id` | `reports.generate` | Schedules |
| `POST /reports/schedules/:id/run` | `reports.generate` | Run one now (the next timed run is unaffected) |

## Screens

- **Reports** (side rail, under Dashboard), with a banner (reports you can
  run, in the archive, scheduled, last run failed) and three tabs:
  - **Generate**: the catalogue by Finance / HR & payroll / Operations, each
    with its cadence and audience. *Generate PDF* asks for the report's
    params (a unit, a month, a payroll run, a partner …), opens the PDF in a
    new tab and lists it under *Generated just now*. Someone with one unit
    has it picked for them.
  - **Archive**: every PDF with what it covers, its headline figures and who
    or which schedule made it; filter by report, unit, period and text;
    *Open* and *Download*.
  - **Schedules** (`reports.generate`): each schedule's timing, period, next
    and last run (with *Open the PDF*, or the reason it failed); *New
    schedule*, *Edit*, *Run now*, *Turn off / on*, *Remove*.
- **PDF buttons**: payroll run (*Register PDF*, *Payslips PDF*), payslip,
  settlement, commission pool, utility bill, campaign (*P&L PDF*),
  counterparty (*Statement PDF*), cost centre, capex (*Register PDF*), sales
  (*Sales 2026 PDF* on the report tabs), attendance (*Summary PDF* on the
  register) and the dashboard's cash position.

## Seed

`api:seed` adds three schedules, by name and only once (a re-seed never
overwrites changes made on the screen):

- **Nightly cash position** — daily at 23:30, the day it runs.
- **Weekly expense report** — Mondays at 07:00, last week (Mon–Sun).
- **Monthly profit & loss** — the 1st at 07:00, last month.

## Deliberately deferred

- **Emailing reports** (to a partner, on a schedule). The archive is where
  they land for now; SendGrid is already wired for invites and supports
  attachments.
- **A weekly attendance summary.** Attendance is summarised by month (the
  register's unit); a mid-month run covers the month so far.
- **Employees fetching their own payslips.** Most staff have no login; the
  Accountant prints or shares them.
- **Headcount by unit history.** Employees carry their current unit only.
- **Archive retention and pruning.** Nothing is deleted; at roughly one
  nightly cash position a day the archive grows by tens of MB a year.
- **The report look.** Every layout is built and working; the partners'
  sign-off (Sprint plan, Phase 7) may change wording, columns and order.

## Where things live

```
apps/api/src/app/modules/reports/
  report-math.ts (+ .spec)      P&L by heading × column, partner shares, the partner statement + MULTIZOO / Haider parity
  report-periods.ts (+ .spec)   relative periods, schedule timing in Pakistan time
  report-catalogue.ts           the 18 reports: params, period, permissions, orientation
  financial-reports.service.ts  P&L movements, expense lines, partner statement, headcount
  reports.service.ts            permission check, params, build → render → archive; archive listing and files
  schedules.service.ts          schedules and the minute ticker
  pdf/pdf-kit.ts                pdfmake setup, fonts, header / footer, tables, figures, money and dates
  builders/{finance,hr,operations}.builders.ts   one builder per report
  reports.controller.ts, reports.module.ts, dto/, entities/
apps/api/src/database/seeds/reports.seed.ts
apps/frontend/src/
  app/(dashboard)/reports/page.tsx
  components/reports/{ReportParamsForm, ReportModals, PdfButton}.tsx
  lib/api/reports.ts
```

`PDF_FONTS_DIR` overrides where the fonts are found (default:
`node_modules/pdfmake/fonts/Roboto`, located from the working directory).

## Verification checklist

- [x] Unit tests: 20 new, 235 in total.
  - **MULTIZOO P&L block**: TOTAL SALES BF11 98,356,348.50, January AT25
    71,230, AT26 14,668,580, BF26 98,285,118.50; MIK 70% AT27 10,268,006,
    AU27 6,325,494, BF27 68,799,582.95; MQK BF28 29,485,535.55.
  - **Haider's statement**: V4:V12 month by month (56,551.33, −49,045.67,
    −17,136.33 …), W8/W9/W10 2,477 / 154 / 5,426, W16 8,057, V16 127,367.33,
    V17 119,310.33 — to the paisa.
  - Headings and sub-accounts, refunds netting off, parts to shares (1∶1∶1,
    a partner in two tranches), losses shared, a unit drawn on without a
    share.
  - Periods: last week from a Monday, Saturday and Sunday, last month across
    a year end and a leap February, schedule times in PKT across midnight
    UTC and a year end.
- [x] API run against the dev database: 101 of 101 checks passed. The run
  created, verified and then removed its own records, leaving the database
  in its seeded state. It covered:
  - **Catalogue & access**:
    - Accountant and Partner 18 reports, Branch Manager 6, Branch Staff 1;
    - Branch Staff → P&L 403, the Zoo's expenses 403, their own → CAFE only,
      subtitled "CAFE";
    - Branch Manager → the Zoo's attendance 403, payroll register 403,
      schedules 403; their cash position covers CAFE only.
  - **Params**: unknown report 404; a missing date, 2026-02-30, from after
    to, more than a year, a param the report doesn't take, month 2026-13, a
    bad id, a year not started → 400.
  - **Figures** (the workbook's January and February posted to the Zoo, and
    a 50,000 MIK drawing):
    - January 14,739,810 / 71,230 / 14,668,580; consolidated Jan–Feb
      23,705,000; the category rollup's year 23,705,000; January's expenses
      71,230 in one line;
    - MIK's share up 16,593,500 (AT27 + AU27), drawn up 50,000, balance up
      16,543,500;
    - the Zoo's money on hand at 28 Feb up 23,655,000, money in that day
      9,036,420.
  - **Records**: a draft payroll run's register (people and net = the run)
    and payslips (all, and one person's); a commission pool FLOOR(451,000 ×
    5%) = 22,550; headcount = the employee master; attendance for the
    Manager's own unit; a leaver's settlement net = the settlement; a shared
    utility bill of 100,000; a campaign raised 64,500 with 685,500 still to
    raise, and the donation not in the Zoo's March income; capex total =
    the register; sales with Eid-ul-Fitr; a cost centre; the loans summary =
    loan stats; a counterparty's statement.
  - **Archive**: the Accountant sees everyone's; the Manager only CAFE
    reports they could generate; a group report's PDF → 404 for them; Staff
    their expense report; filters and search; the file is a PDF whose
    SHA-256 and size match; inline by default, `?download=1` an attachment;
    no delete route.
  - **Schedules**: three seeded; nightly next run 23:30 PKT; payslips can't
    be scheduled (403); a period param among the fixed params, a period that
    doesn't fit, 25:00 → 400; a weekly Cafe schedule runs Monday 07:00; *run
    now* archives last week (14–20 Sep) as the schedule; made due, the
    ticker ran it within a minute and moved it on; turn off; a bad param →
    400; a failing run recorded with "Partner not found"; remove.
  - The trial balance still balances.
- [x] PDFs read back page by page: P&L, the category rollup, attendance (its
  day grid over two landscape pages), sales (the 31 × 12 grid, YoY, Eid),
  the partner statement and a payslip — headers, totals, page numbers. The
  other twelve were generated and checked through their headline figures
  and file, not read page by page.
- [x] Frontend and API type-check, and lint is clean in both. In the
  browser:
  - as the Accountant: the catalogue, generating a P&L (opened, archived,
    listed under *Generated just now*), the archive with its headline
    figures, the schedules, a new monthly partner-statement schedule
    (validation, save, *Run now*, *Open the PDF*, remove), *Register PDF* on
    the capex page;
  - as the Branch Manager: six reports, no Schedules tab, attendance for
    their unit with the unit pre-picked;
  - as Branch Staff: no PDF button on Sales;
  - no console errors, and no horizontal page scroll at phone width.
- [ ] Phase 7 sign-off:
  - each **report layout** — the one the partners will actually read;
  - that a partner's share of **P&L** is their weight in the unit's
    allocation rule (Zoo 70/30, Jungle Joys thirds), and that "drawn" is
    everything debited to their capital & current account;
  - the **seeded schedules** and their times;
  - whether scheduled reports should be **emailed**, and to whom.
