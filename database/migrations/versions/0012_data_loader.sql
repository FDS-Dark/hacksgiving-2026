-- =============================================================================
-- The data loader: opportunities and resources imported by a batch job
-- (api/loader, see 0012_data_loader.py and docs/data-loader.md).
--
-- Opportunities now come two ways:
--   * manual   posted by ComForce staff in the app (source = 'manual'). These
--              are the ones staff vouch for, usually open to people who have a
--              harder time getting hired the usual way; `audiences` says who.
--   * imported pulled nightly from a public source (source = 'usajobs', ...),
--              keyed by the source's own id (external_id).
-- Resources get the same source/external_id columns.
--
-- Duplicates: every row has a dedupe_key, a normalized fingerprint (kind,
-- title, organization and city for opportunities; the name for resources).
-- The sync functions skip an import whose fingerprint matches another open
-- row, from any source, staff postings included. The loader runs sources in
-- priority order, so the first source to bring a posting keeps it.
--
-- The loader never deletes. A row its source stops listing is closed
-- (active = false); referrals and history keep pointing at it. A posting
-- staff close stays closed (closed_by_staff) even if the source still lists
-- it.
--
-- Same conventions as 0003 and 0005: app.<domain>_<verb>, p_ parameters, no
-- row means not found, SECURITY INVOKER. New parameters on replaced
-- functions come last with defaults, so an API still running the previous
-- release keeps working while this migrates.
-- =============================================================================

-- =============================================================================
-- FINGERPRINTS (immutable, so they can back generated columns)
-- =============================================================================

-- Lowercase letters and digits only: "Line Cook (PT)" and "line cook - pt"
-- are the same title.
CREATE FUNCTION app.loader_normalize(p_value TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT regexp_replace(lower(coalesce(p_value, '')), '[^a-z0-9]+', '', 'g')
$$;

-- Kind, title, organization and the city (the location up to its first
-- comma: "Milwaukee, WI" and "Milwaukee, Wisconsin" match).
CREATE FUNCTION app.opportunity_fingerprint(p_kind TEXT, p_title TEXT, p_organization TEXT, p_location TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT p_kind || '|' || app.loader_normalize(p_title) || '|' || app.loader_normalize(p_organization)
        || '|' || app.loader_normalize(split_part(coalesce(p_location, ''), ',', 1))
$$;

CREATE FUNCTION app.resource_fingerprint(p_name TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT app.loader_normalize(p_name)
$$;

-- =============================================================================
-- OPPORTUNITIES
-- =============================================================================

ALTER TABLE app.opportunities DROP CONSTRAINT opportunities_kind_check;
ALTER TABLE app.opportunities
    ADD CONSTRAINT opportunities_kind_check CHECK (kind IN ('volunteer', 'job', 'education')),
    ADD COLUMN source          TEXT NOT NULL DEFAULT 'manual'
                               CONSTRAINT opportunities_source_check CHECK (source ~ '^[a-z][a-z0-9_]{0,31}$'),
    ADD COLUMN external_id     TEXT CONSTRAINT opportunities_external_id_check CHECK (length(external_id) <= 200),
    -- Who a posting is open to. Staff tag the manual ones; an import is
    -- tagged when its source says so (CareerOneStop's fair-chance flag).
    ADD COLUMN audiences       TEXT[] NOT NULL DEFAULT '{}'
                               CONSTRAINT opportunities_audiences_check CHECK (audiences <@ ARRAY[
                                   'second_chance', 'unhoused', 'no_experience', 'no_id_required', 'youth']::TEXT[]),
    -- Mostly for education: free, low_cost or paid; NULL when unknown.
    ADD COLUMN cost            TEXT CONSTRAINT opportunities_cost_check CHECK (cost IN ('free', 'low_cost', 'paid')),
    -- The source's own dates: when it was posted, and when applications close.
    ADD COLUMN posted_at       TIMESTAMPTZ,
    ADD COLUMN expires_at      TIMESTAMPTZ,
    -- The last loader run whose source still listed it.
    ADD COLUMN last_seen_at    TIMESTAMPTZ,
    ADD COLUMN closed_by_staff BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN dedupe_key      TEXT GENERATED ALWAYS AS
                               (app.opportunity_fingerprint(kind, title, organization, location)) STORED,
    -- Staff postings have no external id; every import has one.
    ADD CONSTRAINT opportunities_external_id_source CHECK ((source = 'manual') = (external_id IS NULL)),
    ADD CONSTRAINT opportunities_source_external_id_key UNIQUE (source, external_id);

CREATE INDEX opportunities_open_dedupe_idx ON app.opportunities (dedupe_key) WHERE active;

-- Open postings first; among them staff postings, then the newest. A
-- posting past its closing date counts as closed. p_audience keeps the
-- postings tagged for that audience; p_origin is 'manual' (staff postings),
-- 'imported', or NULL for both. p_limit NULL means no limit.
DROP FUNCTION app.opportunity_list(TEXT, TEXT, BOOLEAN);

CREATE FUNCTION app.opportunity_list(
    p_query TEXT, p_kind TEXT, p_include_closed BOOLEAN,
    p_audience TEXT DEFAULT NULL, p_origin TEXT DEFAULT NULL, p_limit INTEGER DEFAULT NULL)
RETURNS SETOF app.opportunities
LANGUAGE sql STABLE AS $$
    SELECT o.* FROM app.opportunities o
    WHERE (p_include_closed OR (o.active AND (o.expires_at IS NULL OR o.expires_at > now())))
      AND (p_kind IS NULL OR o.kind = p_kind)
      AND (p_audience IS NULL OR p_audience = ANY (o.audiences))
      AND (p_origin IS NULL
           OR (p_origin = 'manual' AND o.source = 'manual')
           OR (p_origin = 'imported' AND o.source <> 'manual'))
      AND (p_query IS NULL OR p_query = ''
           OR o.title ILIKE '%' || p_query || '%'
           OR o.organization ILIKE '%' || p_query || '%'
           OR o.description ILIKE '%' || p_query || '%'
           OR o.location ILIKE '%' || p_query || '%')
    ORDER BY o.active DESC, (o.source = 'manual') DESC, coalesce(o.posted_at, o.created_at) DESC
    LIMIT p_limit
$$;

DROP FUNCTION app.opportunity_create(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID);

CREATE FUNCTION app.opportunity_create(
    p_kind TEXT, p_title TEXT, p_organization TEXT, p_description TEXT, p_location TEXT, p_schedule TEXT,
    p_pay TEXT, p_contact_phone TEXT, p_contact_email TEXT, p_apply_url TEXT, p_created_by UUID,
    p_audiences TEXT[] DEFAULT '{}', p_cost TEXT DEFAULT NULL)
RETURNS SETOF app.opportunities
LANGUAGE sql AS $$
    INSERT INTO app.opportunities AS o (kind, title, organization, description, location, schedule, pay,
                                        contact_phone, contact_email, apply_url, created_by, audiences, cost)
    VALUES (p_kind, p_title, p_organization, p_description, p_location, p_schedule, p_pay,
            p_contact_phone, p_contact_email, p_apply_url, p_created_by, coalesce(p_audiences, '{}'), p_cost)
    RETURNING o.*
$$;

-- Close or reopen a posting. Closing an imported one also stops the loader
-- reopening it; reopening hands it back to the loader.
CREATE OR REPLACE FUNCTION app.opportunity_set_active(p_opportunity_id UUID, p_active BOOLEAN)
RETURNS SETOF app.opportunities
LANGUAGE sql AS $$
    UPDATE app.opportunities o SET active = p_active, closed_by_staff = NOT p_active, updated_at = now()
    WHERE o.id = p_opportunity_id
    RETURNING o.*
$$;

-- One imported posting. Returns what happened:
--   inserted   a new row
--   updated    the source's row changed
--   unchanged  the source's row is as it was (only last_seen_at moves)
--   duplicate  another open row has the same fingerprint; nothing written.
--              opportunity_id is that row.
-- A row the source lists again reopens unless staff closed it.
CREATE FUNCTION app.opportunity_sync_upsert(
    p_source TEXT, p_external_id TEXT, p_kind TEXT, p_title TEXT, p_organization TEXT, p_description TEXT,
    p_location TEXT, p_schedule TEXT, p_pay TEXT, p_contact_phone TEXT, p_contact_email TEXT,
    p_apply_url TEXT, p_audiences TEXT[], p_cost TEXT, p_posted_at TIMESTAMPTZ, p_expires_at TIMESTAMPTZ,
    p_seen_at TIMESTAMPTZ)
RETURNS TABLE (result TEXT, opportunity_id UUID)
LANGUAGE plpgsql AS $$
DECLARE
    v_row app.opportunities;
    v_id  UUID;
BEGIN
    IF p_source = 'manual' THEN
        RAISE EXCEPTION 'Staff postings are not synced' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_row FROM app.opportunities o
    WHERE o.source = p_source AND o.external_id = p_external_id
    FOR UPDATE;

    IF FOUND THEN
        IF (v_row.kind, v_row.title, v_row.organization, v_row.description, v_row.location, v_row.schedule,
            v_row.pay, v_row.contact_phone, v_row.contact_email, v_row.apply_url, v_row.audiences, v_row.cost,
            v_row.posted_at, v_row.expires_at, v_row.active)
           IS NOT DISTINCT FROM
           (p_kind, p_title, p_organization, coalesce(p_description, ''), p_location, p_schedule,
            p_pay, p_contact_phone, p_contact_email, p_apply_url, coalesce(p_audiences, '{}'), p_cost,
            p_posted_at, p_expires_at, NOT v_row.closed_by_staff) THEN
            UPDATE app.opportunities o SET last_seen_at = p_seen_at WHERE o.id = v_row.id;
            RETURN QUERY SELECT 'unchanged'::TEXT, v_row.id;
            RETURN;
        END IF;
        UPDATE app.opportunities o
        SET kind = p_kind, title = p_title, organization = p_organization,
            description = coalesce(p_description, ''), location = p_location, schedule = p_schedule,
            pay = p_pay, contact_phone = p_contact_phone, contact_email = p_contact_email,
            apply_url = p_apply_url, audiences = coalesce(p_audiences, '{}'), cost = p_cost,
            posted_at = p_posted_at, expires_at = p_expires_at, active = NOT o.closed_by_staff,
            last_seen_at = p_seen_at, updated_at = now()
        WHERE o.id = v_row.id;
        RETURN QUERY SELECT 'updated'::TEXT, v_row.id;
        RETURN;
    END IF;

    SELECT o.id INTO v_id FROM app.opportunities o
    WHERE o.active AND o.dedupe_key = app.opportunity_fingerprint(p_kind, p_title, p_organization, p_location)
    ORDER BY (o.source = 'manual') DESC, o.created_at
    LIMIT 1;
    IF FOUND THEN
        RETURN QUERY SELECT 'duplicate'::TEXT, v_id;
        RETURN;
    END IF;

    INSERT INTO app.opportunities AS o (source, external_id, kind, title, organization, description, location,
                                        schedule, pay, contact_phone, contact_email, apply_url, audiences, cost,
                                        posted_at, expires_at, last_seen_at)
    VALUES (p_source, p_external_id, p_kind, p_title, p_organization, coalesce(p_description, ''), p_location,
            p_schedule, p_pay, p_contact_phone, p_contact_email, p_apply_url, coalesce(p_audiences, '{}'), p_cost,
            p_posted_at, p_expires_at, p_seen_at)
    RETURNING o.id INTO v_id;
    RETURN QUERY SELECT 'inserted'::TEXT, v_id;
END
$$;

-- After a complete run of one source: close its open rows that run didn't
-- see (last seen before p_seen_before), and any past their closing date.
CREATE FUNCTION app.opportunity_sync_retire(p_source TEXT, p_seen_before TIMESTAMPTZ)
RETURNS TABLE (retired BIGINT)
LANGUAGE sql AS $$
    WITH closed AS (
        UPDATE app.opportunities o SET active = false, updated_at = now()
        WHERE o.source = p_source AND o.source <> 'manual' AND o.active
          AND (o.last_seen_at < p_seen_before OR o.expires_at <= now())
        RETURNING 1
    )
    SELECT count(*) FROM closed
$$;

-- =============================================================================
-- RESOURCES
-- =============================================================================

ALTER TABLE app.resources
    ADD COLUMN source       TEXT NOT NULL DEFAULT 'manual'
                            CONSTRAINT resources_source_check CHECK (source ~ '^[a-z][a-z0-9_]{0,31}$'),
    ADD COLUMN external_id  TEXT CONSTRAINT resources_external_id_check CHECK (length(external_id) <= 200),
    ADD COLUMN last_seen_at TIMESTAMPTZ,
    ADD COLUMN dedupe_key   TEXT GENERATED ALWAYS AS (app.resource_fingerprint(name)) STORED,
    ADD CONSTRAINT resources_external_id_source CHECK ((source = 'manual') = (external_id IS NULL)),
    ADD CONSTRAINT resources_source_external_id_key UNIQUE (source, external_id);

CREATE INDEX resources_open_dedupe_idx ON app.resources (dedupe_key) WHERE active;

-- One imported resource; the same results as opportunity_sync_upsert. The
-- (Sample) rows never count as duplicates: a real listing replaces nothing.
CREATE FUNCTION app.resource_sync_upsert(
    p_source TEXT, p_external_id TEXT, p_name TEXT, p_category TEXT, p_description TEXT, p_address TEXT,
    p_neighborhood TEXT, p_phone TEXT, p_website TEXT, p_hours TEXT, p_latitude DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION, p_seen_at TIMESTAMPTZ)
RETURNS TABLE (result TEXT, resource_id UUID)
LANGUAGE plpgsql AS $$
DECLARE
    v_row app.resources;
    v_id  UUID;
BEGIN
    IF p_source = 'manual' THEN
        RAISE EXCEPTION 'Staff resources are not synced' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_row FROM app.resources r
    WHERE r.source = p_source AND r.external_id = p_external_id
    FOR UPDATE;

    IF FOUND THEN
        IF (v_row.name, v_row.category, v_row.description, v_row.address, v_row.neighborhood, v_row.phone,
            v_row.website, v_row.hours, v_row.latitude, v_row.longitude, v_row.active)
           IS NOT DISTINCT FROM
           (p_name, p_category, coalesce(p_description, ''), p_address, p_neighborhood, p_phone,
            p_website, p_hours, p_latitude, p_longitude, true) THEN
            UPDATE app.resources r SET last_seen_at = p_seen_at WHERE r.id = v_row.id;
            RETURN QUERY SELECT 'unchanged'::TEXT, v_row.id;
            RETURN;
        END IF;
        UPDATE app.resources r
        SET name = p_name, category = p_category, description = coalesce(p_description, ''),
            address = p_address, neighborhood = p_neighborhood, phone = p_phone, website = p_website,
            hours = p_hours, latitude = p_latitude, longitude = p_longitude, active = true,
            last_seen_at = p_seen_at, updated_at = now()
        WHERE r.id = v_row.id;
        RETURN QUERY SELECT 'updated'::TEXT, v_row.id;
        RETURN;
    END IF;

    SELECT r.id INTO v_id FROM app.resources r
    WHERE r.active AND NOT r.is_sample AND r.dedupe_key = app.resource_fingerprint(p_name)
    ORDER BY (r.source = 'manual') DESC, r.created_at
    LIMIT 1;
    IF FOUND THEN
        RETURN QUERY SELECT 'duplicate'::TEXT, v_id;
        RETURN;
    END IF;

    INSERT INTO app.resources AS r (source, external_id, name, category, description, address, neighborhood,
                                    phone, website, hours, latitude, longitude, last_seen_at)
    VALUES (p_source, p_external_id, p_name, p_category, coalesce(p_description, ''), p_address, p_neighborhood,
            p_phone, p_website, p_hours, p_latitude, p_longitude, p_seen_at)
    RETURNING r.id INTO v_id;
    RETURN QUERY SELECT 'inserted'::TEXT, v_id;
END
$$;

CREATE FUNCTION app.resource_sync_retire(p_source TEXT, p_seen_before TIMESTAMPTZ)
RETURNS TABLE (retired BIGINT)
LANGUAGE sql AS $$
    WITH closed AS (
        UPDATE app.resources r SET active = false, updated_at = now()
        WHERE r.source = p_source AND r.source <> 'manual' AND r.active AND r.last_seen_at < p_seen_before
        RETURNING 1
    )
    SELECT count(*) FROM closed
$$;
