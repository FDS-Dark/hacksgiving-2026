# dataloader

The batch job that keeps the app's outside data current: imported
opportunities and resources, and the public data the API serves at
`/v1/public-data`. What each source is, how runs write, and the MPD rate
gate: [docs/data-loader.md](../docs/data-loader.md).

It's its own app: its own uv project, image (`Dockerfile`) and CronJobs
(`terraform/loader.tf`). It shares only the database with the API, and like
the API it holds no SQL: every write is a stored function (ADR 0007).

## Layout

```
main.py            the CLI: lists the sources and runs them (--cadence, --source, --watch, --dry-run, --list)
dependencies.py    the singletons: database engine, executor, one databridge per area
settings.py        APP__DATABASE__*, APP__LOGGING__*, APP__LOADER__* (the API's names)
loader/base.py     the Loader base class: run() = credentials -> rate gate -> fetch -> write -> record the run;
                   OpportunityLoader / ResourceLoader write row by row, PublicDataLoader in bulk
loader/<system>.py one Loader subclass per source (usajobs, careeronestop, comforce, hunger_task_force,
                   milwaukee, mcts, federal)
loader/sources.py  every source, in run order
loader/schedule.py which daily sources a live run catches up
client/            one module per external system: fetch, then parse (tests use recorded payloads);
                   errors.py has RateLimited, geo.py the point-in-polygon tract tagging
databridge/        one method per stored function (0013, 0014, 0030)
model/             the pydantic rows it imports, and what the run log says
utils/             logging, and the rate gate's rule (rate_gate.py)
tests/unit         no network, no database
tests/integration  a throwaway database migrated with database/'s revisions
```

## Run it

```bash
cp example.env .env      # scripts/dev-setup.sh does this, with api/.env's database settings
uv sync
uv run python main.py --list
uv run python main.py --dry-run --source comforce_reviewed
uv run python main.py --watch    # what scripts/dev.sh runs
```

Don't point `--dry-run` at `mpd_calls` in a loop: a dry run has no database,
so the rate gate can't hold it back, and MPD's page counts every request
from the home IP that production and staging share.

## Checks

```bash
uv run flake8 .
uv run mypy .
uv run pytest      # integration tests run when HACKSGIVING_TEST_DATABASE_URL is set (see api/README.md)
```
