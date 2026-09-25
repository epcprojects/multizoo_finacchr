# Module 4 — Employees, Attendance & Leave

**Status: ✅ backend complete and verified (26 new engine/parity unit tests, a 79-check API run against the dev database). Frontend built, type-checked, lint-clean, and every route compiles. Browser click-through still pending (see checklist).**

Architecture plan references: Part 05 (Employee, Department & Designation,
Attendance, LeaveType / LeaveBalance / LeaveRequest, DisciplinaryRecord,
`partner.employeeId`), Part 06 (M14 Employee Master & Org Structure, M15
Attendance & Leave), Part 07 §01–04 and §08, Part 10 (roles table), Part 11
Phase 3, Fig. 14 (attendance feeding payroll), Fig. 16 (rules & policy
engine), Fig. 17 (employee vs. user). Sprint plan demo for this phase:
*"Branch Manager marks attendance; a leave request gets approved."* Client
input: *sign off the leave-quota policy.*

## What this module is

The HR layer under payroll:

- **who is employed**: unit, department, designation, bonus tier,
  employment type, dated salary, join and exit dates;
- **whether they were at work**: each day, marked by the unit's Branch
  Manager;
- **what leave they have and took**: quotas, balances, requests,
  approvals;
- **fines and warnings**, each with a reason and an approver.

It produces the salary sheet's **"Absent" figure** for each month, computed
from real daily records. Payroll (Module 5) reads that figure. Today it is
typed in by hand.

## What the workbook actually does

`Sample cash flow.xlsx → Nov 2024 Salary Sheet ZOO` (hidden) has three
blocks: Multi Zoo, Panda Cafe and MBF. Each row has Name, Designation, New
Salary, **Absent**, Advance, Gross, Bonus, Fine, Food and Net. The formulas
are:

- `G = D − (D/30 × E) − F`
- `K = G + H − I − J`

**"Absent" goes negative.** Qasim is −1 (Gross 28,416.67 on 27,500) and
Shahid Imran is −2 (29,333.33). Working a rest day is paid as an extra
day, netted against absences. This module models that directly (see
decision 2).

Salaries are raised in place, e.g. `=25000*1.1`. Fines are bare numbers,
e.g. `=1630+7200`. There is no leave record at all.

## Design decisions

1. **An Employee is not a User** (Fig. 17). Most of the 100+ staff never log
   in. `employee.userId` is a nullable, unique link, set only for someone
   who is invited. `partner.employeeId` links a partner who also holds a
   salaried title. Salary goes through payroll on the Employee record and
   the profit share stays on the Partner. Each is shown on the other's
   screen.
2. **Working days and rest days.** For each employee, a day is either
   working, or a rest day: their weekly day off, or a holiday for their
   unit or the whole group.
   - A working day is Present, Absent, Half day or Leave.
   - A rest day is Off, or Present / Half day when they worked it. Working
     a rest day is an **extra day** (−1 or −½).
   - Absent / Leave on a rest day is refused, and so is Off on a working
     day. A closure is a holiday, not a status.
3. **The payroll figure** (`payrollAbsentDays`) is
   **absences + ½ × half days + leave not covered − rest days worked.**
   It can be negative, as the workbook's is. Parity tests reproduce the
   sheet's Gross for Qasim, Shahid Imran, Zain Ali and Majid Husain by
   feeding the figure into the sheet's own formula.
4. **Leave is walked day by day against the balance (Fig. 14).**
   - Within a leave year (the calendar year), each leave day of a paid type
     is covered while the balance lasts, oldest first.
   - Days beyond the balance, days before the entitlement is usable, and
     all unpaid leave are **not covered**. They cost pay exactly like an
     absence.
   - So Fig. 14's "covered by leave balance?" is answered per day, and the
     register shows it (paid L vs. red L).
   - Uncovered leave is warned about but never blocked. The workbook
     simply deducts it.
5. **Entitlement.**
   - The full quota is credited on 1 Jan.
   - In the year someone first becomes eligible (on joining, or after 12
     months for annual leave), it is pro-rated from that date and rounded
     **down** to a half day.
   - Carry-forward follows the new year's rule, and is capped so that
     carried + new ≤ *maximum balance*.
   - Casual leave doesn't carry. Sick leave carries up to 16. Annual leave
     carries up to 28 (**to confirm**).
   - Leave is counted in integer half-days, so there are no floats.
6. **The HR policy is versioned (Fig. 16).**
   - `HrPolicy` holds each leave type's rule and the Branch Manager's
     back-dating window.
   - A change is a new version from a date, which must be today or later;
     history is never re-counted.
   - A leave year uses the version in force on 1 Jan (or on the join
     date). A request's "max at a stretch" uses the version in force when
     the leave starts.
   - A version published for the same date as one that hasn't started
     replaces it, which is marked *replaced before use*.
   - The Accountant publishes (roles table: *edit leave policies —
     Accountant ✓, Partner oversight*).
7. **One record of where everyone was.**
   - Approving a leave request writes a LEAVE attendance record for each
     of its working days (source `LEAVE_REQUEST`). Cancelling it removes
     them; past days go back to "not marked" and the user is told.
   - Leave days can't be changed on the sheet.
   - A Branch Manager can also mark Leave (with a type) directly on the
     sheet for a same-day absence.
   - Approval turns days already marked Absent into leave, with a
     warning. It refuses days marked Present.
8. **Biometric-ready.** An attendance record has:
   - `source` (MANUAL / BIOMETRIC / LEAVE_REQUEST);
   - `checkIn` / `checkOut`;
   - `externalRef` (the device's own punch id);
   - a `restDay` snapshot, so a holiday added or a day off changed later
     can't rewrite a day already marked.

   A device feed can post the same rows without anything downstream
   changing. The feed itself is deferred.
9. **Salary is a dated history**, never a column.
   - The first revision is the join date. A raise is a new revision from a
     date. A date already in force can't be overwritten (it may already be
     paid); an upcoming one can be replaced.
   - Salaries and CNICs are shown only to HR (`employee.manage`), payroll
     and the partners (`employee.view`), never to Branch Managers.
10. **Guardrails.**
    - A Branch Manager marks their own units, from today back to the
      policy's window (7 days); HR (`employee.manage`) can correct any past
      day. Nobody marks the future.
    - A sheet saves whole or not at all, with every problem listed.
    - Approving your own leave or fine is refused (via `employee.userId`).
    - Per-employee advisory locks serialise approvals and sheet saves; two
      simultaneous approvals give one 201 and one 409.
11. **Exit.**
    - Recording an exit keeps the person on the sheets up to their last
      day, which may be in the future ("leaving").
    - It is refused while attendance, leave or a salary revision exists
      after that date.
    - They can be reinstated. The settlement is Module 5.

## Data model

| Entity | Key columns | Notes |
|---|---|---|
| `Department` | `businessUnitId`, `name` (unique per unit) | `BaseEntity`, retire rather than delete |
| `Designation` | `name` (unique), `bonusTier` (MANAGER / SUPERVISOR / TICKETER / WORKER / NONE) | Default tier for everyone holding it |
| `Employee` | `employeeCode` (E-0001…), `fullName`, `fatherName`, `cnic` (unique), `phone`, `address`, `businessUnitId`, `departmentId`, `designationId`, `bonusTier` (override), `employmentType`, `joinDate`, `weeklyOffDay`, `status` (ACTIVE / EXITED), `exitDate`, `exitReason`, `userId` (unique), `notes` | `CHECK` exit ≥ join, weekday 0–6 |
| `SalaryRevision` | `employeeId`, `effectiveFrom` (unique per employee), `baseSalary` `NUMERIC(18,2)`, `payBasis` (MONTHLY / DAILY), `reason` | |
| `Holiday` | `date`, `name`, `businessUnitId` (null = group) | |
| `LeaveType` | `code`, `name`, `isPaid`, `sortOrder` | ANNUAL, CASUAL, SICK, UNPAID seeded |
| `HrPolicy` + `HrPolicyLeaveRule` | version, `effectiveFrom`, `status` (ACTIVE / SUPERSEDED), `attendanceBackdateDays`; per type: `daysPerYear` `NUMERIC(5,1)`, `availableAfterMonths`, `maxConsecutiveDays`, `carryForward`, `maxBalance`, `encashable`, `employmentTypes[]` | The PolicyRule instance for leave |
| `AttendanceRecord` | `employeeId` + `date` (unique), `businessUnitId` (unit that day), `status`, `restDay`, `leaveTypeId`, `leaveRequestId`, `source`, `checkIn`, `checkOut`, `externalRef`, `note` | `CHECK` LEAVE ⇔ leave type |
| `LeaveRequest` | `employeeId`, `businessUnitId`, `leaveTypeId`, `startDate`, `endDate`, `days`, `reason`, `status` (PENDING / APPROVED / REJECTED / CANCELLED), reviewer and canceller | One leave year per request |
| `LeaveAdjustment` | `employeeId`, `leaveTypeId`, `leaveYear`, `days` (±), `reason` | Opening balances at cutover, corrections |
| `DisciplinaryRecord` | `employeeId`, `businessUnitId`, `type` (FINE / WARNING), `incidentDate`, `reason`, `amount`, `status` (PENDING_APPROVAL / APPROVED / REJECTED / WITHDRAWN), reviewer | `CHECK` fine ⇔ amount > 0 |
| `Partner` (+1 column) | `employeeId` (unique) | Part 05 worked example |

`LeaveBalance` from the plan is **computed, not stored**. It is the ledger
walk in `hr-math.ts`, so a balance can never drift from the days behind it.

## Permissions

One new claim: **`employee.view`** (Partner: *"view only"* on the employee
master, *"oversight"* on HR policy). The rest already existed from Module 1
and now have meaning:

| Permission | Partner | Accountant | Branch Manager | Branch Staff |
|---|:-:|:-:|:-:|:-:|
| `employee.view`: see employees, salaries, policy, registers | ✓ | — | — | — |
| `employee.manage`: add / edit employees, salary, exit, departments, designations, leave adjustments, correct any attendance day | — | ✓ | — | — |
| `rules.edit_hr_policy`: publish policy versions, leave types, holidays | — | ✓ | — | — |
| `attendance.mark_own_unit`: mark the daily sheet (within the window) | — | — | ✓ | — |
| `leave.approve_own_unit`: enter, approve, reject, cancel leave; mark leave on the sheet | — | — | ✓ | — |
| `disciplinary.raise_own_unit`: raise fines / warnings | — | — | ✓ | — |
| `disciplinary.approve`: approve / reject them (or record approved) | — | ✓ | — | — |

Anyone holding any of these sees the HR screens, for their own units only
unless they hold `units.access_all`. Seeded claim counts after this module:
Partner 12, Accountant 18, Branch Manager 6, Branch Staff 2, SUPER_ADMIN 26.

## API (all under `/api/v1`)

| Method & path | Permission | Purpose |
|---|---|---|
| `GET /employees?businessUnitId&status&departmentId&designationId&search` | any HR claim | Employees in scope; salary / CNIC only for pay viewers |
| `GET /employees/stats` | any HR claim | Employed today, joined this month, leaving, fines to approve |
| `GET /employees/:id` | any HR claim | One employee, with login and partner links |
| `POST /employees`, `PATCH /employees/:id` | `employee.manage` | Add (code assigned, first salary revision), edit, transfer; link a login needs `users.invite` |
| `GET /employees/:id/salary`, `POST /employees/:id/salary` | pay viewers / `employee.manage` | Salary history; a revision from a date |
| `POST /employees/:id/exit`, `/reinstate` | `employee.manage` | |
| `GET /employees/:id/attendance?month` | any HR claim | The month: each day classified, plus the summary |
| `GET /employees/:id/leave?year` | any HR claim | Balances per type, days taken (covered or not), requests, adjustments |
| `GET /attendance/today` | any HR claim | Each unit: expected on duty, marked, present, absent, on leave |
| `GET /attendance/sheet?businessUnitId&date` | any HR claim | The daily sheet, whether it can be edited and why not |
| `PUT /attendance/sheet` `{businessUnitId, date, entries[]}` | `attendance.mark_own_unit` / `employee.manage` | Save the sheet; all rows or none |
| `GET /attendance/register?businessUnitId&month` | any HR claim | Grid plus summary per employee, ending in "absent for payroll" |
| `GET /leave/requests?…`, `POST /leave/requests/preview` | any HR claim / enterers | List; the live check behind the request form |
| `POST /leave/requests` `{…, approve?}` | `leave.approve_own_unit` / `employee.manage` | Enter leave (an approver can approve it in the same step) |
| `POST /leave/requests/:id/{approve,reject}` | `leave.approve_own_unit` | |
| `POST /leave/requests/:id/cancel` | enterer (pending) / approver or HR | Withdraw, or call off approved leave |
| `GET /leave/balances?businessUnitId&year` | any HR claim | |
| `POST /leave/adjustments` | `employee.manage` | |
| `GET/POST /disciplinary`, `POST /disciplinary/:id/{approve,reject,withdraw}` | raise / approve | |
| `GET/POST /hr/departments`, `PATCH /hr/departments/:id` | view / `employee.manage` | |
| `GET/POST /hr/designations`, `PATCH /hr/designations/:id` | view / `employee.manage` | |
| `GET/POST /hr/holidays?year`, `DELETE /hr/holidays/:id` | view / `rules.edit_hr_policy` | |
| `GET/POST /hr/leave-types`, `PATCH /hr/leave-types/:id` | view / `rules.edit_hr_policy` | |
| `GET/POST /hr/policies` | view / `rules.edit_hr_policy` | Versions, and publishing a new one |
| `PATCH /partners/:id` | as before | Adds `employeeId` |

## Screens

- **Employees** (new nav item):
  - banner figures;
  - search, and filters by unit and status;
  - the roster, with salary and any upcoming raise shown to pay viewers;
  - *Add employee* (a side panel);
  - the **Fines & warnings** register, with approve / reject / withdraw.
- **Employee** page:
  - header: status, partner link, and actions (new leave, fine or warning,
    edit, change salary, record exit / reinstate);
  - **Attendance**: month calendar, legend and the payroll figures;
  - **Leave**: balance cards per type, with carried / entitled / adjusted /
    taken / pending / not covered; requests; days taken; adjustments;
  - **Salary**: history;
  - **Fines & warnings**;
  - **Details**.
- **Employees → HR settings**:
  - **Leave policy**: in force, version history, and *New version* with
    the list of what changes;
  - **Holidays**: by year, group-wide or per unit;
  - **Leave types**;
  - **Departments**: by unit, rename inline, retire;
  - **Designations**: bonus tier inline, retire.
- **Attendance** (new nav item):
  - banner totals for today;
  - a card per unit showing how much of today's sheet is left;
  - **Daily sheet**: grouped by department, one tap per person
    (Present / Absent / Half day / Leave + type; rest days: Off / Worked /
    Half), *Mark N unmarked as present*, a note per row, and a sticky
    *Save sheet* with the unsaved count. Approved leave shows locked;
    past-window days show why they're read-only.
  - **Monthly register**: a person × day grid, with Present, Absent, half
    days, paid leave, leave not covered, rest days worked, not marked, and
    **Absent for payroll**.
- **Leave** (new nav item):
  - banner figures;
  - the **approval queue**;
  - all requests by year and status;
  - **Balances**: available / entitlement per type per person, with days
    not covered in red;
  - *New leave*, with a live preview of working days, balance before →
    after, and every warning or blocking error.
- **Allocation → Partners**: the partner form gains *Employee record*.

## Seed

`api:seed` adds the following:

- **25 designations**, exactly as the Nov 2024 salary sheet writes them,
  plus Shop Assistant and Ride Operator. Each has a starting bonus tier:
  - Operation's Officer → Manager;
  - Supervisor, JJ / MBF Supervisor, GS1, GS2 → Supervisor;
  - Ticket Incharge and the cashiers → Ticketer;
  - everyone else → Worker.

  GS1/GS2 are a guess from their pay; the tiers are for Phase 0 sign-off.
- **12 departments** across ZOO, CAFE, GIFT, JOYLAND, PETS and MBF.
- **Leave types** Annual, Casual, Sick and Unpaid.
- **HR policy v1**, effective 2000-01-01, with the Ordinance minimums from
  Part 07 §03:
  - Annual: 14 days, after 12 months, carries up to 28 (**to confirm**),
    paid out on exit;
  - Casual: 10 days, at most 3 at a stretch, no carry;
  - Sick: 8 days, carries up to 16;
  - all for permanent and contract staff;
  - the back-dating window is 7 days.
- **Fixed-date public holidays** for 2026–27: 5 Feb, 23 Mar, 1 May, 14 Aug,
  9 Nov, 25 Dec. Moon-sighted festivals (both Eids, Ashura, Eid
  Milad-un-Nabi) are for the Accountant to add once announced. They matter:
  staff who work them get an extra day.
- **Outside production only** (`NODE_ENV=production` or
  `SEED_SAMPLE_EMPLOYEES=false` skips it): a **sample roster of 23
  invented people**.
  - Their designations and salaries have the salary sheet's shape, with
    staggered days off. It includes a daily-wage ride operator, a contract
    worker, a July-2026 joiner (no annual leave yet) and a pre-2020 manager.
  - Each is marked *"Sample record — not a real employee. Delete before
    go-live."*
  - The real roster (names, CNICs, salaries) is personal data. It comes in
    with the historical import, not in source code.

## Deliberately deferred

- **Payroll, advances, bonus pool, and full & final settlement.** These
  are Module 5. This module hands over:
  - the month's `payrollAbsentDays`;
  - approved fines;
  - bonus tiers;
  - dated salaries;
  - `encashable` leave balances.
- **Attendance lock after a payroll run.** Module 5 adds the lock. Until
  then, HR can correct any past day.
- **Biometric device feed.** The data model is ready (decision 8); the
  ingestion endpoint and device mapping come when a device is chosen.
- **Half-day leave requests**, and **leave that crosses 31 Dec** in one
  request. Enter the latter as two requests. A half-day absence is marked
  as Half day.
- **Employees requesting their own leave** through a login. Most staff
  don't have one; the Branch Manager enters it.
- **Historical import** of the real roster and leave balances. Opening
  balances go in as leave adjustments.
- **Attendance & leave summary / disciplinary register PDFs.** These are
  Module 8.
- **Statutory profile** (EOBI, tax, provident fund). This is Module 5.

## Where things live

```
apps/api/src/app/modules/hr/
  hr-math.ts (+ .spec)       pure calendar, leave-ledger and month-summary engine + salary-sheet parity
  hr-common.ts               HR scope rules, holidays, policy lookup, per-employee locks
  org.service.ts             departments, designations, holidays, leave types, policy versions
  employees.service.ts       employee master, salary revisions, exit / reinstate, stats
  attendance.service.ts      daily sheet, month register, today overview
  leave.service.ts           balances (ledger walk), requests, preview, approval, adjustments
  disciplinary.service.ts    fines & warnings
  hr.controller.ts           /hr, /employees, /attendance, /leave, /disciplinary
  entities/                  org, employee (+ salary revision), leave, attendance (+ disciplinary)
apps/api/src/database/seeds/hr.seed.ts
apps/frontend/src/
  app/(dashboard)/employees/{page.tsx,[id]/page.tsx,settings/page.tsx}
  app/(dashboard)/{attendance,leave}/page.tsx
  components/hr/             sheet, register, calendar, request / fine / salary / exit / policy modals, tables
  lib/api/hr.ts
```

## Verification checklist

- [x] Unit tests: 26 new, 80 in total.
  - Dates, month bounds, and half-day parsing.
  - Rest days, working-day counting, and allowed statuses.
  - Entitlement: annual after 12 months, pro-rated (7 days for a 1 July
    joiner); casual pro-rated to 2½; not eligible → 0.
  - Carry-forward: sick capped at 16, casual none.
  - Coverage:
    - exactly exhausted → 0;
    - beyond quota → uncovered, oldest covered first;
    - entitlement not usable before eligibility, but carried and adjusted
      days are;
    - unpaid never covered;
    - pending reduces available, not the balance.
  - A multi-year ledger walk.
  - **Salary-sheet parity**, feeding the computed "Absent" into the sheet's
    own `=D−(D/30×E)−F`:
    - Qasim −1 → 28,416.67 ✓;
    - Shahid Imran −2 → 29,333.33 ✓;
    - Zain Ali 3 → 27,000 ✓;
    - Majid Husain 5 → 19,166.67 (the sheet typed 19,150).
  - Holidays, partial months, and the rest-day snapshot.
- [x] API run against the dev database: 79 of 79 checks passed. The run
  created, verified and then removed its own records, leaving the database
  in its seeded state. It covered:
  - **Scope**:
    - Branch Staff → 403;
    - a Branch Manager sees only CAFE's 5 staff, with no salaries or
      CNICs;
    - a Partner sees all 23 with pay, but adding one → 403;
    - a Branch Manager opening a ZOO employee → 403.
  - **Org**: a duplicate department → 409; a Branch Manager adding a
    designation → 403; policy v1 is correct.
  - **Employees**:
    - a code is assigned and the salary runs from the join date;
    - a duplicate CNIC → 409 and a bad CNIC → 400;
    - a department from another unit → 400;
    - an upcoming raise, which can be replaced;
    - overwriting a salary in force → 409;
    - a Branch Manager reading salary history → 403.
  - **Attendance**:
    - Absent on a rest day is refused and *nothing* is saved;
    - a full sheet with one rest day worked;
    - marking ZOO → 403;
    - tomorrow → 400;
    - 10 days back: Branch Manager → 403, Accountant ✓;
    - Leave without a type → 400;
    - casual leave marked on the sheet;
    - the register shows EXTRA, ABSENT and LEAVE_PAID, and nets the
      payroll figure.
  - **Leave**:
    - 4 casual days → "at most 3";
    - a 2-day request → pending, and an overlap → 400;
    - approval: Branch Staff → 403, Accountant → 403 (Branch Manager only),
      **two simultaneous approvals → one 201 + one 409**;
    - the days appear on the register;
    - the balance is 10 − 2 = 8;
    - cancelling removes the days;
    - annual leave in the first year is not covered;
    - an adjustment of −9 by a Branch Manager → 403, by the Accountant ✓;
    - approve-in-one-step warns "1 of 2 days not covered", and the register
      shows LEAVE_PAID + LEAVE_UNPAID;
    - sick leave for today warns that it converts the absence;
    - reject with a note;
    - a linked Branch Manager approving their own leave → 403.
  - **Policy**:
    - starting yesterday → 400;
    - a Partner publishing → 403;
    - v2 from next 1 Jan, then v3 on the same date replaces it;
    - next year's casual entitlement is 12 with no carry;
    - sick carries 8 up to 16.
  - **Holidays**: a CAFE holiday today; a duplicate → 409; a day already
    marked keeps its status.
  - **Fines**:
    - a Branch Manager raises one, and it goes to pending;
    - a warning with an amount → 400;
    - a Branch Manager approving → 403, raising for ZOO → 403;
    - the Accountant approves;
    - withdraw;
    - record-and-approve in one step.
  - **Exit**: before a marked day → 400; with a later raise → 400; on the
    raise date → "leaving"; reinstate.
  - **Partner link**: linked, the same employee on a second partner → 409,
    and the employee shows the partner.
  - **Today overview**: scoped to CAFE and complete.
- [x] Frontend and API type-check. Lint is clean in both. Every new route
  (`/employees`, `/employees/[id]`, `/employees/settings`, `/attendance`,
  `/leave`) compiles and returns 200.
- [ ] Browser click-through as Branch Manager (mark today's sheet, enter
  and approve leave), Accountant (add an employee, change a salary, approve
  a fine, publish a policy) and Partner (read-only). This needs a person to
  sign in.
- [ ] Phase 0 sign-off:
  - the leave-quota policy, especially annual carry-forward and who gets
    which leave;
  - bonus tiers per designation;
  - the 7-day back-dating window;
  - the holiday calendar.
