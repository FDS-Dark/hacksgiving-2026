# 0001 — Schema migrations stay on db-upgrader (deviation from §4.1)

> Inherited from Cooli, the project this repo's stack was copied from. The
> decision applies here; its examples name Cooli's domains (households,
> inventory, scans), which this repo doesn't have.

**Date:** 2026-11-05 · **Status:** superseded by [0003](0003-alembic-migrations.md) on 2026-11-09

The design doc (§4.1, §4.2) names SQLAlchemy 2.x + Alembic for migrations.
The repository template already ships migrations through the shared
`db-upgrader` (DbUp) tool with plain SQL scripts in `database/scripts/`, and
§4 says adapting the existing layers is preferred over replacing them
without a reason.

**Decision:** keep db-upgrader and write migrations as explicit SQL.

- The course asks us to explain and demonstrate raw SQL, constraints and
  queries; hand-written SQL migrations are that evidence directly.
- db-upgrader runs against any PostgreSQL, including Supabase, with the
  same scripts for local, CI and hosted databases.
- The API already uses SQLAlchemy Core with raw SQL, not the ORM, so
  Alembic's autogenerate would have no models to diff against.

**Costs:** the db-upgrader binary is private (GitLab auth needed to fetch
it). Tests and CI don't depend on it: the integration-test fixture applies
`tracked/` then `untracked/` in order with the same `$Variable$`
substitution. Applied tracked scripts must never be edited; add a new
numbered script instead.

**Revisit if:** Supabase's migration tooling becomes the deployment path, or
the instructor requires Alembic specifically.
