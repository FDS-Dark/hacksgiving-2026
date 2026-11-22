-- =============================================================================
-- Case places and Insights patterns (see 0020_case_places.py).
--
-- app.case_places: where each case is, worked out by the worker's upkeep
-- (services/place.py) from the case's own coordinates or its free-text
-- location (a debrief's "27th and Center", Ava's "Sherman Park"). It is a
-- derived layer: app.cases is never changed, and a case whose location or
-- coordinates change is placed again.
--
-- Privacy, as for the loader's data (docs/data-loader.md):
--   * points are stored rounded to 3 decimals (about 110 m);
--   * `label` is what a dashboard may show for the spot: a block or an
--     intersection, or a neighborhood. Never a house number: the placer
--     sends the locator only the block (2716 N 27th St -> 2700 N 27th St).
--
-- The insights_* functions serve the staff Insights screen (date and
-- police-district filters, and "Pattern spotted"). They count cases opened
-- in [p_start, p_end).
--
-- Same conventions as 0015-0018: app.<domain>_<verb>, p_ parameters, no row
-- means not found, SECURITY INVOKER (0002's default privileges cover the
-- new objects).
-- =============================================================================

CREATE TABLE app.case_places (
    case_id         UUID PRIMARY KEY REFERENCES app.cases (id) ON DELETE CASCADE,
    -- placed: a point and its areas. unplaced: nothing in the case to place,
    -- or the locator had no confident answer. Tried again only when the
    -- case's location or coordinates change.
    status          TEXT NOT NULL CONSTRAINT case_places_status_check CHECK (status IN ('placed', 'unplaced')),
    -- case: the case's own coordinates. neighborhood: a neighborhood named
    -- in its location. geocoder: the City's locator (a block or intersection).
    source          TEXT CONSTRAINT case_places_source_check CHECK (source IN ('case', 'neighborhood', 'geocoder')),
    latitude        DOUBLE PRECISION CONSTRAINT case_places_latitude_check CHECK (latitude BETWEEN -90 AND 90),
    longitude       DOUBLE PRECISION CONSTRAINT case_places_longitude_check CHECK (longitude BETWEEN -180 AND 180),
    label           TEXT CONSTRAINT case_places_label_check CHECK (length(label) <= 120),
    -- The areas the point falls in: geo_areas keys without the kind prefix.
    police_district TEXT,
    tract_geoid     TEXT,
    neighborhood    TEXT,
    -- The case's values this was worked out from.
    seen_location   TEXT,
    seen_latitude   DOUBLE PRECISION,
    seen_longitude  DOUBLE PRECISION,
    placed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT case_places_point CHECK ((status = 'placed') = (latitude IS NOT NULL AND longitude IS NOT NULL))
);

CREATE INDEX case_places_district_idx ON app.case_places (police_district);

-- Cases from the last 180 days with no place yet, or whose location or
-- coordinates changed since; newest first.
CREATE FUNCTION app.case_place_pending(p_limit INT)
RETURNS TABLE (case_id UUID, location TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION)
LANGUAGE sql STABLE AS $$
    SELECT c.id, c.location, c.latitude, c.longitude
    FROM app.cases c
    LEFT JOIN app.case_places p ON p.case_id = c.id
    WHERE c.created_at >= now() - INTERVAL '180 days'
      AND (p.case_id IS NULL
           OR p.seen_location IS DISTINCT FROM c.location
           OR p.seen_latitude IS DISTINCT FROM c.latitude
           OR p.seen_longitude IS DISTINCT FROM c.longitude)
    ORDER BY c.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500)
$$;

-- Writes a case's place (rounding the point). No row when the case is gone.
CREATE FUNCTION app.case_place_save(
    p_case_id UUID, p_status TEXT, p_source TEXT, p_latitude DOUBLE PRECISION, p_longitude DOUBLE PRECISION,
    p_label TEXT, p_police_district TEXT, p_tract_geoid TEXT, p_neighborhood TEXT,
    p_seen_location TEXT, p_seen_latitude DOUBLE PRECISION, p_seen_longitude DOUBLE PRECISION)
RETURNS SETOF app.case_places
LANGUAGE sql AS $$
    INSERT INTO app.case_places AS p
        (case_id, status, source, latitude, longitude, label, police_district, tract_geoid, neighborhood,
         seen_location, seen_latitude, seen_longitude)
    SELECT c.id, p_status, p_source, round(p_latitude::numeric, 3)::float8, round(p_longitude::numeric, 3)::float8,
           left(p_label, 120), p_police_district, p_tract_geoid, p_neighborhood,
           p_seen_location, p_seen_latitude, p_seen_longitude
    FROM app.cases c WHERE c.id = p_case_id
    ON CONFLICT (case_id) DO UPDATE
    SET status = EXCLUDED.status, source = EXCLUDED.source, latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude, label = EXCLUDED.label, police_district = EXCLUDED.police_district,
        tract_geoid = EXCLUDED.tract_geoid, neighborhood = EXCLUDED.neighborhood,
        seen_location = EXCLUDED.seen_location, seen_latitude = EXCLUDED.seen_latitude,
        seen_longitude = EXCLUDED.seen_longitude, placed_at = now()
    RETURNING p.*
$$;

-- =============================================================================
-- INSIGHTS
-- =============================================================================

-- The police districts, for the Insights filter.
CREATE FUNCTION app.insights_districts()
RETURNS TABLE (key TEXT, name TEXT)
LANGUAGE sql STABLE AS $$
    SELECT split_part(a.external_id, ':', 2), a.name
    FROM app.geo_areas a
    WHERE a.kind = 'police_district'
    ORDER BY length(split_part(a.external_id, ':', 2)), split_part(a.external_id, ':', 2)
$$;

-- Cases opened in the period (in one police district, when given), and
-- what became of them.
CREATE FUNCTION app.insights_totals(p_start TIMESTAMPTZ, p_end TIMESTAMPTZ, p_district TEXT)
RETURNS TABLE (opened BIGINT, still_open BIGINT, resolved BIGINT, urgent BIGINT, placed BIGINT,
               avg_resolution_hours DOUBLE PRECISION)
LANGUAGE sql STABLE AS $$
    SELECT count(*),
           count(*) FILTER (WHERE c.status NOT IN ('resolved', 'closed')),
           count(*) FILTER (WHERE c.status IN ('resolved', 'closed')),
           count(*) FILTER (WHERE c.priority IN ('high', 'critical')),
           count(*) FILTER (WHERE p.status = 'placed'),
           (avg(extract(epoch FROM c.resolved_at - c.created_at)) FILTER (WHERE c.resolved_at IS NOT NULL)) / 3600.0
    FROM app.cases c
    LEFT JOIN app.case_places p ON p.case_id = c.id
    WHERE c.created_at >= p_start AND c.created_at < p_end
      AND (p_district IS NULL OR p.police_district = p_district)
$$;

CREATE FUNCTION app.insights_by_category(p_start TIMESTAMPTZ, p_end TIMESTAMPTZ, p_district TEXT)
RETURNS TABLE (category TEXT, total BIGINT, active BIGINT)
LANGUAGE sql STABLE AS $$
    SELECT c.category, count(*), count(*) FILTER (WHERE c.status NOT IN ('resolved', 'closed'))
    FROM app.cases c
    LEFT JOIN app.case_places p ON p.case_id = c.id
    WHERE c.created_at >= p_start AND c.created_at < p_end
      AND (p_district IS NULL OR p.police_district = p_district)
    GROUP BY c.category
    ORDER BY count(*) DESC, c.category
$$;

-- "Pattern spotted": placed cases opened in the period that cluster.
--   spot:         at least p_min_cases at one ~110 m cell (repeat calls at
--                 one intersection or block).
--   neighborhood: at least p_min_cases in one neighborhood, and at least
--                 twice as many as in the period of the same length before.
-- `label` is the spot's commonest place label (NULL for a neighborhood:
-- the API words it from the name). For each: how many, how many the
-- period before, the commonest need, and
-- how many came in at night (6 PM to 6 AM, local time) and on weekend
-- nights (Friday and Saturday nights). The newest cases first in case_ids.
CREATE FUNCTION app.insights_patterns(
    p_start TIMESTAMPTZ, p_end TIMESTAMPTZ, p_district TEXT, p_timezone TEXT, p_min_cases INT)
RETURNS TABLE (
    kind TEXT, key TEXT, label TEXT, neighborhood TEXT, police_district TEXT,
    total BIGINT, prior_total BIGINT, top_category TEXT, top_category_total BIGINT,
    night_total BIGINT, weekend_night_total BIGINT, first_at TIMESTAMPTZ, last_at TIMESTAMPTZ,
    case_ids UUID[], case_numbers BIGINT[])
LANGUAGE sql STABLE AS $$
    WITH base AS (
        SELECT c.id, c.number, c.category, c.created_at, p.label, p.neighborhood, p.police_district,
               round(p.latitude::numeric, 3) || ',' || round(p.longitude::numeric, 3) AS cell,
               c.created_at >= p_start AS current,
               extract(hour FROM c.created_at AT TIME ZONE p_timezone) AS hour,
               extract(isodow FROM c.created_at AT TIME ZONE p_timezone) AS dow
        FROM app.cases c
        JOIN app.case_places p ON p.case_id = c.id AND p.status = 'placed'
        WHERE c.created_at >= p_start - (p_end - p_start) AND c.created_at < p_end
          AND (p_district IS NULL OR p.police_district = p_district)
    ),
    tagged AS (
        SELECT b.*,
               (b.hour >= 18 OR b.hour < 6) AS night,
               ((b.dow IN (5, 6) AND b.hour >= 18) OR (b.dow IN (6, 7) AND b.hour < 6)) AS weekend_night
        FROM base b
    ),
    grouped AS (
        SELECT 'spot' AS kind, t.cell AS key, t.* FROM tagged t
        UNION ALL
        SELECT 'neighborhood', t.neighborhood, t.* FROM tagged t WHERE t.neighborhood IS NOT NULL
    ),
    groups AS (
        SELECT g.kind, g.key,
               count(*) FILTER (WHERE g.current) AS total,
               count(*) FILTER (WHERE NOT g.current) AS prior_total,
               mode() WITHIN GROUP (ORDER BY g.label) FILTER (WHERE g.current) AS label,
               mode() WITHIN GROUP (ORDER BY g.neighborhood) FILTER (WHERE g.current) AS neighborhood,
               mode() WITHIN GROUP (ORDER BY g.police_district) FILTER (WHERE g.current) AS police_district,
               mode() WITHIN GROUP (ORDER BY g.category) FILTER (WHERE g.current) AS top_category,
               count(*) FILTER (WHERE g.current AND g.night) AS night_total,
               count(*) FILTER (WHERE g.current AND g.weekend_night) AS weekend_night_total,
               min(g.created_at) FILTER (WHERE g.current) AS first_at,
               max(g.created_at) FILTER (WHERE g.current) AS last_at,
               array_agg(g.id ORDER BY g.created_at DESC) FILTER (WHERE g.current) AS case_ids,
               array_agg(g.number ORDER BY g.created_at DESC) FILTER (WHERE g.current) AS case_numbers
        FROM grouped g
        GROUP BY g.kind, g.key
    )
    SELECT g.kind, g.key, CASE WHEN g.kind = 'spot' THEN g.label END, g.neighborhood, g.police_district,
           g.total, g.prior_total, g.top_category,
           (SELECT count(*) FROM tagged t
            WHERE t.current AND t.category = g.top_category
              AND (CASE WHEN g.kind = 'spot' THEN t.cell ELSE t.neighborhood END) = g.key),
           g.night_total, g.weekend_night_total, g.first_at, g.last_at, g.case_ids, g.case_numbers
    FROM groups g
    WHERE g.total >= GREATEST(COALESCE(p_min_cases, 3), 2)
      AND (g.kind = 'spot' OR g.total >= 2 * g.prior_total)
    ORDER BY (g.kind = 'spot') DESC, g.total DESC, g.last_at DESC
    LIMIT 10
$$;
