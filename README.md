# Multizoo Group Ledger Platform

The accounting, HR, and payroll system replacing the Multizoo group's Excel
workbooks. Built as an Nx monorepo — NestJS + TypeORM + PostgreSQL backend,
Next.js + Tailwind v4 frontend — mirroring the structure of the EPCCRM
project, with its own dedicated database and no shared data or accounts.

## Planning documents

This code follows three published planning artifacts. Read them before
touching a module you haven't built yet:

- **Multizoo Group Ledger Platform** — the architecture: calculation
  inventory, data model, module map, HR & Identity design, flow diagrams.
- **Follow the Rupee** — plain-language chart-of-accounts walkthrough.
- **Sprint Zero to Cutover** — the design & development plan: team, sprint
  calendar, testing strategy, go-live checklist.

## Build order

Modules are built **strictly in sequence** — one is finished (built, tested,
demoed) before the next starts. See `docs/` for a per-module status file.

1. **Identity & Access** ✅
2. **Ledger foundation** (business units, chart of accounts, transactions) ✅
3. **Income allocation engine** (versioned waterfall rules, partners, reserves) ✅
4. **Employee, attendance & leave** (employee master, daily sheet, leave balances & approval, fines) ✅
5. **Payroll, incentives & settlement** (payroll runs, advances, commission pools, full & final settlement, statutory policy) ✅
6. **Loans, utilities & cost centres** (counterparty loans with Partner approval, inter-unit accounts, staff-advance write-offs, utility sub-meter allocation, cost-centre routing) ← current
7. Sales, capex & campaigns
8. PDF reporting suite

## Local development

```bash
cp .env.example .env   # fill in your local Postgres credentials — see docs/database-setup.md
npm install
npx nx run api:seed    # roles, bootstrap super-admin (prints its password once), 7 business units + chart of accounts, partners + allocation rules, HR setup (+ sample staff outside production), payroll accounts + payroll policy, the 342 cost centre + the two shared utility connections
npx nx serve api        # backend on :3000 — Swagger at /api/v1/docs
npx nx dev frontend      # frontend on :4200
npx jest -c apps/api/jest.config.js   # API unit tests (ledger math, money, allocation + formula parity, HR, payroll + salary-sheet and Bonus Calculator parity, loans, Sub Meters Details and 342 parity)
```

Or, on Windows, run both at once (kills anything already on 3000/4200 first,
then opens each in its own terminal window — same pattern as EPCCRM's):

```bash
start-dev.bat
```

## Project layout

```
apps/
  api/         NestJS backend — modules/{auth,users,roles,business-units,accounts,journal,ledger,allocation,hr,payroll,
                       loans,utilities,cost-centres},
               common/{guards,decorators,email,scope}
  frontend/    Next.js frontend (App Router, Tailwind v4)
libs/
  shared/interfaces/   base-entity conventions (BaseEntity, VersionedPolicyEntity, ...)
  shared/types/        SystemRoles, SeedRoleName, Permission enums
  shared/utils/        generateRandomToken, normalise, BigInt paisa money helpers, business date
docs/
  module-01-identity-access.md   status + verification steps, one file per module
  module-02-ledger-foundation.md
  module-03-income-allocation.md
  module-04-employees-attendance-leave.md
  module-05-payroll-incentives-settlement.md
  module-06-loans-utilities-cost-centres.md
  database-setup.md              local Postgres role/database setup
start-dev.bat  Windows: kills 3000/4200, starts backend + frontend each in their own window
```
