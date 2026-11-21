-- =============================================================================
-- Milwaukee Police Department calls for service (see 0011_mpd_calls.py).
--
-- api/scripts/ingest_mpd_calls.py scrapes https://itmdapps.milwaukee.gov/MPDCallData/
-- every two minutes (a Kubernetes CronJob, terraform/main.tf) and upserts what
-- it finds here. The page shows calls 30-90 minutes after dispatch and
-- refreshes every five minutes, so most runs see rows already stored; the
-- call number is the key and a later sighting updates the status.
--
-- Locations: `location` is the street text the city published (needed to
-- geocode and to re-derive `block`). The API never returns it; it returns
-- `block` ("2800 block of S GREELEY ST") and coordinates rounded to three
-- decimals (~110 m). Geocoder answers, misses included, are cached in
-- app.mpd_geocodes so each address is looked up once.
--
-- Same conventions as 0003 and 0005: app.<domain>_<verb>, p_ parameters,
-- SECURITY INVOKER.
-- =============================================================================

CREATE TABLE app.mpd_calls (
    call_number   TEXT PRIMARY KEY CONSTRAINT mpd_calls_call_number_check CHECK (call_number ~ '^[A-Z0-9]{4,20}$'),
    dispatched_at TIMESTAMPTZ NOT NULL,
    location      TEXT NOT NULL,
    block         TEXT NOT NULL,
    district      TEXT NOT NULL,
    nature        TEXT NOT NULL,
    status        TEXT NOT NULL,
    latitude      DOUBLE PRECISION,
    longitude     DOUBLE PRECISION,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT mpd_calls_coordinates_check CHECK ((latitude IS NULL) = (longitude IS NULL))
);

CREATE INDEX mpd_calls_dispatched_at_idx ON app.mpd_calls (dispatched_at DESC);

-- One row per normalized address. NULL coordinates: the geocoder found
-- nothing (a highway segment, a typo); retried after a week.
CREATE TABLE app.mpd_geocodes (
    address     TEXT PRIMARY KEY,
    latitude    DOUBLE PRECISION,
    longitude   DOUBLE PRECISION,
    geocoded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per ingestion run, so the API can say how fresh the data is and
-- an operator can see failures. Pruned with the calls.
CREATE TABLE app.mpd_ingest_runs (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ran_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    ok         BOOLEAN NOT NULL,
    rows_seen  INTEGER NOT NULL DEFAULT 0,
    new_calls  INTEGER NOT NULL DEFAULT 0,
    error      TEXT
);

CREATE INDEX mpd_ingest_runs_ran_at_idx ON app.mpd_ingest_runs (ran_at DESC);

-- Upserts a scrape. p_calls is a JSON array of objects with the table's
-- columns (call_number .. longitude). Returns how many call numbers were new.
-- Coordinates already stored are kept when a later sighting has none.
CREATE FUNCTION app.mpd_calls_upsert(p_calls TEXT)
RETURNS TABLE (new_calls INTEGER)
LANGUAGE sql AS $$
    WITH incoming AS (
        SELECT * FROM jsonb_to_recordset(CAST(p_calls AS JSONB)) AS c(
            call_number TEXT, dispatched_at TIMESTAMPTZ, location TEXT, block TEXT, district TEXT,
            nature TEXT, status TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION)
    ), written AS (
        INSERT INTO app.mpd_calls AS m (call_number, dispatched_at, location, block, district, nature, status,
                                        latitude, longitude)
        SELECT call_number, dispatched_at, location, block, district, nature, status, latitude, longitude
        FROM incoming
        ON CONFLICT (call_number) DO UPDATE SET
            status       = EXCLUDED.status,
            nature       = EXCLUDED.nature,
            district     = EXCLUDED.district,
            latitude     = COALESCE(EXCLUDED.latitude, m.latitude),
            longitude    = COALESCE(EXCLUDED.longitude, m.longitude),
            last_seen_at = now()
        RETURNING (xmax = 0) AS inserted
    )
    SELECT count(*) FILTER (WHERE inserted)::INTEGER FROM written
$$;

-- Calls dispatched in the last p_hours, newest first, at most p_limit.
CREATE FUNCTION app.mpd_calls_recent(p_hours INTEGER, p_limit INTEGER)
RETURNS SETOF app.mpd_calls
LANGUAGE sql STABLE AS $$
    SELECT m.* FROM app.mpd_calls m
    WHERE m.dispatched_at >= now() - make_interval(hours => p_hours)
    ORDER BY m.dispatched_at DESC, m.call_number DESC
    LIMIT p_limit
$$;

-- Cached geocoder answers for these addresses. A miss older than a week is
-- left out, so the caller asks again.
CREATE FUNCTION app.mpd_geocode_lookup(p_addresses TEXT[])
RETURNS SETOF app.mpd_geocodes
LANGUAGE sql STABLE AS $$
    SELECT g.* FROM app.mpd_geocodes g
    WHERE g.address = ANY (p_addresses)
      AND (g.latitude IS NOT NULL OR g.geocoded_at > now() - interval '7 days')
$$;

CREATE FUNCTION app.mpd_geocode_save(p_address TEXT, p_latitude DOUBLE PRECISION, p_longitude DOUBLE PRECISION)
RETURNS SETOF app.mpd_geocodes
LANGUAGE sql AS $$
    INSERT INTO app.mpd_geocodes AS g (address, latitude, longitude)
    VALUES (p_address, p_latitude, p_longitude)
    ON CONFLICT (address) DO UPDATE SET
        latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, geocoded_at = now()
    RETURNING g.*
$$;

CREATE FUNCTION app.mpd_ingest_record(p_ok BOOLEAN, p_rows_seen INTEGER, p_new_calls INTEGER, p_error TEXT)
RETURNS SETOF app.mpd_ingest_runs
LANGUAGE sql AS $$
    INSERT INTO app.mpd_ingest_runs AS r (ok, rows_seen, new_calls, error)
    VALUES (p_ok, p_rows_seen, p_new_calls, left(p_error, 1000))
    RETURNING r.*
$$;

-- The latest run, and the latest one that worked (no rows before the first run).
CREATE FUNCTION app.mpd_ingest_status()
RETURNS TABLE (last_run_at TIMESTAMPTZ, last_run_ok BOOLEAN, last_success_at TIMESTAMPTZ)
LANGUAGE sql STABLE AS $$
    SELECT
        (SELECT r.ran_at FROM app.mpd_ingest_runs r ORDER BY r.ran_at DESC LIMIT 1),
        (SELECT r.ok FROM app.mpd_ingest_runs r ORDER BY r.ran_at DESC LIMIT 1),
        (SELECT max(r.ran_at) FROM app.mpd_ingest_runs r WHERE r.ok)
$$;

-- Drops calls dispatched, and runs recorded, more than p_keep_days ago.
-- Returns how many calls went.
CREATE FUNCTION app.mpd_calls_prune(p_keep_days INTEGER)
RETURNS TABLE (deleted INTEGER)
LANGUAGE sql AS $$
    WITH runs AS (
        DELETE FROM app.mpd_ingest_runs r WHERE r.ran_at < now() - make_interval(days => p_keep_days)
    ), calls AS (
        DELETE FROM app.mpd_calls m WHERE m.dispatched_at < now() - make_interval(days => p_keep_days)
        RETURNING 1
    )
    SELECT count(*)::INTEGER FROM calls
$$;
