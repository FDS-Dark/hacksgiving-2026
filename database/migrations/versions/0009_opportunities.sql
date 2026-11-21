-- =============================================================================
-- Volunteer and job opportunities (see 0009_opportunities.py).
--
-- ComForce staff post them; residents search them. A posting is closed by
-- setting active = false (kept for the record, hidden from residents).
--
-- Same conventions as 0003 and 0005: app.<domain>_<verb>, p_ parameters, no
-- row means not found, SECURITY INVOKER.
-- =============================================================================

CREATE TABLE app.opportunities (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind          TEXT NOT NULL CONSTRAINT opportunities_kind_check CHECK (kind IN ('volunteer', 'job')),
    title         TEXT NOT NULL CONSTRAINT opportunities_title_check CHECK (length(title) BETWEEN 1 AND 160),
    organization  TEXT NOT NULL CONSTRAINT opportunities_organization_check
                  CHECK (length(organization) BETWEEN 1 AND 160),
    description   TEXT NOT NULL DEFAULT '',
    location      TEXT,
    schedule      TEXT,
    pay           TEXT,
    contact_phone TEXT,
    contact_email TEXT,
    apply_url     TEXT,
    active        BOOLEAN NOT NULL DEFAULT true,
    created_by    UUID REFERENCES app.users (id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX opportunities_active_kind_idx ON app.opportunities (active, kind);

-- Open postings first, newest first. Residents pass p_include_closed false.
CREATE FUNCTION app.opportunity_list(p_query TEXT, p_kind TEXT, p_include_closed BOOLEAN)
RETURNS SETOF app.opportunities
LANGUAGE sql STABLE AS $$
    SELECT o.* FROM app.opportunities o
    WHERE (p_include_closed OR o.active)
      AND (p_kind IS NULL OR o.kind = p_kind)
      AND (p_query IS NULL OR p_query = ''
           OR o.title ILIKE '%' || p_query || '%'
           OR o.organization ILIKE '%' || p_query || '%'
           OR o.description ILIKE '%' || p_query || '%'
           OR o.location ILIKE '%' || p_query || '%')
    ORDER BY o.active DESC, o.created_at DESC
$$;

CREATE FUNCTION app.opportunity_get(p_opportunity_id UUID)
RETURNS SETOF app.opportunities
LANGUAGE sql STABLE AS $$
    SELECT o.* FROM app.opportunities o WHERE o.id = p_opportunity_id
$$;

CREATE FUNCTION app.opportunity_create(
    p_kind TEXT, p_title TEXT, p_organization TEXT, p_description TEXT, p_location TEXT, p_schedule TEXT,
    p_pay TEXT, p_contact_phone TEXT, p_contact_email TEXT, p_apply_url TEXT, p_created_by UUID)
RETURNS SETOF app.opportunities
LANGUAGE sql AS $$
    INSERT INTO app.opportunities AS o (kind, title, organization, description, location, schedule, pay,
                                        contact_phone, contact_email, apply_url, created_by)
    VALUES (p_kind, p_title, p_organization, p_description, p_location, p_schedule, p_pay,
            p_contact_phone, p_contact_email, p_apply_url, p_created_by)
    RETURNING o.*
$$;

-- Close or reopen a posting. No row when it doesn't exist.
CREATE FUNCTION app.opportunity_set_active(p_opportunity_id UUID, p_active BOOLEAN)
RETURNS SETOF app.opportunities
LANGUAGE sql AS $$
    UPDATE app.opportunities o SET active = p_active, updated_at = now()
    WHERE o.id = p_opportunity_id
    RETURNING o.*
$$;
