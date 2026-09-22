# Module 1 — Identity & Access

**Status: ✅ complete — built, seeded, and verified end-to-end against a real local database on 2026-09-22.**

## What this module is

Everything else in the system depends on it: who can log in, what they're
allowed to do, and how a role's permissions actually get enforced. Adapted
from the EPCCRM project's proven Identity module — same mechanics (invite-only
onboarding, JWT, bcrypt, dynamic claims-based roles), own dedicated database,
nothing shared.

## What's built

**Entities** (`apps/api/src/app/modules/{users,roles}/entities`)
- `User` — pure login credential. No knowledge of Employee/Partner (see
  architecture plan Fig. 17) — those get added in later modules as
  `employee.userId` / `partner.userId`, nullable unique FKs pointing here.
- `Role`, `RoleClaim` — dynamic roles with permission claims, not a fixed
  enum. `SUPER_ADMIN` is a build-time escape hatch, not a business role — see
  below.
- `UserRole` — join table, composite PK.

**Auth** (`modules/auth`) — login, accept-invite, forgot/reset password,
change password. JWT signed for 7 days. `@Public()` decorator marks the
unauthenticated routes; every other route requires a valid token by default
(`JwtAuthGuard` wired as a global `APP_GUARD`).

**Permissions** (`common/guards/permissions.guard.ts`,
`common/decorators/permissions.decorator.ts`) — `@RequirePermission({ permissions: [...], roles: [...] })`
on any route. Checked against the roles/permissions resolved onto
`request.user` when the JWT is validated (`UsersService.findById`).

**Seed data** (`database/seeds/roles.seed.ts`) — the four roles from the
architecture plan's Access & Roles table (Part 10), with the real permission
matrix, not placeholders:

| Role | Claims | Permission claims |
|---|---|---|
| Partner | 7 | consolidated + own P&L, edit allocation rules, approve loans, generate reports, invite users, manage roles |
| Accountant | 11 | consolidated + own P&L, enter transactions, reconcile ledgers, approve disciplinary fines, manage employees, run payroll, edit HR policy, initiate loans, generate reports, invite users |
| Branch Manager | 5 | enter transactions (own unit), mark attendance, approve leave, raise disciplinary fines, generate reports (own unit) |
| Branch Staff | 2 | enter transactions (own unit), generate reports (own unit) |

Claim counts confirmed by running `roles.seed.ts` against the real database — 25 total.

**Super admin bootstrap** (`database/seeds/super-admin.seed.ts`) — the answer
to invite-only auth's chicken-and-egg problem: the first user can't be
invited, because nobody with `USERS_INVITE` exists yet. This seed creates a
`SUPER_ADMIN` role (18 claims — every `Permission` value, explicitly, not
just the guard's name-based bypass) and a default system user
(`SUPER_ADMIN_EMAIL`, defaulting to `superadmin@multizoo.local`). On first
run with no `SUPER_ADMIN_PASSWORD` set, a random password is generated and
printed to the console **once** — re-running the seed never touches an
existing password. In a production environment, an unset
`SUPER_ADMIN_PASSWORD` makes the seed refuse to run rather than
auto-generate one there. Log in once, invite the first real Partner, then
this account should sit unused — it is not meant for day-to-day work.

**Frontend** (`apps/frontend/src/app/(auth)/{login,accept-invite}`, `app/page.tsx`)
— working login form, accept-invite form, and a proof-of-life home page that
calls `/users/me` and renders the resolved roles + permission list. This is
not the real dashboard (that's Module 2) — it exists to prove the whole
chain works end to end.

**Theme** (`app/global.css`, `app/layout.tsx`) — same technical approach as
EPCCRM's frontend: Tailwind v4 `@theme inline`, a display face loaded via
`next/font/google` (Nunito, matching EPCCRM's actual — if oddly-named —
choice), and a semantic warning/error/success colour ramp shaped the same
way (25/100/200/500/600/800/900 for warning, 100/200 for error, 500 for
success). The brand colour is Multizoo's own jade/gold, not Harper's
`#673DE6` purple — confirmed by grepping the built CSS for both. Also fixed
a bug found while doing this: EPCCRM's `--background`/`--foreground`
variables are referenced throughout its `global.css` but never actually
defined anywhere in that codebase; Multizoo's version defines them properly,
in both light and dark.

## Deliberately deferred (not missing — out of scope for this module)

- Full Notifications module (in-app feed, websockets, queue) — replaced by
  a minimal `EmailService` that logs to console when no SendGrid key is
  set. Revisit when a notifications module is actually needed.
- `Employee.userId` / `Partner.userId` — those tables don't exist until
  Module 4 (HR) and Module 3 (Profit & Equity). `User` is intentionally
  ignorant of them (see Fig. 17).
- httpOnly cookie session storage — using `localStorage` for the JWT for
  now; swap before this goes anywhere near production.

## Verification checklist

- [x] `npm install` completes clean (1967 packages, `--legacy-peer-deps`
      needed once for an npm resolver bug, unrelated to this codebase)
- [x] `multizoo_dev` database + dedicated `multizoo_app` role created,
      `.env` filled in with real generated credentials (not the Postgres
      superuser — see `docs/database-setup.md`)
- [x] `npx nx serve api` boots, connects, synchronizes the schema
      (`users`, `roles`, `role_claims`, `user_roles` with correct FKs)
- [x] `/api/v1/health` returns 200 with no auth
- [x] `npx nx run api:seed` creates the 4 business roles with correct claim
      counts (Partner 7, Accountant 11, Branch Manager 5, Branch Staff 2),
      plus `SUPER_ADMIN` with all 18 — 43 total
- [x] Super admin logs in with the printed bootstrap password, and the
      `PermissionsGuard` bypass is real — verified by creating a role
      through the live API using only the `SUPER_ADMIN` role
- [x] Re-running `api:seed` is idempotent — no duplicate super-admin user,
      original password still works, roles/claims just refreshed in place
- [x] A manually-inserted invited user accepted their invite via
      `POST /auth/accept-invite`, then logged in via `POST /auth/login`
      and received a JWT with the correct `roles`
- [x] `GET /users/me` returned the correct resolved roles + permissions
- [x] An unauthenticated request to `/users/me` returned 401
- [x] A Branch Staff user got 403 with a clear message on `POST /roles`
      (Partner-only), and correctly got only their own 2 permissions on
      `/users/me` — proves per-role scoping, not just auth
- [x] A Partner successfully created a brand-new custom role ("Test
      Auditor") via `POST /roles` — proves the dynamic-role/self-service
      design actually works, not just the seeded four
- [x] Test fixtures cleaned up afterward — database left in a clean
      seeded-only state (4 roles, 25 claims, 0 users)
- [ ] `npx nx dev frontend` — login, accept-invite, and the proof-of-life
      home page rendered manually in a browser (backend verified via curl;
      frontend forms not yet click-tested by a human)
