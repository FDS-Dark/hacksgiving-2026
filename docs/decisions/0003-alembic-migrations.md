# 0003 — Schema migrations with Alembic (supersedes 0001)

> Inherited from Cooli, the project this repo's stack was copied from. The
> decision applies here; its examples name Cooli's domains (households,
> inventory, scans), which this repo doesn't have.

**Date:** 2026-11-09 · **Status:** accepted

ADR 0001 kept the template's db-upgrader tool instead of the Alembic the
design names (§4.1, §4.2, §11). We're moving to Alembic so the code
matches the proposal.

**Decision:** Alembic owns the schema. Revisions live in
`database/migrations/versions/` and run explicit SQL:

- A revision with a lot of SQL keeps it in a `.sql` file of the same name
  (`0001_initial_schema.sql`, `0003_seed_catalog.sql`). The `.py` file runs it
  and holds the downgrade. The SQL stays readable for the course.
- `0002_app_role` creates the API's least-privileged role if it's missing
  and grants it the `app` schema. The API never connects as the owner.
- The starter catalog is reference data every environment needs, so it is
  a migration (`0003`). Catalog changes go in new revisions.
- Local dev and demo data are not migrations. They live in
  `database/seeds/local/` and load with `./migrate.sh --local`.
- Alembic runs from the `api/` project's environment
  (`uv run --project ../api alembic ...`) with the synchronous psycopg
  driver, since asyncpg can't run a multi-statement SQL file. The API keeps
  using asyncpg.
- No SQLAlchemy models, so no `--autogenerate`. Offline `--sql` mode isn't
  supported, because `0002` checks for existing roles first.

**Settings:** `HACKSGIVING_MIGRATION_DATABASE_URL` (owner connection),
`HACKSGIVING_APP_ROLE` (default `hacksgiving`) and `HACKSGIVING_APP_PASSWORD` (only needed when
the role doesn't exist yet). Tests pass the same values through
`Config.attributes`.

**Consequences:**

- No private binary to fetch. Migrations run anywhere `uv` does, including
  CI and Supabase. `database/` is no longer a standalone repo: its migrate
  job needs the monorepo's `api/` project.
- Integration tests build each test database with `alembic upgrade head`.
  `test_migrations.py` checks upgrade → downgrade → upgrade on an empty
  database.
- Applied revisions are never edited; add a new one.
- An existing local database built by db-upgrader has the same schema as
  revision `0003`. Either `./migrate.sh stamp head` or recreate it
  (`docker compose down && rm -rf data`, then `./migrate.sh --local`). The
  leftover `db_up` journal schema can be dropped.
