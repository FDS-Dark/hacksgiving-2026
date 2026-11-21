-- External/public persona. Public functions return no user ids, internal notes,
-- exact client locations, contact details, or partner-only records.

ALTER TABLE app.resources
    ADD COLUMN website_url TEXT,
    ADD COLUMN address_label TEXT,
    ADD COLUMN latitude DOUBLE PRECISION,
    ADD COLUMN longitude DOUBLE PRECISION;

INSERT INTO app.resources
    (slug, name, category, description, phone_e164, website_url, languages,
     service_area, hours_label, transfer_approved, is_emergency, priority)
VALUES
    ('impact-211', 'IMPACT 211', 'basic-needs',
     'Free navigation for housing, food, health care, family support and other Milwaukee services.',
     NULL, 'https://city.milwaukee.gov/not911', ARRAY['en', 'es'], 'Milwaukee', '24/7', false, false, 15),
    ('988-lifeline', '988 Suicide & Crisis Lifeline', 'mental-health-crisis',
     'Call or text 988 for confidential crisis support. Call 911 for immediate physical danger.',
     NULL, 'https://988lifeline.org/', ARRAY['en', 'es'], 'United States', '24/7', false, false, 5),
    ('mke-dv-resources', 'Milwaukee Domestic Violence & Sexual Assault Resources', 'safety-support',
     'City-maintained directory of confidential crisis lines and culturally specific support services.',
     NULL, 'https://city.milwaukee.gov/staysafe/domestic--violence-and-sexual-assault', ARRAY['en', 'es'],
     'Milwaukee', 'Varies by provider', false, false, 12)
ON CONFLICT (slug) DO UPDATE SET
    description = EXCLUDED.description,
    website_url = EXCLUDED.website_url,
    updated_at = now();

INSERT INTO app.resources
    (slug, name, category, description, phone_e164, website_url, address_label,
     latitude, longitude, languages, service_area, hours_label,
     transfer_approved, is_emergency, priority)
VALUES
    ('mental-health-emergency-center', 'Mental Health Emergency Center', 'mental-health-crisis',
     '24/7 crisis assessment, stabilization and connection to continuing care for children and adults.',
     '+14149663030', 'https://county.milwaukee.gov/EN/DHHS/BHD/Mental-Health-Emergency-Center',
     '1525 N. 12th Street, Milwaukee', 43.0508, -87.9273, ARRAY['en'], 'Milwaukee County', '24/7', false, false, 8)
ON CONFLICT (slug) DO UPDATE SET
    description = EXCLUDED.description, website_url = EXCLUDED.website_url,
    address_label = EXCLUDED.address_label, latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude, updated_at = now();

CREATE TABLE app.opportunities (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title          TEXT NOT NULL,
    organization   TEXT NOT NULL,
    kind           TEXT NOT NULL CHECK (kind IN ('volunteer', 'job', 'training')),
    summary        TEXT NOT NULL,
    neighborhood   TEXT,
    schedule_label TEXT,
    apply_url      TEXT,
    active         BOOLEAN NOT NULL DEFAULT true,
    posted_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE app.assistance_requests (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    category           TEXT NOT NULL,
    summary            TEXT NOT NULL,
    neighborhood       TEXT,
    contact_preference TEXT NOT NULL DEFAULT 'in-app',
    status             TEXT NOT NULL DEFAULT 'submitted'
                       CHECK (status IN ('submitted', 'reviewing', 'matched', 'closed')),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (length(summary) BETWEEN 1 AND 800)
);
CREATE INDEX assistance_requests_user_idx ON app.assistance_requests (user_id, created_at DESC);

CREATE TABLE app.community_posts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    body         TEXT NOT NULL,
    neighborhood TEXT,
    anonymous    BOOLEAN NOT NULL DEFAULT true,
    approved     BOOLEAN NOT NULL DEFAULT false,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (length(body) BETWEEN 1 AND 800)
);
CREATE INDEX community_posts_created_idx ON app.community_posts (created_at DESC) WHERE approved;

INSERT INTO app.opportunities (title, organization, kind, summary, neighborhood, schedule_label)
VALUES
    ('Community outreach volunteer', 'ComForce MKE', 'volunteer',
     'Support resident outreach, resource sharing and safer-neighborhood events.', 'Milwaukee', 'Flexible'),
    ('Violence-prevention training', 'ComForce MKE', 'training',
     'Learn community-centered de-escalation, outreach and resource-navigation practices.', 'Milwaukee', 'Upcoming sessions');

CREATE FUNCTION app.public_resource_search(p_query TEXT, p_category TEXT)
RETURNS TABLE (
    id UUID, slug TEXT, name TEXT, category TEXT, description TEXT,
    phone_e164 TEXT, website_url TEXT, address_label TEXT,
    latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, languages TEXT[],
    service_area TEXT, hours_label TEXT, is_emergency BOOLEAN,
    last_verified_at TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
    SELECT r.id, r.slug, r.name, r.category, r.description,
           CASE WHEN r.slug IN (
               'milwaukee-mobile-crisis', 'mpd-non-emergency',
               'milwaukee-city-services', 'mental-health-emergency-center'
           ) THEN r.phone_e164 ELSE NULL END,
           r.website_url, r.address_label, r.latitude, r.longitude, r.languages,
           r.service_area, r.hours_label, r.is_emergency, r.last_verified_at
    FROM app.resources r
    WHERE r.active
      AND (p_category IS NULL OR r.category = p_category)
      AND (
          p_query IS NULL OR
          to_tsvector('english', r.name || ' ' || r.category || ' ' || r.description || ' ' || array_to_string(r.languages, ' '))
          @@ websearch_to_tsquery('english', p_query)
      )
    ORDER BY r.is_emergency DESC, r.priority, r.name
    LIMIT 30
$$;

CREATE FUNCTION app.public_opportunity_list(p_kind TEXT)
RETURNS TABLE (
    id UUID, title TEXT, organization TEXT, kind TEXT, summary TEXT,
    neighborhood TEXT, schedule_label TEXT, apply_url TEXT, posted_at TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
    SELECT o.id, o.title, o.organization, o.kind, o.summary,
           o.neighborhood, o.schedule_label, o.apply_url, o.posted_at
    FROM app.opportunities o
    WHERE o.active AND (p_kind IS NULL OR o.kind = p_kind)
    ORDER BY o.posted_at DESC
$$;

CREATE FUNCTION app.assistance_request_create(
    p_user_id UUID, p_category TEXT, p_summary TEXT,
    p_neighborhood TEXT, p_contact_preference TEXT
)
RETURNS TABLE (
    id UUID, category TEXT, summary TEXT, neighborhood TEXT,
    contact_preference TEXT, status TEXT, created_at TIMESTAMPTZ
)
LANGUAGE sql AS $$
    INSERT INTO app.assistance_requests AS r
        (user_id, category, summary, neighborhood, contact_preference)
    VALUES (p_user_id, p_category, p_summary, p_neighborhood, p_contact_preference)
    RETURNING r.id, r.category, r.summary, r.neighborhood,
              r.contact_preference, r.status, r.created_at
$$;

CREATE FUNCTION app.assistance_request_list_mine(p_user_id UUID)
RETURNS TABLE (
    id UUID, category TEXT, summary TEXT, neighborhood TEXT,
    contact_preference TEXT, status TEXT, created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
    SELECT r.id, r.category, r.summary, r.neighborhood,
           r.contact_preference, r.status, r.created_at
    FROM app.assistance_requests r
    WHERE r.user_id = p_user_id
    ORDER BY r.created_at DESC
$$;

CREATE FUNCTION app.community_post_list()
RETURNS TABLE (id UUID, body TEXT, neighborhood TEXT, author_label TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql STABLE AS $$
    SELECT p.id, p.body, p.neighborhood,
           CASE WHEN p.anonymous THEN 'Milwaukee neighbor' ELSE COALESCE(u.display_name, 'Community member') END,
           p.created_at
    FROM app.community_posts p
    JOIN app.users u ON u.id = p.user_id
    WHERE p.approved
    ORDER BY p.created_at DESC
    LIMIT 100
$$;

CREATE FUNCTION app.community_post_create(
    p_user_id UUID, p_body TEXT, p_neighborhood TEXT, p_anonymous BOOLEAN
)
RETURNS TABLE (id UUID, body TEXT, neighborhood TEXT, author_label TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql AS $$
    WITH inserted AS (
        INSERT INTO app.community_posts AS p (user_id, body, neighborhood, anonymous)
        VALUES (p_user_id, p_body, p_neighborhood, COALESCE(p_anonymous, true))
        RETURNING p.id, p.user_id, p.body, p.neighborhood, p.anonymous, p.created_at
    )
    SELECT i.id, i.body, i.neighborhood,
           CASE WHEN i.anonymous THEN 'Milwaukee neighbor' ELSE COALESCE(u.display_name, 'Community member') END,
           i.created_at
    FROM inserted i JOIN app.users u ON u.id = i.user_id
$$;
