# Data loader

A batch job that keeps the app's outside data current: **opportunities**
and **resources** (next to the ones ComForce staff enter by hand) and
**public data** (reviewed incidents, dispatch calls, boundaries, transit,
weather alerts, community needs, crime trends). The sources and the rules
for using them are in [real-data-sources.md](real-data-sources.md).

It's its own app, [`dataloader/`](../dataloader/README.md): its own uv
project, image and CronJobs, sharing only the database (and its stored
functions) with the API.

```bash
cd dataloader
uv run python main.py --list            # every source, its cadence, and whether it can run
uv run python main.py --dry-run         # fetch and report; write nothing
uv run python main.py                   # every source, once
uv run python main.py --cadence live    # just the live ones (calls, alerts)
uv run python main.py --source mke_nibrs   # just one (repeatable)
uv run python main.py --watch           # keep going: live every 5 min, daily ones daily
```

`scripts/dev.sh` runs `--watch` next to the API and the worker
(`HACKSGIVING_NO_LOADER=1` skips it); it reads `dataloader/.env`, which
`scripts/dev-setup.sh` creates from `dataloader/example.env` with the API's
database settings. A run exits 1 when a source failed. A source whose key
isn't set, or that the rate gate holds back, is **skipped**, not failed,
and the rest run.

## Sources

They run in this order. Each is `daily` (nightly) or `live` (every 5
minutes in production, hourly on staging; `mpd_calls` no more often than
its rate gate allows, below).

| Source | Writes | Cadence | Needs | What |
|---|---|---|---|---|
| `usajobs` | opportunities | daily | `APP__LOADER__USAJOBS_API_KEY`, `APP__LOADER__USAJOBS_EMAIL` ([free key](https://developer.usajobs.gov/apirequest/)) | Federal jobs open to the public near Milwaukee |
| `careeronestop_jobs` | opportunities | daily | `APP__LOADER__CAREERONESTOP_USER_ID`, `..._TOKEN` | National Labor Exchange jobs; fair-chance employers tagged |
| `careeronestop_training` | opportunities (education) | daily | the same | Training programs WIOA can pay for |
| `comforce_reviewed` | resources | daily | nothing | ComForce-reviewed Milwaukee Mobile Crisis, police non-emergency, and City Services contacts shared with the phone navigator |
| `careeronestop_ajc` | resources | daily | nothing | American Job Centers |
| `careeronestop_reentry` | resources | daily | nothing | Youth and reentry programs |
| `hunger_task_force` | resources (meal programs) | daily | nothing | Pantries, meal sites, WIC, formula, mobile markets, Stockbox; placed with the Census geocoder |
| `mke_boundaries` | `geo_areas` | daily | nothing | MPD districts, census tracts, neighborhoods, aldermanic districts |
| `mke_nibrs` | `external_incidents` | daily | nothing | MPD-reviewed incidents (NIBRS), the last `NIBRS_WINDOW_DAYS` (90) |
| `mpd_calls` | `external_signals` | live | nothing | MPD dispatched calls, 30-90 minutes delayed |
| `mfd_calls` | `external_signals` | live | nothing | MFD fire and EMS calls |
| `mcts_gtfs` | `transit_routes`, `transit_stops` | daily | nothing | MCTS routes and stops, each stop with its routes |
| `mcts_alerts` | `transit_alerts` | live | nothing | MCTS service alerts (GTFS-Realtime) |
| `nws_alerts` | `weather_alerts` | live | nothing | National Weather Service alerts for Milwaukee County |
| `cdc_places` | `community_measures` | daily | nothing | CDC PLACES health-related social needs by tract |
| `fbi_cde` | `crime_trends` | daily | optional `APP__LOADER__FBI_API_KEY` | FBI monthly totals and rates for MPD, Wisconsin and the US |

Not loaded:

- **211 Wisconsin / IMPACT 211.** Its V2 API is behind registration, and only
  deprecated v1 definitions are public. Request access through
  apiportal.211.org (see real-data-sources.md), then add an adapter.
- **CVI benchmarks** (MHRC dashboards, 414LIFE). No machine-readable export.
- **CareerOneStop's** jobs and training need a key, and it stopped issuing
  new ones in November 2026.

## The MPD rate gate

MPD's calls page allows **10 requests per 30 minutes per IP address**. Past
that it answers with an "unreasonable amount of requests" row instead of the
calls, and every request it refuses counts too, so a loader that retries
every 5 minutes never gets back in. Production, staging and every laptop on
the home network leave from the **same IP**. So:

- **Each environment has its own budget**, `APP__LOADER__MPD_MIN_INTERVAL_SECONDS`:
  production 300 (6 requests per 30 minutes), staging 3600 (0.5), local dev
  900 (2, the default). Together they stay under 10. A second laptop on the
  same network uses 2 more, so still set `HACKSGIVING_NO_LOADER=1` on
  all but one.
- **Before asking**, `mpd_calls` reads its last attempts from
  `app.loader_runs` (`loader_run_gate`, revision 0030). It's skipped when its
  last attempt (successful or failed, counted from when it started, with 30
  seconds' grace for a pod that starts early) is within the interval. So the
  CronJob, a catch-up run and a second loader on the same database all agree.
- **When MPD refuses**, the client raises `RateLimited`
  (`dataloader/client/errors.py`). The run is recorded as failed with
  `rate_limited = true`, and nobody sharing the database asks again for
  `APP__LOADER__MPD_BACKOFF_SECONDS` (1800, MPD's window).
- **A hold is not recorded.** It isn't an attempt (recording it would push
  the next run back forever), and Insights keeps showing the last real
  run's status. The log says why: `mpd_calls: skipped; ...; asked 5 minutes
  ago; asks at most every 15 minutes`.
- `--dry-run` has no database, so nothing holds it back: don't loop it
  against `mpd_calls`.
- Checking and asking aren't one atomic step: two loaders that check within
  the same few seconds can both ask. That costs one request.

The app never calls the page itself; it reads `/v1/public-data/calls`.

## Privacy rules (enforced in the database)

From real-data-sources.md:

- **Generalized locations.** Coordinates are stored rounded to 3 decimals
  (about 110 m) and served publicly at 2 (about 1 km). Addresses, apartment
  numbers and NIBRS case numbers are never served, and addresses aren't
  stored at all.
- **Small areas are suppressed.** Per-tract incident counts under 5 are left
  out.
- **Dispatch calls are labeled and limited.** They're unconfirmed, keep
  their status history, and expire after `SIGNAL_TTL_HOURS` (24). Sensitive
  call types (domestic, sexual assault, self-harm, juvenile, welfare checks,
  missing persons, ...) are stored with `public = false` and never served.
- **Bad source data is rejected.** NIBRS records dated in the future (the
  source has some) are dropped, and coordinates outside Milwaukee are
  discarded.
- **Broken sources fail loudly.** A changed calls page (missing or reordered
  columns), a CKAN or ArcGIS error envelope inside a 200, or a truncated
  boundary layer fails that source. It never writes partial or made-up data,
  and the app shows nothing rather than fallback points.

## Reading it: `/v1/public-data`

No sign-in; everything is already generalized.

| Endpoint | What |
|---|---|
| `GET /incidents?days=30` | Reviewed incidents at about 1 km, with the app's map category |
| `GET /incidents/by-tract?days=30&offense_code=13A` | Counts per tract (under 5 suppressed) |
| `GET /calls?source=mpd_calls&hours=6` | Delayed dispatch calls, public types only |
| `GET /transit/nearby?latitude=&longitude=` | Nearest stops, live arrivals (MCTS trip updates, cached 30 s) and service alerts |
| `GET /weather-alerts` | NWS alerts in effect |
| `GET /community-needs?tract_geoid=` | CDC PLACES measures by tract |
| `GET /crime-trends?offense=homicide` | FBI monthly series |
| `GET /sources` | Each source's latest run and last success (freshness) |

The safety map and Alerts tab use `/incidents` and `/calls`. The others are
ready for screens; transit is meant for a "next bus" line on each resource.

## Two kinds of opportunity

| | Staff postings | Imported |
|---|---|---|
| `source` | `manual` | the source's name (`usajobs`, ...) |
| Entered by | workers and admins (Me → Manage → Opportunities) | the loader, every night |
| For | openings ComForce vouches for, usually open to people who have a harder time getting hired the usual way | the wider job and training market |
| Listed | first | after the staff postings, newest first |

Staff tag their own postings with **audiences**, which residents can filter by:
`second_chance` (open to people with a conviction record), `unhoused`,
`no_experience`, `no_id_required`, `youth`. An import gets `second_chance`
when its source flags a fair-chance employer. Opportunities also have an
`education` kind and a `cost` (`free`, `low_cost`, `paid`).

## How a run writes

Everything goes through stored functions (ADR 0007):
`0013_data_loader.sql` for opportunities and resources, `0014_public_data.sql`
for the rest.

- **Opportunities and resources: upsert by the source's id, skipping
  duplicates.** The key is `(source, external_id)`. Each row has a generated
  `dedupe_key`: for an opportunity, the kind, title, organization and city,
  lowercased with punctuation removed; for a resource, the name. An import
  that matches another open row is skipped, whether that row came from
  another source or from staff.
- **Opportunities and resources: closed, never deleted.** After a clean
  run, the rows the source no longer lists are closed (`active = false`), so
  referrals still resolve. A posting closed by staff stays closed
  (`closed_by_staff`).
- **Public data: bulk upsert.** Each `<table>_sync` takes the rows as one
  JSON array.
- **Public data: removing what's gone.** After a clean run,
  `public_data_retire` deletes what the source no longer lists. Incidents
  are only removed within the refreshed window; calls go when they expire.
- **Census tracts.** Incidents and calls are tagged with their tract when
  they're written, using the boundaries in `geo_areas` (point in polygon;
  there's no PostGIS).
- **When nothing is removed.** A fetch error, a row that failed to write,
  or an empty result removes nothing. An alert feed is different: empty
  means no alerts.
- **Run log.** Every run that asked a source, and every skip for missing
  credentials, goes to `app.loader_runs`, which `/v1/public-data/sources`
  reads and the rate gate checks. Rate-gate holds are only logged.

## Settings

`APP__LOADER__*`, see `LoaderConfig` in `dataloader/settings.py`. The
database and logging settings are the API's (`APP__DATABASE__*`,
`APP__LOGGING__*`), so the same secrets work for both.

| Setting | Default | What |
|---|---|---|
| `LOCATION` | `Milwaukee, WI` | Place for the job and training searches |
| `RADIUS_MILES` | 25 | Search radius around `LOCATION` |
| `STATE`, `ZIP_PREFIXES` | `WI`, `530`/`531`/`532` | Which rows of the directory downloads to keep |
| `MAX_AGE_DAYS` | 30 | Oldest job posting to fetch |
| `MAX_PER_SOURCE` | 500 | Most rows per source and run |
| `NIBRS_WINDOW_DAYS` | 90 | How far back each nightly NIBRS run refreshes |
| `SIGNAL_TTL_HOURS` | 24 | How long dispatch calls are kept |
| `NWS_ZONES` | `WIC079`, `WIZ066` | Weather alert zones |
| `COUNTY_FIPS` | `55079` | County for CDC PLACES |
| `FBI_API_KEY` | none | Optional FBI key |
| `FBI_MONTHS` | 24 | Months of FBI history |
| `LIVE_EVERY_SECONDS` | 300 | Live-run interval in `--watch` mode |
| `MPD_MIN_INTERVAL_SECONDS` | 900 | Least time between requests to MPD's calls page (production 300, staging 3600) |
| `MPD_BACKOFF_SECONDS` | 1800 | How long nobody asks MPD after it refused |

## Deploying

CI builds the loader's image from `dataloader/Dockerfile` (`build-dataloader`,
`$CI_REGISTRY_IMAGE/dataloader:<sha>`), and `terraform/loader.tf` runs it as
two CronJobs (`var.dataloader_image`, `python main.py --cadence ...`):

- **`-loader-daily`:** `var.loader_schedule`, 3:30am Chicago time.
- **`-loader-live`:** `var.loader_live_schedule`: every 5 minutes in
  production, hourly on staging (`environments/staging.tfvars`).
  `var.loader_mpd_min_interval_seconds` (production 300, staging 3600; at
  least 300) sets `APP__LOADER__MPD_MIN_INTERVAL_SECONDS`.

On staging, the live sources (calls, transit and weather alerts) and the
daily catch-up below are therefore hourly too.

There's also an optional ExternalSecret for keys. Put any of these in Vault
at `var.loader_secret_path`; every one is optional:

```
APP__LOADER__USAJOBS_API_KEY
APP__LOADER__USAJOBS_EMAIL
APP__LOADER__CAREERONESTOP_USER_ID
APP__LOADER__CAREERONESTOP_TOKEN
APP__LOADER__FBI_API_KEY
```

A live run also **catches up** any daily source that hasn't succeeded in
the last 24 hours (`dataloader/loader/schedule.py`), retrying a failing one
at most hourly. A fresh deploy or an empty database therefore seeds itself
within one live run (about 5 minutes; an hour on staging), and a night a
source was down fixes itself. To run the
daily job by hand anyway:

```bash
kubectl -n hacksgiving create job --from=cronjob/hacksgiving-api-loader-daily loader-now
kubectl -n hacksgiving logs -f job/loader-now
```

## Adding a source

1. Write the client in `dataloader/client/`. Keep fetching separate from
   parsing, and add a unit test on a recorded payload
   (`dataloader/tests/unit`). Fail loudly on error envelopes and changed
   pages; raise `RateLimited` when the server says you asked too often.
2. Add a `Loader` subclass in `dataloader/loader/<system>.py`
   (`OpportunityLoader`, `ResourceLoader` or `PublicDataLoader`) with its
   name, description, cadence, the tables it owns, `missing()` for its
   credentials, `min_interval()` if its server limits requests, and
   `fetch()`. List it in `dataloader/loader/sources.py` at its place in the
   order.
3. A new kind of data needs a table and a `<table>_sync` function in a new
   migration, an `Imported*` model in `dataloader/model/`, and an entry in
   `TABLES` in `dataloader/databridge/public_data.py`.
