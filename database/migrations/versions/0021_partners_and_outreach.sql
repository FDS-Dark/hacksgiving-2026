-- =============================================================================
-- Partners, consented case sharing, texts to requesters, and need versus
-- coverage (see 0021_partners_and_outreach.py).
--
-- app.partners        organizations ComForce works with (Figma P1). Staff
--                     read them; staff add and edit them.
-- app.case_shares     each time a case was shared with a partner, with the
--                     resident's consent: how it was given, what was
--                     included, and whether it was later revoked (Figma P2).
--                     Never deleted: it is the record of who was told what.
-- app.case_texts      one row per public case update the worker considered
--                     texting to the requester: sent, skipped (and why), or
--                     failed. Only references and outcomes; the text itself
--                     is generic and never holds case details.
-- insights_coverage   per census tract: a CDC PLACES need measure, ComForce
--                     cases placed there (0020's case_places) and reviewed
--                     incidents (counts under 5 left out, as in 0014).
--
-- Same conventions as 0015-0020: app.<domain>_<verb>, p_ parameters, no row
-- means not found, SECURITY INVOKER.
-- =============================================================================

-- =============================================================================
-- PARTNERS
-- =============================================================================

CREATE TABLE app.partners (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name           TEXT NOT NULL CONSTRAINT partners_name_check CHECK (length(name) BETWEEN 1 AND 160),
    description    TEXT NOT NULL DEFAULT '' CONSTRAINT partners_description_check CHECK (length(description) <= 4000),
    -- The ComForce services (case categories) the partner takes cases for.
    categories     TEXT[] NOT NULL DEFAULT '{}' CONSTRAINT partners_categories_check CHECK (categories <@ ARRAY[
                       'homelessness', 'missing_persons', 'meal_programs', 'violence_prevention',
                       'transportation', 'incident_deescalation', 'burial_assistance',
                       'bridge_to_employment', 'other']),
    contact_name   TEXT CONSTRAINT partners_contact_name_check CHECK (length(contact_name) <= 200),
    phone          TEXT CONSTRAINT partners_phone_check CHECK (length(phone) <= 200),
    email          TEXT CONSTRAINT partners_email_check CHECK (length(email) <= 200),
    website        TEXT CONSTRAINT partners_website_check CHECK (length(website) <= 200),
    address        TEXT CONSTRAINT partners_address_check CHECK (length(address) <= 500),
    languages      TEXT[] NOT NULL DEFAULT '{}',
    -- The partner has agreed to receive shared cases (a data-sharing
    -- agreement or MOU). Only these can be picked when sharing.
    accepts_shares BOOLEAN NOT NULL DEFAULT false,
    -- Staff-only notes: who to ask for, intake hours, what they need.
    notes          TEXT NOT NULL DEFAULT '' CONSTRAINT partners_notes_check CHECK (length(notes) <= 4000),
    active         BOOLEAN NOT NULL DEFAULT true,
    created_by     UUID REFERENCES app.users (id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX partners_name_idx ON app.partners (lower(name));

-- Partners matching p_q (name, description or contact) and taking
-- p_category, active ones only unless p_include_inactive; by name.
CREATE FUNCTION app.partner_list(p_q TEXT, p_category TEXT, p_include_inactive BOOLEAN)
RETURNS SETOF app.partners
LANGUAGE sql STABLE AS $$
    SELECT p.* FROM app.partners p
    WHERE (COALESCE(p_include_inactive, false) OR p.active)
      AND (p_category IS NULL OR p_category = ANY (p.categories))
      AND (p_q IS NULL OR p.name ILIKE '%' || p_q || '%' OR p.description ILIKE '%' || p_q || '%'
           OR p.contact_name ILIKE '%' || p_q || '%')
    ORDER BY lower(p.name), p.id
$$;

CREATE FUNCTION app.partner_get(p_partner_id UUID)
RETURNS SETOF app.partners
LANGUAGE sql STABLE AS $$
    SELECT p.* FROM app.partners p WHERE p.id = p_partner_id
$$;

CREATE FUNCTION app.partner_create(
    p_name TEXT, p_description TEXT, p_categories TEXT[], p_contact_name TEXT, p_phone TEXT, p_email TEXT,
    p_website TEXT, p_address TEXT, p_languages TEXT[], p_accepts_shares BOOLEAN, p_notes TEXT, p_active BOOLEAN,
    p_created_by UUID)
RETURNS SETOF app.partners
LANGUAGE sql AS $$
    INSERT INTO app.partners AS p (name, description, categories, contact_name, phone, email, website, address,
                                   languages, accepts_shares, notes, active, created_by)
    VALUES (p_name, COALESCE(p_description, ''), COALESCE(p_categories, '{}'), p_contact_name, p_phone, p_email,
            p_website, p_address, COALESCE(p_languages, '{}'), COALESCE(p_accepts_shares, false),
            COALESCE(p_notes, ''), COALESCE(p_active, true), p_created_by)
    RETURNING p.*
$$;

-- Replaces every editable field. No row when the partner doesn't exist.
CREATE FUNCTION app.partner_update(
    p_partner_id UUID, p_name TEXT, p_description TEXT, p_categories TEXT[], p_contact_name TEXT, p_phone TEXT,
    p_email TEXT, p_website TEXT, p_address TEXT, p_languages TEXT[], p_accepts_shares BOOLEAN, p_notes TEXT,
    p_active BOOLEAN)
RETURNS SETOF app.partners
LANGUAGE sql AS $$
    UPDATE app.partners AS p
    SET name = p_name, description = COALESCE(p_description, ''), categories = COALESCE(p_categories, '{}'),
        contact_name = p_contact_name, phone = p_phone, email = p_email, website = p_website,
        address = p_address, languages = COALESCE(p_languages, '{}'),
        accepts_shares = COALESCE(p_accepts_shares, false), notes = COALESCE(p_notes, ''),
        active = COALESCE(p_active, true), updated_at = now()
    WHERE p.id = p_partner_id
    RETURNING p.*
$$;

-- =============================================================================
-- CASE SHARES (with the resident's consent)
-- =============================================================================

CREATE TABLE app.case_shares (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id          UUID NOT NULL REFERENCES app.cases (id) ON DELETE CASCADE,
    partner_id       UUID NOT NULL REFERENCES app.partners (id) ON DELETE RESTRICT,
    shared_by        UUID REFERENCES app.users (id) ON DELETE SET NULL,
    -- Why the case is shared, in the worker's words ("Intake for tonight's bed").
    purpose          TEXT NOT NULL CONSTRAINT case_shares_purpose_check CHECK (length(purpose) BETWEEN 1 AND 500),
    -- What went beyond the summary: the person's name and number, the location.
    include_contact  BOOLEAN NOT NULL DEFAULT false,
    include_location BOOLEAN NOT NULL DEFAULT false,
    -- How the resident agreed. verbal: told a worker. written: a signed
    -- release. in_app: through the app.
    consent_method   TEXT NOT NULL CONSTRAINT case_shares_consent_check CHECK (consent_method IN (
                         'verbal', 'written', 'in_app')),
    -- Who agreed and any limits ("Agreed by phone, only for housing").
    consent_note     TEXT CONSTRAINT case_shares_consent_note_check CHECK (length(consent_note) <= 500),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at       TIMESTAMPTZ,
    revoked_by       UUID REFERENCES app.users (id) ON DELETE SET NULL
);

-- One live share per case and partner.
CREATE UNIQUE INDEX case_shares_live_idx ON app.case_shares (case_id, partner_id) WHERE revoked_at IS NULL;

CREATE VIEW app.case_share_view AS
SELECT s.id, s.case_id, s.partner_id, p.name AS partner_name, p.email AS partner_email, p.phone AS partner_phone,
       s.shared_by, u.display_name AS shared_by_name, s.purpose, s.include_contact, s.include_location,
       s.consent_method, s.consent_note, s.created_at, s.revoked_at, s.revoked_by,
       r.display_name AS revoked_by_name
FROM app.case_shares s
JOIN app.partners p ON p.id = s.partner_id
LEFT JOIN app.users u ON u.id = s.shared_by
LEFT JOIN app.users r ON r.id = s.revoked_by;

-- A new share. No row when the case or partner is missing, the partner
-- doesn't accept shares or is inactive, or the case is already shared with
-- them (the API tells these apart first).
CREATE FUNCTION app.case_share_create(
    p_case_id UUID, p_partner_id UUID, p_shared_by UUID, p_purpose TEXT, p_include_contact BOOLEAN,
    p_include_location BOOLEAN, p_consent_method TEXT, p_consent_note TEXT)
RETURNS SETOF app.case_share_view
LANGUAGE plpgsql AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO app.case_shares (case_id, partner_id, shared_by, purpose, include_contact, include_location,
                                 consent_method, consent_note)
    SELECT c.id, p.id, p_shared_by, p_purpose, COALESCE(p_include_contact, false),
           COALESCE(p_include_location, false), p_consent_method, p_consent_note
    FROM app.cases c, app.partners p
    WHERE c.id = p_case_id AND p.id = p_partner_id AND p.accepts_shares AND p.active
    ON CONFLICT (case_id, partner_id) WHERE revoked_at IS NULL DO NOTHING
    RETURNING id INTO v_id;
    RETURN QUERY SELECT v.* FROM app.case_share_view v WHERE v.id = v_id;
END
$$;

CREATE FUNCTION app.case_share_list(p_case_id UUID)
RETURNS SETOF app.case_share_view
LANGUAGE sql STABLE AS $$
    SELECT v.* FROM app.case_share_view v WHERE v.case_id = p_case_id ORDER BY v.created_at DESC, v.id
$$;

-- Ends a live share. No row when it isn't live (or isn't this case's).
CREATE FUNCTION app.case_share_revoke(p_case_id UUID, p_share_id UUID, p_revoked_by UUID)
RETURNS SETOF app.case_share_view
LANGUAGE plpgsql AS $$
DECLARE
    v_id UUID;
BEGIN
    UPDATE app.case_shares AS s SET revoked_at = now(), revoked_by = p_revoked_by
    WHERE s.id = p_share_id AND s.case_id = p_case_id AND s.revoked_at IS NULL
    RETURNING s.id INTO v_id;
    RETURN QUERY SELECT v.* FROM app.case_share_view v WHERE v.id = v_id;
END
$$;

-- =============================================================================
-- TEXTS TO REQUESTERS
-- =============================================================================

CREATE TABLE app.case_texts (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id        UUID NOT NULL REFERENCES app.cases (id) ON DELETE CASCADE,
    -- The public update it was about: at most one text per update.
    case_update_id UUID NOT NULL UNIQUE REFERENCES app.case_updates (id) ON DELETE CASCADE,
    status         TEXT NOT NULL CONSTRAINT case_texts_status_check CHECK (status IN ('sent', 'skipped', 'failed')),
    -- Why it was skipped or failed: coalesced, invalid_number, opted_out, or
    -- the provider's error code.
    reason         TEXT CONSTRAINT case_texts_reason_check CHECK (length(reason) <= 120),
    provider_id    TEXT CONSTRAINT case_texts_provider_id_check CHECK (length(provider_id) <= 64),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX case_texts_case_idx ON app.case_texts (case_id, created_at DESC);

-- Public updates from the last day still to consider: the request coming
-- in, a staff message and a status change, on cases whose requester chose
-- texts and said texting is safe. With when the case was last texted, for
-- coalescing. Oldest first.
CREATE FUNCTION app.case_text_pending(p_limit INT)
RETURNS TABLE (case_update_id UUID, case_id UUID, case_number BIGINT, update_type TEXT, case_status TEXT,
               contact_phone TEXT, last_sent_at TIMESTAMPTZ)
LANGUAGE sql STABLE AS $$
    SELECT u.id, c.id, c.number, u.update_type, c.status, c.contact_phone,
           (SELECT max(t.created_at) FROM app.case_texts t WHERE t.case_id = c.id AND t.status = 'sent')
    FROM app.case_updates u
    JOIN app.cases c ON c.id = u.case_id
    WHERE u.created_at >= now() - INTERVAL '1 day'
      AND u.visibility = 'public'
      AND (u.update_type = 'created' OR (u.update_type IN ('message', 'status_change') AND u.author_id IS NOT NULL
                                         AND u.author_id IS DISTINCT FROM c.requester_id))
      AND c.contact_method = 'text' AND c.safe_to_contact IS TRUE AND c.contact_phone IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM app.case_texts t WHERE t.case_update_id = u.id)
    ORDER BY u.created_at, u.id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 200)
$$;

-- Records what happened to one update. Nothing when it was already recorded.
CREATE FUNCTION app.case_text_record(p_case_id UUID, p_case_update_id UUID, p_status TEXT, p_reason TEXT,
                                     p_provider_id TEXT)
RETURNS SETOF app.case_texts
LANGUAGE sql AS $$
    INSERT INTO app.case_texts AS t (case_id, case_update_id, status, reason, provider_id)
    VALUES (p_case_id, p_case_update_id, p_status, left(p_reason, 120), left(p_provider_id, 64))
    ON CONFLICT (case_update_id) DO NOTHING
    RETURNING t.*
$$;

-- What a case's requester was texted, for staff (newest first).
CREATE FUNCTION app.case_text_list(p_case_id UUID)
RETURNS SETOF app.case_texts
LANGUAGE sql STABLE AS $$
    SELECT t.* FROM app.case_texts t WHERE t.case_id = p_case_id ORDER BY t.created_at DESC, t.id
$$;

-- =============================================================================
-- NEED VERSUS COVERAGE
-- =============================================================================

-- Every census tract in geo_areas, at its internal point (rounded): the
-- latest p_measure_id value (a CDC PLACES percentage of adults), ComForce
-- cases opened in [p_start, p_end) placed there (of p_category, when given),
-- and reviewed incidents in the period (NULL under 5).
CREATE FUNCTION app.insights_coverage(p_measure_id TEXT, p_category TEXT, p_start TIMESTAMPTZ, p_end TIMESTAMPTZ)
RETURNS TABLE (tract_geoid TEXT, name TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION,
               need DOUBLE PRECISION, need_year INT, cases BIGINT, incidents BIGINT)
LANGUAGE sql STABLE AS $$
    WITH tracts AS (
        SELECT split_part(a.external_id, ':', 2) AS geoid, a.name,
               COALESCE(NULLIF(a.properties ->> 'INTPTLAT', '')::float8, (a.min_lat + a.max_lat) / 2) AS lat,
               COALESCE(NULLIF(a.properties ->> 'INTPTLON', '')::float8, (a.min_lon + a.max_lon) / 2) AS lon
        FROM app.geo_areas a
        WHERE a.kind = 'census_tract'
    ),
    need AS (
        SELECT DISTINCT ON (m.tract_geoid) m.tract_geoid, m.value, m.year
        FROM app.community_measures m
        WHERE m.measure_id = p_measure_id AND m.value IS NOT NULL
        ORDER BY m.tract_geoid, m.year DESC
    ),
    case_counts AS (
        SELECT p.tract_geoid, count(*) AS n
        FROM app.cases c
        JOIN app.case_places p ON p.case_id = c.id AND p.status = 'placed'
        WHERE c.created_at >= p_start AND c.created_at < p_end
          AND (p_category IS NULL OR c.category = p_category)
        GROUP BY p.tract_geoid
    ),
    incident_counts AS (
        SELECT i.tract_geoid, count(*) AS n
        FROM app.external_incidents i
        WHERE i.incident_at >= p_start AND i.incident_at < p_end AND i.tract_geoid IS NOT NULL
        GROUP BY i.tract_geoid
    )
    SELECT t.geoid, t.name, round(t.lat::numeric, 3)::float8, round(t.lon::numeric, 3)::float8,
           n.value, n.year, COALESCE(cc.n, 0), CASE WHEN ic.n >= 5 THEN ic.n END
    FROM tracts t
    LEFT JOIN need n ON n.tract_geoid = t.geoid
    LEFT JOIN case_counts cc ON cc.tract_geoid = t.geoid
    LEFT JOIN incident_counts ic ON ic.tract_geoid = t.geoid
    ORDER BY t.geoid
$$;
