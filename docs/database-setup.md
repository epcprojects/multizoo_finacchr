# Local database setup

Multizoo uses its own dedicated PostgreSQL role and database — never the
`postgres` superuser directly, and never anything shared with another
project's database.

## One-time setup

Using `psql` (or any Postgres client) connected as the `postgres`
superuser:

```sql
CREATE ROLE multizoo_app WITH LOGIN PASSWORD 'generate-a-real-random-password-here';
CREATE DATABASE multizoo_dev OWNER multizoo_app;
GRANT ALL PRIVILEGES ON DATABASE multizoo_dev TO multizoo_app;
```

Generate the password with something like:

```bash
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

Then fill in `.env` (copied from `.env.example`) with `DB_USERNAME=multizoo_app`
and that generated password.

## What NOT to do

- Don't reuse the `postgres` superuser's credentials for the app's own
  `DB_USERNAME`/`DB_PASSWORD` — the superuser is for one-time admin tasks
  (creating the role/database) only.
- Don't point this at the same RDS instance or database used by any other
  project. Multizoo gets its own instance/database, full stop — see the
  architecture plan's "Identity — reused, not rebuilt" note for why.

## Schema

In local development, `TypeOrmModule` runs with `synchronize: true`
(`apps/api/environments/environment.ts`) — the schema is generated directly
from the entity definitions every time the app boots. This is a **dev-only
convenience**. Before this ever points at a staging or production database,
switch to real migrations (`environment.prod.ts` already has
`synchronize: false` — migrations still need to be written when that
becomes relevant, around Phase 8 of the Sprint Zero to Cutover plan).

## Verifying the connection

```bash
psql -U multizoo_app -h localhost -p 5432 -d multizoo_dev -c "SELECT count(*) FROM roles;"
```
