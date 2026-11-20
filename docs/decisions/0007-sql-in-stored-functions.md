# 0007 — The API's SQL lives in stored functions

> Inherited from Cooli, the project this repo's stack was copied from. The
> decision applies here; its examples name Cooli's domains (households,
> inventory, scans), which this repo doesn't have.

**Date:** 2026-11-13 · **Status:** accepted

## Context

The API was layered routers → services → databridge → engine, but services
built SQL strings and the databridge was one generic "run this SQL" call.
Business rules and SQL sat together in services, every query's household
filter had to be repeated by hand, and unit tests could only check
behaviour by asserting on SQL text.

## Decision

All of the API's SQL is in PostgreSQL functions, and the API has none.

```
routers/     HTTP: request and response models, status codes, auth dependencies
  -> services/     rules and errors; call databridges, never SQL
    -> databridge/   one class per domain; each method calls one function, returns models
      -> app.<domain>_<verb>(...)   the SQL, in database/migrations
```

- **One function per data operation**, named `app.<domain>_<verb>`
  (`app.inventory_remove_stock`) with `p_` parameters. Revision 0009
  creates them; later changes replace them in new revisions.
- **The executor** (`api/databridge/executor.py`) sends the one statement
  shape the API ever uses, `SELECT * FROM app.<fn>(p_a => :a, …)`. Every
  value is bound; function and argument names come from code and are
  checked against an identifier pattern.
- **Databridges return Pydantic models** (`api/models/<domain>.py`), never
  rows. Results that aren't part of the HTTP contract (`MemberRemoval`,
  `LockedScan`) are models too, marked as such.
- **Household scope is in the signature.** Every function that touches
  household data takes `p_household_id` and filters by it; the service
  passes the verified tenant's id.
- **Atomic workflows** either are one function (each stock change writes
  its lot and its event together) or share one transaction across
  databridges (`Databridge.within(tx)`, used by scan confirmation).
- **Domains** line up across layers: user, household, location, inventory,
  catalog, barcode, scan, recipe. External clients (receipt reader, photo
  storage, product databases) are `api/adapters/`.

## Consequences

- Concurrency rules live next to the data: the last-owner check locks the
  household row inside `household_set_role` / `household_remove_member`.
- Service unit tests run against an in-memory stand-in for the functions
  (`api/tests/unit/fakes.py`) and check behaviour, not SQL text. The SQL
  is covered by the integration tests, which run every migration.
- Changing a query is a migration. Applied revisions are never edited.
- `test_migrations.py` checks that 0009's downgrade list names every API
  function, and that the app role may execute all of them.

## Alternatives

- **SQL in the databridge, as Python strings.** Keeps one language per
  file but still mixes SQL into the API, and leaves concurrency rules split
  between Python and SQL.
- **An ORM.** The course asks for explicit SQL (ADR 0001, 0003), and an ORM
  would hide exactly the constraints and locking this project demonstrates.
