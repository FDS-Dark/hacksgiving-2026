-- =============================================================================
-- Public data the loader imports (api/loader, docs/data-loader.md,
-- docs/real-data-sources.md): reviewed incidents (NIBRS), dispatch signals
-- (MPD and MFD calls), boundaries, MCTS transit, NWS weather alerts, CDC
-- PLACES measures and FBI crime trends, plus a log of loader runs so the app
-- can show each source's freshness.
--
-- Privacy, enforced here and not only in the loader:
--   * coordinates are stored rounded to 3 decimals (about 110 m) and served
--     publicly at 2 (about 1 km); exact points and addresses are never stored
--   * per-tract counts below 5 are suppressed in public reads
--   * dispatch signals carry a `public` flag (sensitive call types are kept
--     out of public reads) and expire
--
-- Every table is keyed by (source, external_id). Each <table>_sync takes the
-- rows as a JSON array and upserts them, stamping last_seen_at; a run then
-- calls public_data_retire to drop what the source no longer lists.
--
-- Same conventions as 0003 and 0005: app.<domain>_<verb>, p_ parameters,
-- SECURITY INVOKER.
-- =============================================================================

-- =============================================================================
-- LOADER RUNS (source health)
-- =============================================================================

CREATE TABLE app.loader_runs (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source      TEXT NOT NULL CONSTRAINT loader_runs_source_check CHECK (source ~ '^[a-z][a-z0-9_]{0,31}$'),
    target      TEXT NOT NULL,
    status      TEXT NOT NULL CONSTRAINT loader_runs_status_check CHECK (status IN ('ok', 'failed', 'skipped')),
    started_at  TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    fetched     INTEGER NOT NULL DEFAULT 0,
    written     INTEGER NOT NULL DEFAULT 0,
    retired     INTEGER NOT NULL DEFAULT 0,
    -- What went wrong, written to be safe to show (no response bodies).
    detail      TEXT NOT NULL DEFAULT '' CONSTRAINT loader_runs_detail_check CHECK (length(detail) <= 500)
);

CREATE INDEX loader_runs_source_finished_idx ON app.loader_runs (source, finished_at DESC);

-- Records one source's run and prunes runs older than 30 days.
CREATE FUNCTION app.loader_run_record(
    p_source TEXT, p_target TEXT, p_status TEXT, p_started_at TIMESTAMPTZ, p_fetched INTEGER,
    p_written INTEGER, p_retired INTEGER, p_detail TEXT)
RETURNS SETOF app.loader_runs
LANGUAGE sql AS $$
    DELETE FROM app.loader_runs r WHERE r.finished_at < now() - INTERVAL '30 days';
    INSERT INTO app.loader_runs AS r (source, target, status, started_at, fetched, written, retired, detail)
    VALUES (p_source, p_target, p_status, p_started_at, p_fetched, p_written, p_retired, left(coalesce(p_detail, ''), 500))
    RETURNING r.*;
$$;

-- Each source's latest run, and when it last succeeded.
CREATE FUNCTION app.loader_run_latest()
RETURNS TABLE (source TEXT, target TEXT, status TEXT, finished_at TIMESTAMPTZ, fetched INTEGER, detail TEXT,
               last_success_at TIMESTAMPTZ)
LANGUAGE sql STABLE AS $$
    SELECT DISTINCT ON (r.source) r.source, r.target, r.status, r.finished_at, r.fetched, r.detail,
           (SELECT max(s.finished_at) FROM app.loader_runs s WHERE s.source = r.source AND s.status = 'ok')
    FROM app.loader_runs r
    ORDER BY r.source, r.finished_at DESC
$$;

-- =============================================================================
-- BOUNDARIES
-- =============================================================================

CREATE TABLE app.geo_areas (
    source       TEXT NOT NULL,
    external_id  TEXT NOT NULL,
    kind         TEXT NOT NULL CONSTRAINT geo_areas_kind_check CHECK (kind IN (
                     'police_district', 'census_tract', 'neighborhood', 'aldermanic_district')),
    name         TEXT NOT NULL,
    properties   JSONB NOT NULL DEFAULT '{}',
    -- GeoJSON Polygon or MultiPolygon, WGS84.
    geometry     JSONB NOT NULL,
    min_lat      DOUBLE PRECISION NOT NULL,
    min_lon      DOUBLE PRECISION NOT NULL,
    max_lat      DOUBLE PRECISION NOT NULL,
    max_lon      DOUBLE PRECISION NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (source, external_id)
);

CREATE INDEX geo_areas_kind_idx ON app.geo_areas (kind);

CREATE FUNCTION app.geo_area_sync(p_source TEXT, p_rows JSONB, p_seen_at TIMESTAMPTZ)
RETURNS TABLE (written BIGINT, inserted BIGINT)
LANGUAGE sql AS $$
    WITH up AS (
        INSERT INTO app.geo_areas AS a (source, external_id, kind, name, properties, geometry,
                                        min_lat, min_lon, max_lat, max_lon, last_seen_at)
        SELECT p_source, x.external_id, x.kind, x.name, coalesce(x.properties, '{}'), x.geometry,
               x.min_lat, x.min_lon, x.max_lat, x.max_lon, p_seen_at
        FROM jsonb_to_recordset(p_rows) AS x (external_id TEXT, kind TEXT, name TEXT, properties JSONB,
                                              geometry JSONB, min_lat DOUBLE PRECISION, min_lon DOUBLE PRECISION,
                                              max_lat DOUBLE PRECISION, max_lon DOUBLE PRECISION)
        ON CONFLICT (source, external_id) DO UPDATE
        SET kind = EXCLUDED.kind, name = EXCLUDED.name, properties = EXCLUDED.properties,
            geometry = EXCLUDED.geometry, min_lat = EXCLUDED.min_lat, min_lon = EXCLUDED.min_lon,
            max_lat = EXCLUDED.max_lat, max_lon = EXCLUDED.max_lon, last_seen_at = EXCLUDED.last_seen_at
        RETURNING (xmax = 0) AS is_new
    )
    SELECT count(*), count(*) FILTER (WHERE is_new) FROM up
$$;

-- Areas of one kind, with their geometry (the loader tags points with them).
CREATE FUNCTION app.geo_area_list(p_kind TEXT)
RETURNS SETOF app.geo_areas
LANGUAGE sql STABLE AS $$
    SELECT a.* FROM app.geo_areas a WHERE a.kind = p_kind ORDER BY a.external_id
$$;

-- =============================================================================
-- REVIEWED INCIDENTS (NIBRS)
-- =============================================================================

CREATE TABLE app.external_incidents (
    source         TEXT NOT NULL,
    -- The source's case number: for deduplication, never shown.
    external_id    TEXT NOT NULL,
    incident_at    TIMESTAMPTZ NOT NULL,
    last_edited_at TIMESTAMPTZ,
    district       TEXT,
    tract_geoid    TEXT,
    latitude       DOUBLE PRECISION CONSTRAINT external_incidents_latitude_check CHECK (latitude BETWEEN -90 AND 90),
    longitude      DOUBLE PRECISION CONSTRAINT external_incidents_longitude_check CHECK (longitude BETWEEN -180 AND 180),
    -- NIBRS offense codes as the source gives them (09A, 13A, ...).
    offense_codes  TEXT[] NOT NULL DEFAULT '{}',
    weapons        TEXT[] NOT NULL DEFAULT '{}',
    last_seen_at   TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (source, external_id)
);

CREATE INDEX external_incidents_incident_at_idx ON app.external_incidents (incident_at DESC);
CREATE INDEX external_incidents_offense_codes_idx ON app.external_incidents USING gin (offense_codes);

CREATE FUNCTION app.external_incident_sync(p_source TEXT, p_rows JSONB, p_seen_at TIMESTAMPTZ)
RETURNS TABLE (written BIGINT, inserted BIGINT)
LANGUAGE sql AS $$
    WITH up AS (
        INSERT INTO app.external_incidents AS i (source, external_id, incident_at, last_edited_at, district,
                                                 tract_geoid, latitude, longitude, offense_codes, weapons,
                                                 last_seen_at)
        SELECT p_source, x.external_id, x.incident_at, x.last_edited_at, x.district, x.tract_geoid,
               round(x.latitude::NUMERIC, 3)::DOUBLE PRECISION, round(x.longitude::NUMERIC, 3)::DOUBLE PRECISION,
               coalesce(x.offense_codes, '{}'), coalesce(x.weapons, '{}'), p_seen_at
        FROM jsonb_to_recordset(p_rows) AS x (external_id TEXT, incident_at TIMESTAMPTZ, last_edited_at TIMESTAMPTZ,
                                              district TEXT, tract_geoid TEXT, latitude DOUBLE PRECISION,
                                              longitude DOUBLE PRECISION, offense_codes TEXT[], weapons TEXT[])
        ON CONFLICT (source, external_id) DO UPDATE
        SET incident_at = EXCLUDED.incident_at, last_edited_at = EXCLUDED.last_edited_at,
            district = EXCLUDED.district, tract_geoid = EXCLUDED.tract_geoid, latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude, offense_codes = EXCLUDED.offense_codes, weapons = EXCLUDED.weapons,
            last_seen_at = EXCLUDED.last_seen_at
        RETURNING (xmax = 0) AS is_new
    )
    SELECT count(*), count(*) FILTER (WHERE is_new) FROM up
$$;

-- Public points since p_since, generalized to 2 decimals (about 1 km).
CREATE FUNCTION app.public_incident_points(p_since TIMESTAMPTZ, p_limit INTEGER)
RETURNS TABLE (incident_at TIMESTAMPTZ, district TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION,
               offense_codes TEXT[], weapons TEXT[])
LANGUAGE sql STABLE AS $$
    SELECT i.incident_at, i.district,
           round(i.latitude::NUMERIC, 2)::DOUBLE PRECISION, round(i.longitude::NUMERIC, 2)::DOUBLE PRECISION,
           i.offense_codes, i.weapons
    FROM app.external_incidents i
    WHERE i.incident_at >= p_since AND i.incident_at <= now() + INTERVAL '1 day'
      AND i.latitude IS NOT NULL AND i.longitude IS NOT NULL
    ORDER BY i.incident_at DESC
    LIMIT p_limit
$$;

-- Counts per census tract since p_since (optionally one offense code), with
-- tracts under five records suppressed.
CREATE FUNCTION app.public_incident_tract_counts(p_since TIMESTAMPTZ, p_offense_code TEXT)
RETURNS TABLE (tract_geoid TEXT, tract_name TEXT, incidents BIGINT)
LANGUAGE sql STABLE AS $$
    SELECT i.tract_geoid, min(a.name), count(*)
    FROM app.external_incidents i
    LEFT JOIN app.geo_areas a ON a.kind = 'census_tract' AND a.external_id = 'census_tract:' || i.tract_geoid
    WHERE i.incident_at >= p_since AND i.incident_at <= now() + INTERVAL '1 day' AND i.tract_geoid IS NOT NULL
      AND (p_offense_code IS NULL OR p_offense_code = ANY (i.offense_codes))
    GROUP BY i.tract_geoid
    HAVING count(*) >= 5
    ORDER BY count(*) DESC
$$;

-- =============================================================================
-- DISPATCH SIGNALS (MPD and MFD calls)
-- =============================================================================

CREATE TABLE app.external_signals (
    source       TEXT NOT NULL,
    external_id  TEXT NOT NULL,
    occurred_at  TIMESTAMPTZ NOT NULL,
    category     TEXT NOT NULL,
    status       TEXT,
    -- Every status the call has been seen with.
    statuses     TEXT[] NOT NULL DEFAULT '{}',
    district     TEXT,
    city         TEXT,
    tract_geoid  TEXT,
    latitude     DOUBLE PRECISION CONSTRAINT external_signals_latitude_check CHECK (latitude BETWEEN -90 AND 90),
    longitude    DOUBLE PRECISION CONSTRAINT external_signals_longitude_check CHECK (longitude BETWEEN -180 AND 180),
    -- false for call types never shown publicly (domestic, sexual assault,
    -- self-harm, juvenile, welfare checks, missing persons, ...).
    public       BOOLEAN NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (source, external_id)
);

CREATE INDEX external_signals_occurred_at_idx ON app.external_signals (occurred_at DESC);

CREATE FUNCTION app.external_signal_sync(p_source TEXT, p_rows JSONB, p_seen_at TIMESTAMPTZ)
RETURNS TABLE (written BIGINT, inserted BIGINT)
LANGUAGE sql AS $$
    WITH up AS (
        INSERT INTO app.external_signals AS s (source, external_id, occurred_at, category, status, statuses,
                                               district, city, tract_geoid, latitude, longitude, public,
                                               first_seen_at, last_seen_at, expires_at)
        SELECT p_source, x.external_id, x.occurred_at, x.category, x.status,
               CASE WHEN x.status IS NULL THEN '{}' ELSE ARRAY[x.status] END,
               x.district, x.city, x.tract_geoid,
               round(x.latitude::NUMERIC, 3)::DOUBLE PRECISION, round(x.longitude::NUMERIC, 3)::DOUBLE PRECISION,
               x.public, p_seen_at, p_seen_at, x.expires_at
        FROM jsonb_to_recordset(p_rows) AS x (external_id TEXT, occurred_at TIMESTAMPTZ, category TEXT, status TEXT,
                                              district TEXT, city TEXT, tract_geoid TEXT, latitude DOUBLE PRECISION,
                                              longitude DOUBLE PRECISION, public BOOLEAN, expires_at TIMESTAMPTZ)
        ON CONFLICT (source, external_id) DO UPDATE
        SET category = EXCLUDED.category, status = EXCLUDED.status,
            statuses = CASE WHEN EXCLUDED.status IS NULL OR EXCLUDED.status = ANY (s.statuses) THEN s.statuses
                            ELSE s.statuses || EXCLUDED.status END,
            district = EXCLUDED.district, city = EXCLUDED.city,
            tract_geoid = coalesce(EXCLUDED.tract_geoid, s.tract_geoid),
            latitude = coalesce(EXCLUDED.latitude, s.latitude), longitude = coalesce(EXCLUDED.longitude, s.longitude),
            public = EXCLUDED.public, last_seen_at = EXCLUDED.last_seen_at, expires_at = EXCLUDED.expires_at
        RETURNING (xmax = 0) AS is_new
    )
    SELECT count(*), count(*) FILTER (WHERE is_new) FROM up
$$;

-- Public, unexpired signals since p_since, newest first, at 3 decimals.
CREATE FUNCTION app.public_signal_list(p_source TEXT, p_since TIMESTAMPTZ, p_limit INTEGER)
RETURNS TABLE (source TEXT, external_id TEXT, occurred_at TIMESTAMPTZ, category TEXT, status TEXT,
               district TEXT, city TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION)
LANGUAGE sql STABLE AS $$
    SELECT s.source, s.external_id, s.occurred_at, s.category, s.status, s.district, s.city, s.latitude, s.longitude
    FROM app.external_signals s
    WHERE s.public AND s.expires_at > now() AND s.occurred_at >= p_since
      AND (p_source IS NULL OR s.source = p_source)
    ORDER BY s.occurred_at DESC
    LIMIT p_limit
$$;

-- =============================================================================
-- TRANSIT (MCTS)
-- =============================================================================

CREATE TABLE app.transit_routes (
    source       TEXT NOT NULL,
    external_id  TEXT NOT NULL,
    short_name   TEXT,
    long_name    TEXT,
    color        TEXT,
    text_color   TEXT,
    url          TEXT,
    last_seen_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (source, external_id)
);

CREATE TABLE app.transit_stops (
    source       TEXT NOT NULL,
    external_id  TEXT NOT NULL,
    code         TEXT,
    name         TEXT NOT NULL,
    latitude     DOUBLE PRECISION NOT NULL,
    longitude    DOUBLE PRECISION NOT NULL,
    -- Route ids serving the stop.
    routes       TEXT[] NOT NULL DEFAULT '{}',
    last_seen_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (source, external_id)
);

CREATE INDEX transit_stops_lat_lon_idx ON app.transit_stops (latitude, longitude);

CREATE TABLE app.transit_alerts (
    source       TEXT NOT NULL,
    external_id  TEXT NOT NULL,
    header       TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    cause        TEXT,
    effect       TEXT,
    url          TEXT,
    routes       TEXT[] NOT NULL DEFAULT '{}',
    stops        TEXT[] NOT NULL DEFAULT '{}',
    active_from  TIMESTAMPTZ,
    active_until TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (source, external_id)
);

CREATE FUNCTION app.transit_route_sync(p_source TEXT, p_rows JSONB, p_seen_at TIMESTAMPTZ)
RETURNS TABLE (written BIGINT, inserted BIGINT)
LANGUAGE sql AS $$
    WITH up AS (
        INSERT INTO app.transit_routes AS r (source, external_id, short_name, long_name, color, text_color, url,
                                             last_seen_at)
        SELECT p_source, x.external_id, x.short_name, x.long_name, x.color, x.text_color, x.url, p_seen_at
        FROM jsonb_to_recordset(p_rows) AS x (external_id TEXT, short_name TEXT, long_name TEXT, color TEXT,
                                              text_color TEXT, url TEXT)
        ON CONFLICT (source, external_id) DO UPDATE
        SET short_name = EXCLUDED.short_name, long_name = EXCLUDED.long_name, color = EXCLUDED.color,
            text_color = EXCLUDED.text_color, url = EXCLUDED.url, last_seen_at = EXCLUDED.last_seen_at
        RETURNING (xmax = 0) AS is_new
    )
    SELECT count(*), count(*) FILTER (WHERE is_new) FROM up
$$;

CREATE FUNCTION app.transit_stop_sync(p_source TEXT, p_rows JSONB, p_seen_at TIMESTAMPTZ)
RETURNS TABLE (written BIGINT, inserted BIGINT)
LANGUAGE sql AS $$
    WITH up AS (
        INSERT INTO app.transit_stops AS t (source, external_id, code, name, latitude, longitude, routes,
                                            last_seen_at)
        SELECT p_source, x.external_id, x.code, x.name, x.latitude, x.longitude, coalesce(x.routes, '{}'), p_seen_at
        FROM jsonb_to_recordset(p_rows) AS x (external_id TEXT, code TEXT, name TEXT, latitude DOUBLE PRECISION,
                                              longitude DOUBLE PRECISION, routes TEXT[])
        ON CONFLICT (source, external_id) DO UPDATE
        SET code = EXCLUDED.code, name = EXCLUDED.name, latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude, routes = EXCLUDED.routes, last_seen_at = EXCLUDED.last_seen_at
        RETURNING (xmax = 0) AS is_new
    )
    SELECT count(*), count(*) FILTER (WHERE is_new) FROM up
$$;

CREATE FUNCTION app.transit_alert_sync(p_source TEXT, p_rows JSONB, p_seen_at TIMESTAMPTZ)
RETURNS TABLE (written BIGINT, inserted BIGINT)
LANGUAGE sql AS $$
    WITH up AS (
        INSERT INTO app.transit_alerts AS a (source, external_id, header, description, cause, effect, url, routes,
                                             stops, active_from, active_until, last_seen_at)
        SELECT p_source, x.external_id, x.header, coalesce(x.description, ''), x.cause, x.effect, x.url,
               coalesce(x.routes, '{}'), coalesce(x.stops, '{}'), x.active_from, x.active_until, p_seen_at
        FROM jsonb_to_recordset(p_rows) AS x (external_id TEXT, header TEXT, description TEXT, cause TEXT,
                                              effect TEXT, url TEXT, routes TEXT[], stops TEXT[],
                                              active_from TIMESTAMPTZ, active_until TIMESTAMPTZ)
        ON CONFLICT (source, external_id) DO UPDATE
        SET header = EXCLUDED.header, description = EXCLUDED.description, cause = EXCLUDED.cause,
            effect = EXCLUDED.effect, url = EXCLUDED.url, routes = EXCLUDED.routes, stops = EXCLUDED.stops,
            active_from = EXCLUDED.active_from, active_until = EXCLUDED.active_until,
            last_seen_at = EXCLUDED.last_seen_at
        RETURNING (xmax = 0) AS is_new
    )
    SELECT count(*), count(*) FILTER (WHERE is_new) FROM up
$$;

-- Stops within p_radius_m of a point, nearest first, with their routes'
-- names. A bounding box narrows the scan; the distance is haversine.
CREATE FUNCTION app.transit_stops_near(
    p_latitude DOUBLE PRECISION, p_longitude DOUBLE PRECISION, p_radius_m DOUBLE PRECISION, p_limit INTEGER)
RETURNS TABLE (stop_id TEXT, code TEXT, name TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION,
               distance_m DOUBLE PRECISION, routes TEXT[], route_names TEXT[])
LANGUAGE sql STABLE AS $$
    SELECT t.external_id, t.code, t.name, t.latitude, t.longitude, d.meters, t.routes,
           ARRAY(SELECT coalesce(r.short_name, r.external_id) FROM app.transit_routes r
                 WHERE r.source = t.source AND r.external_id = ANY (t.routes) ORDER BY 1)
    FROM app.transit_stops t
    CROSS JOIN LATERAL (
        SELECT 2 * 6371000 * asin(sqrt(
            power(sin(radians(t.latitude - p_latitude) / 2), 2)
            + cos(radians(p_latitude)) * cos(radians(t.latitude)) * power(sin(radians(t.longitude - p_longitude) / 2), 2)
        )) AS meters
    ) d
    WHERE t.latitude BETWEEN p_latitude - p_radius_m / 111000 AND p_latitude + p_radius_m / 111000
      AND t.longitude BETWEEN p_longitude - p_radius_m / 80000 AND p_longitude + p_radius_m / 80000
      AND d.meters <= p_radius_m
    ORDER BY d.meters
    LIMIT p_limit
$$;

-- Alerts in effect now; with p_routes, only those touching one of them.
CREATE FUNCTION app.transit_alert_active(p_routes TEXT[])
RETURNS SETOF app.transit_alerts
LANGUAGE sql STABLE AS $$
    SELECT a.* FROM app.transit_alerts a
    WHERE (a.active_from IS NULL OR a.active_from <= now()) AND (a.active_until IS NULL OR a.active_until > now())
      AND (p_routes IS NULL OR a.routes && p_routes)
    ORDER BY a.active_from DESC NULLS LAST
$$;

-- =============================================================================
-- WEATHER ALERTS (NWS)
-- =============================================================================

CREATE TABLE app.weather_alerts (
    source       TEXT NOT NULL,
    external_id  TEXT NOT NULL,
    event        TEXT NOT NULL,
    headline     TEXT,
    severity     TEXT,
    urgency      TEXT,
    certainty    TEXT,
    area         TEXT,
    description  TEXT NOT NULL DEFAULT '',
    instruction  TEXT,
    url          TEXT,
    effective_at TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (source, external_id)
);

CREATE FUNCTION app.weather_alert_sync(p_source TEXT, p_rows JSONB, p_seen_at TIMESTAMPTZ)
RETURNS TABLE (written BIGINT, inserted BIGINT)
LANGUAGE sql AS $$
    WITH up AS (
        INSERT INTO app.weather_alerts AS w (source, external_id, event, headline, severity, urgency, certainty,
                                             area, description, instruction, url, effective_at, expires_at,
                                             last_seen_at)
        SELECT p_source, x.external_id, x.event, x.headline, x.severity, x.urgency, x.certainty, x.area,
               coalesce(x.description, ''), x.instruction, x.url, x.effective_at, x.expires_at, p_seen_at
        FROM jsonb_to_recordset(p_rows) AS x (external_id TEXT, event TEXT, headline TEXT, severity TEXT,
                                              urgency TEXT, certainty TEXT, area TEXT, description TEXT,
                                              instruction TEXT, url TEXT, effective_at TIMESTAMPTZ,
                                              expires_at TIMESTAMPTZ)
        ON CONFLICT (source, external_id) DO UPDATE
        SET event = EXCLUDED.event, headline = EXCLUDED.headline, severity = EXCLUDED.severity,
            urgency = EXCLUDED.urgency, certainty = EXCLUDED.certainty, area = EXCLUDED.area,
            description = EXCLUDED.description, instruction = EXCLUDED.instruction, url = EXCLUDED.url,
            effective_at = EXCLUDED.effective_at, expires_at = EXCLUDED.expires_at,
            last_seen_at = EXCLUDED.last_seen_at
        RETURNING (xmax = 0) AS is_new
    )
    SELECT count(*), count(*) FILTER (WHERE is_new) FROM up
$$;

CREATE FUNCTION app.weather_alert_active()
RETURNS SETOF app.weather_alerts
LANGUAGE sql STABLE AS $$
    SELECT w.* FROM app.weather_alerts w
    WHERE w.expires_at IS NULL OR w.expires_at > now()
    ORDER BY w.effective_at DESC NULLS LAST
$$;

-- =============================================================================
-- COMMUNITY MEASURES (CDC PLACES) AND CRIME TRENDS (FBI)
-- =============================================================================

CREATE TABLE app.community_measures (
    source       TEXT NOT NULL,
    external_id  TEXT NOT NULL,
    tract_geoid  TEXT NOT NULL,
    measure_id   TEXT NOT NULL,
    measure      TEXT NOT NULL,
    year         INTEGER NOT NULL,
    value        DOUBLE PRECISION,
    low          DOUBLE PRECISION,
    high         DOUBLE PRECISION,
    population   INTEGER,
    last_seen_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (source, external_id)
);

CREATE INDEX community_measures_tract_idx ON app.community_measures (tract_geoid);

CREATE FUNCTION app.community_measure_sync(p_source TEXT, p_rows JSONB, p_seen_at TIMESTAMPTZ)
RETURNS TABLE (written BIGINT, inserted BIGINT)
LANGUAGE sql AS $$
    WITH up AS (
        INSERT INTO app.community_measures AS m (source, external_id, tract_geoid, measure_id, measure, year, value,
                                                 low, high, population, last_seen_at)
        SELECT p_source, x.external_id, x.tract_geoid, x.measure_id, x.measure, x.year, x.value, x.low, x.high,
               x.population, p_seen_at
        FROM jsonb_to_recordset(p_rows) AS x (external_id TEXT, tract_geoid TEXT, measure_id TEXT, measure TEXT,
                                              year INTEGER, value DOUBLE PRECISION, low DOUBLE PRECISION,
                                              high DOUBLE PRECISION, population INTEGER)
        ON CONFLICT (source, external_id) DO UPDATE
        SET tract_geoid = EXCLUDED.tract_geoid, measure_id = EXCLUDED.measure_id, measure = EXCLUDED.measure,
            year = EXCLUDED.year, value = EXCLUDED.value, low = EXCLUDED.low, high = EXCLUDED.high,
            population = EXCLUDED.population, last_seen_at = EXCLUDED.last_seen_at
        RETURNING (xmax = 0) AS is_new
    )
    SELECT count(*), count(*) FILTER (WHERE is_new) FROM up
$$;

-- One tract's measures, or with p_tract_geoid NULL the county's tracts for
-- one measure (p_measure_id).
CREATE FUNCTION app.community_measure_list(p_tract_geoid TEXT, p_measure_id TEXT)
RETURNS SETOF app.community_measures
LANGUAGE sql STABLE AS $$
    SELECT m.* FROM app.community_measures m
    WHERE (p_tract_geoid IS NULL OR m.tract_geoid = p_tract_geoid)
      AND (p_measure_id IS NULL OR m.measure_id = p_measure_id)
    ORDER BY m.tract_geoid, m.measure_id, m.year DESC
$$;

CREATE TABLE app.crime_trends (
    source       TEXT NOT NULL,
    external_id  TEXT NOT NULL,
    offense      TEXT NOT NULL,
    -- 'actual' (counts) or 'rate' (per 100,000).
    measure      TEXT NOT NULL CONSTRAINT crime_trends_measure_check CHECK (measure IN ('actual', 'rate')),
    series       TEXT NOT NULL,
    month        DATE NOT NULL,
    value        DOUBLE PRECISION,
    source_refreshed_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (source, external_id)
);

CREATE FUNCTION app.crime_trend_sync(p_source TEXT, p_rows JSONB, p_seen_at TIMESTAMPTZ)
RETURNS TABLE (written BIGINT, inserted BIGINT)
LANGUAGE sql AS $$
    WITH up AS (
        INSERT INTO app.crime_trends AS c (source, external_id, offense, measure, series, month, value,
                                           source_refreshed_at, last_seen_at)
        SELECT p_source, x.external_id, x.offense, x.measure, x.series, x.month, x.value, x.source_refreshed_at,
               p_seen_at
        FROM jsonb_to_recordset(p_rows) AS x (external_id TEXT, offense TEXT, measure TEXT, series TEXT, month DATE,
                                              value DOUBLE PRECISION, source_refreshed_at TIMESTAMPTZ)
        ON CONFLICT (source, external_id) DO UPDATE
        SET offense = EXCLUDED.offense, measure = EXCLUDED.measure, series = EXCLUDED.series,
            month = EXCLUDED.month, value = EXCLUDED.value, source_refreshed_at = EXCLUDED.source_refreshed_at,
            last_seen_at = EXCLUDED.last_seen_at
        RETURNING (xmax = 0) AS is_new
    )
    SELECT count(*), count(*) FILTER (WHERE is_new) FROM up
$$;

CREATE FUNCTION app.crime_trend_list(p_offense TEXT)
RETURNS SETOF app.crime_trends
LANGUAGE sql STABLE AS $$
    SELECT c.* FROM app.crime_trends c
    WHERE p_offense IS NULL OR c.offense = p_offense
    ORDER BY c.offense, c.measure, c.series, c.month
$$;

-- =============================================================================
-- RETIRING
-- =============================================================================

-- After a clean run of one source: delete its rows that run didn't see.
-- Dispatch signals are kept until they expire (the calls page only shows
-- the last few hours), and incidents only within p_window_start (the
-- loader fetches a recent window, not the whole history). Returns how many
-- rows went.
CREATE FUNCTION app.public_data_retire(
    p_table TEXT, p_source TEXT, p_seen_before TIMESTAMPTZ, p_window_start TIMESTAMPTZ DEFAULT NULL)
RETURNS TABLE (retired BIGINT)
LANGUAGE plpgsql AS $$
DECLARE
    v_count BIGINT;
BEGIN
    IF p_table = 'external_signals' THEN
        DELETE FROM app.external_signals s WHERE s.source = p_source AND s.expires_at <= now();
    ELSIF p_table = 'external_incidents' THEN
        DELETE FROM app.external_incidents i
        WHERE i.source = p_source AND i.last_seen_at < p_seen_before
          AND (p_window_start IS NULL OR i.incident_at >= p_window_start);
    ELSIF p_table IN ('geo_areas', 'transit_routes', 'transit_stops', 'transit_alerts', 'weather_alerts',
                      'community_measures', 'crime_trends') THEN
        EXECUTE format('DELETE FROM app.%I t WHERE t.source = $1 AND t.last_seen_at < $2', p_table)
        USING p_source, p_seen_before;
    ELSE
        RAISE EXCEPTION 'Not a public data table: %', p_table USING ERRCODE = '22023';
    END IF;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN QUERY SELECT v_count;
END
$$;
