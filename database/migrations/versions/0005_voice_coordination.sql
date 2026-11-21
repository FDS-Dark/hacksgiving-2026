-- Privacy-first voice coordination. No audio, transcript, caller phone number,
-- exact address, or free-form case narrative is stored in these tables.

CREATE TABLE app.resources (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug               TEXT NOT NULL UNIQUE,
    name               TEXT NOT NULL,
    category           TEXT NOT NULL,
    description        TEXT NOT NULL,
    phone_e164         TEXT,
    languages          TEXT[] NOT NULL DEFAULT ARRAY['en']::TEXT[],
    service_area       TEXT NOT NULL DEFAULT 'Milwaukee',
    hours_label        TEXT,
    transfer_approved  BOOLEAN NOT NULL DEFAULT false,
    is_emergency       BOOLEAN NOT NULL DEFAULT false,
    active             BOOLEAN NOT NULL DEFAULT true,
    priority           INTEGER NOT NULL DEFAULT 100,
    last_verified_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT resources_slug_plain CHECK (slug ~ '^[a-z][a-z0-9-]{0,62}$'),
    CONSTRAINT resources_phone_e164 CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
    -- 911 must never become an AI transfer destination.
    CONSTRAINT resources_emergency_not_transferable CHECK (NOT is_emergency OR NOT transfer_approved)
);

CREATE TABLE app.voice_calls (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider              TEXT NOT NULL DEFAULT 'elevenlabs',
    conversation_id       TEXT NOT NULL,
    language              TEXT,
    need_category         TEXT,
    urgency_tier          TEXT,
    neighborhood          TEXT,
    callback_consent      BOOLEAN NOT NULL DEFAULT false,
    disposition           TEXT,
    event_timestamp       BIGINT NOT NULL,
    started_at            TIMESTAMPTZ,
    ended_at              TIMESTAMPTZ,
    retention_delete_at   TIMESTAMPTZ NOT NULL DEFAULT now() + interval '30 days',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT voice_calls_conversation_unique UNIQUE (conversation_id),
    CONSTRAINT voice_calls_language_length CHECK (language IS NULL OR length(language) <= 12),
    CONSTRAINT voice_calls_category_length CHECK (need_category IS NULL OR length(need_category) <= 64),
    CONSTRAINT voice_calls_urgency CHECK (urgency_tier IS NULL OR urgency_tier IN ('emergency', 'urgent', 'routine')),
    CONSTRAINT voice_calls_neighborhood_length CHECK (neighborhood IS NULL OR length(neighborhood) <= 80),
    CONSTRAINT voice_calls_disposition_length CHECK (disposition IS NULL OR length(disposition) <= 64)
);

CREATE TABLE app.voice_call_events (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id      UUID NOT NULL REFERENCES app.voice_calls(id) ON DELETE CASCADE,
    event_key    TEXT NOT NULL,
    event_type   TEXT NOT NULL,
    details      JSONB NOT NULL DEFAULT '{}'::JSONB,
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT voice_call_events_event_key_unique UNIQUE (event_key),
    CONSTRAINT voice_call_events_type_length CHECK (length(event_type) BETWEEN 1 AND 64),
    CONSTRAINT voice_call_events_details_object CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX voice_call_events_call_idx ON app.voice_call_events (call_id, occurred_at);

CREATE TABLE app.referrals (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id       UUID NOT NULL REFERENCES app.voice_calls(id) ON DELETE CASCADE,
    resource_id   UUID NOT NULL REFERENCES app.resources(id),
    status        TEXT NOT NULL DEFAULT 'offered',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT referrals_status CHECK (status IN ('offered', 'accepted', 'transfer_attempted', 'connected', 'declined', 'unavailable')),
    CONSTRAINT referrals_call_resource_unique UNIQUE (call_id, resource_id)
);

CREATE TABLE app.referral_outcomes (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referral_id  UUID NOT NULL REFERENCES app.referrals(id) ON DELETE CASCADE,
    status       TEXT NOT NULL,
    reason_code  TEXT,
    recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT referral_outcomes_referral_unique UNIQUE (referral_id),
    CONSTRAINT referral_outcomes_status CHECK (status IN ('connected', 'voicemail', 'no_answer', 'declined', 'unavailable', 'follow_up_needed', 'completed')),
    CONSTRAINT referral_outcomes_reason_length CHECK (reason_code IS NULL OR length(reason_code) <= 64)
);

-- Seed only published, stable civic routing information. Partner-specific
-- transfer numbers remain unapproved until the organization opts in.
INSERT INTO app.resources
    (slug, name, category, description, phone_e164, languages, hours_label, transfer_approved, is_emergency, priority)
VALUES
    ('milwaukee-911', '911 Emergency Services', 'emergency',
     'Immediate danger, crime in progress, fire, serious injury, weapon, or overdose. The caller must hang up and dial 911 directly.',
     NULL, ARRAY['en', 'es'], '24/7', false, true, 1),
    ('milwaukee-mobile-crisis', 'Milwaukee Mobile Crisis', 'mental-health-crisis',
     'Non-police, 24/7 mental-health crisis response for Milwaukee County.',
     '+14142577222', ARRAY['en', 'es'], '24/7', false, false, 10),
    ('mpd-non-emergency', 'Milwaukee Police Non-Emergency', 'police-non-emergency',
     'Police reports and assistance when no crime or danger is in progress.',
     '+14149334444', ARRAY['en'], '24/7', false, false, 20),
    ('milwaukee-city-services', 'Milwaukee City Services', 'city-services',
     'Property, sanitation, streets, water, and other non-public-safety city services.',
     '+14142862489', ARRAY['en', 'es'], '24/7', false, false, 30);

CREATE FUNCTION app.resource_list(p_category TEXT, p_language TEXT)
RETURNS TABLE (
    id UUID, slug TEXT, name TEXT, category TEXT, description TEXT,
    phone_e164 TEXT, languages TEXT[], service_area TEXT, hours_label TEXT,
    transfer_approved BOOLEAN, is_emergency BOOLEAN, last_verified_at TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
    SELECT r.id, r.slug, r.name, r.category, r.description,
           CASE WHEN r.transfer_approved THEN r.phone_e164 ELSE NULL END,
           r.languages, r.service_area, r.hours_label,
           r.transfer_approved, r.is_emergency, r.last_verified_at
    FROM app.resources r
    WHERE r.active
      AND (p_category IS NULL OR r.category = p_category)
      AND (p_language IS NULL OR p_language = ANY(r.languages))
    ORDER BY r.is_emergency DESC, r.priority, r.name
$$;

CREATE FUNCTION app.voice_call_ingest(
    p_conversation_id TEXT, p_event_timestamp BIGINT, p_language TEXT,
    p_need_category TEXT, p_urgency_tier TEXT, p_neighborhood TEXT,
    p_callback_consent BOOLEAN, p_disposition TEXT, p_started_at TIMESTAMPTZ,
    p_ended_at TIMESTAMPTZ
)
RETURNS TABLE (
    id UUID, provider TEXT, conversation_id TEXT, language TEXT,
    need_category TEXT, urgency_tier TEXT, neighborhood TEXT,
    callback_consent BOOLEAN, disposition TEXT, event_timestamp BIGINT,
    started_at TIMESTAMPTZ, ended_at TIMESTAMPTZ, created_at TIMESTAMPTZ
)
LANGUAGE sql AS $$
    INSERT INTO app.voice_calls AS c
        (conversation_id, event_timestamp, language, need_category,
         urgency_tier, neighborhood, callback_consent, disposition,
         started_at, ended_at)
    VALUES
        (p_conversation_id, p_event_timestamp, p_language, p_need_category,
         p_urgency_tier, p_neighborhood, COALESCE(p_callback_consent, false),
         p_disposition, p_started_at, p_ended_at)
    ON CONFLICT ON CONSTRAINT voice_calls_conversation_unique DO UPDATE SET
        event_timestamp = GREATEST(c.event_timestamp, EXCLUDED.event_timestamp),
        language = COALESCE(EXCLUDED.language, c.language),
        need_category = COALESCE(EXCLUDED.need_category, c.need_category),
        urgency_tier = COALESCE(EXCLUDED.urgency_tier, c.urgency_tier),
        neighborhood = COALESCE(EXCLUDED.neighborhood, c.neighborhood),
        callback_consent = c.callback_consent OR EXCLUDED.callback_consent,
        disposition = COALESCE(EXCLUDED.disposition, c.disposition),
        started_at = COALESCE(EXCLUDED.started_at, c.started_at),
        ended_at = COALESCE(EXCLUDED.ended_at, c.ended_at),
        updated_at = now()
    RETURNING c.id, c.provider, c.conversation_id, c.language,
              c.need_category, c.urgency_tier, c.neighborhood,
              c.callback_consent, c.disposition, c.event_timestamp,
              c.started_at, c.ended_at, c.created_at
$$;

CREATE FUNCTION app.voice_call_get_by_conversation(p_conversation_id TEXT)
RETURNS TABLE (
    id UUID, provider TEXT, conversation_id TEXT, language TEXT,
    need_category TEXT, urgency_tier TEXT, neighborhood TEXT,
    callback_consent BOOLEAN, disposition TEXT, event_timestamp BIGINT,
    started_at TIMESTAMPTZ, ended_at TIMESTAMPTZ, created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
    SELECT c.id, c.provider, c.conversation_id, c.language,
           c.need_category, c.urgency_tier, c.neighborhood,
           c.callback_consent, c.disposition, c.event_timestamp,
           c.started_at, c.ended_at, c.created_at
    FROM app.voice_calls c WHERE c.conversation_id = p_conversation_id
$$;

CREATE FUNCTION app.voice_call_begin(p_conversation_id TEXT)
RETURNS TABLE (
    id UUID, provider TEXT, conversation_id TEXT, language TEXT,
    need_category TEXT, urgency_tier TEXT, neighborhood TEXT,
    callback_consent BOOLEAN, disposition TEXT, event_timestamp BIGINT,
    started_at TIMESTAMPTZ, ended_at TIMESTAMPTZ, created_at TIMESTAMPTZ
)
LANGUAGE sql AS $$
    INSERT INTO app.voice_calls AS c (conversation_id, event_timestamp, started_at)
    VALUES (p_conversation_id, extract(epoch FROM now())::BIGINT, now())
    ON CONFLICT ON CONSTRAINT voice_calls_conversation_unique DO UPDATE SET updated_at = now()
    RETURNING c.id, c.provider, c.conversation_id, c.language,
              c.need_category, c.urgency_tier, c.neighborhood,
              c.callback_consent, c.disposition, c.event_timestamp,
              c.started_at, c.ended_at, c.created_at
$$;

CREATE FUNCTION app.voice_call_event_append(
    p_call_id UUID, p_event_key TEXT, p_event_type TEXT, p_details TEXT,
    p_occurred_at TIMESTAMPTZ
)
RETURNS TABLE (id UUID, call_id UUID, event_key TEXT, event_type TEXT, details JSONB, occurred_at TIMESTAMPTZ)
LANGUAGE sql AS $$
    INSERT INTO app.voice_call_events AS e
        (call_id, event_key, event_type, details, occurred_at)
    VALUES
        (p_call_id, p_event_key, p_event_type, CAST(COALESCE(p_details, '{}') AS JSONB), COALESCE(p_occurred_at, now()))
    ON CONFLICT ON CONSTRAINT voice_call_events_event_key_unique DO NOTHING
    RETURNING e.id, e.call_id, e.event_key, e.event_type, e.details, e.occurred_at
$$;

CREATE FUNCTION app.referral_create(p_call_id UUID, p_resource_slug TEXT, p_status TEXT)
RETURNS TABLE (id UUID, call_id UUID, resource_id UUID, status TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql AS $$
    INSERT INTO app.referrals AS f (call_id, resource_id, status)
    SELECT p_call_id, r.id, COALESCE(p_status, 'offered')
    FROM app.resources r
    WHERE r.slug = p_resource_slug AND r.active AND NOT r.is_emergency
    ON CONFLICT ON CONSTRAINT referrals_call_resource_unique DO UPDATE SET
        status = EXCLUDED.status,
        updated_at = now()
    RETURNING f.id, f.call_id, f.resource_id, f.status, f.created_at
$$;

CREATE FUNCTION app.referral_outcome_record(p_referral_id UUID, p_status TEXT, p_reason_code TEXT)
RETURNS TABLE (id UUID, referral_id UUID, status TEXT, reason_code TEXT, recorded_at TIMESTAMPTZ)
LANGUAGE sql AS $$
    INSERT INTO app.referral_outcomes AS o (referral_id, status, reason_code)
    SELECT f.id, p_status, p_reason_code
    FROM app.referrals f
    WHERE f.id = p_referral_id
    ON CONFLICT ON CONSTRAINT referral_outcomes_referral_unique DO UPDATE SET
        status = EXCLUDED.status,
        reason_code = EXCLUDED.reason_code,
        recorded_at = now()
    RETURNING o.id, o.referral_id, o.status, o.reason_code, o.recorded_at
$$;

CREATE FUNCTION app.voice_impact_summary()
RETURNS TABLE (
    total_calls BIGINT, emergency_redirects BIGINT, referrals_offered BIGINT,
    transfers_connected BIGINT, follow_ups_completed BIGINT
)
LANGUAGE sql STABLE AS $$
    SELECT
        (SELECT count(*) FROM app.voice_calls),
        (SELECT count(*) FROM app.voice_calls c WHERE c.urgency_tier = 'emergency'),
        (SELECT count(*) FROM app.referrals),
        (SELECT count(*) FROM app.referral_outcomes o WHERE o.status = 'connected'),
        (SELECT count(*) FROM app.referral_outcomes o WHERE o.status = 'completed')
$$;

CREATE FUNCTION app.voice_impact_categories()
RETURNS TABLE (category TEXT, count BIGINT)
LANGUAGE sql STABLE AS $$
    SELECT c.need_category, count(*)
    FROM app.voice_calls c
    WHERE c.need_category IS NOT NULL
    GROUP BY c.need_category
    ORDER BY count(*) DESC, c.need_category
$$;

CREATE FUNCTION app.voice_active_referrals()
RETURNS TABLE (
    id UUID, category TEXT, resource_name TEXT, status TEXT,
    urgency_tier TEXT, neighborhood TEXT, created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
    SELECT f.id, c.need_category, r.name, f.status,
           c.urgency_tier, c.neighborhood, f.created_at
    FROM app.referrals f
    JOIN app.voice_calls c ON c.id = f.call_id
    JOIN app.resources r ON r.id = f.resource_id
    LEFT JOIN app.referral_outcomes o ON o.referral_id = f.id
    WHERE o.status IS NULL OR o.status IN ('voicemail', 'no_answer', 'follow_up_needed')
    ORDER BY
        CASE c.urgency_tier WHEN 'emergency' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END,
        f.created_at
    LIMIT 50
$$;
