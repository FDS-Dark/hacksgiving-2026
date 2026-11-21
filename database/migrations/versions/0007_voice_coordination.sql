-- Privacy-first voice coordination. No audio, transcript, caller phone number,
-- exact address, or free-form case narrative is stored in these tables.

CREATE TABLE app.voice_resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    phone_e164 TEXT,
    languages TEXT[] NOT NULL DEFAULT ARRAY['en']::TEXT[],
    service_area TEXT NOT NULL DEFAULT 'Milwaukee',
    hours_label TEXT,
    transfer_approved BOOLEAN NOT NULL DEFAULT false,
    is_emergency BOOLEAN NOT NULL DEFAULT false,
    active BOOLEAN NOT NULL DEFAULT true,
    priority INTEGER NOT NULL DEFAULT 100,
    last_verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT voice_resources_slug_plain CHECK (slug ~ '^[a-z][a-z0-9-]{0,62}$'),
    CONSTRAINT voice_resources_phone_e164 CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
    CONSTRAINT voice_resources_emergency_not_transferable CHECK (NOT is_emergency OR NOT transfer_approved)
);

CREATE TABLE app.voice_calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL DEFAULT 'elevenlabs',
    conversation_id TEXT NOT NULL,
    language TEXT,
    need_category TEXT,
    urgency_tier TEXT,
    neighborhood TEXT,
    callback_consent BOOLEAN NOT NULL DEFAULT false,
    disposition TEXT,
    caller_hash TEXT,
    linked_user_id UUID REFERENCES app.users(id) ON DELETE SET NULL,
    event_timestamp BIGINT NOT NULL,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    retention_delete_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '30 days',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT voice_calls_conversation_unique UNIQUE (conversation_id),
    CONSTRAINT voice_calls_language_length CHECK (language IS NULL OR length(language) <= 12),
    CONSTRAINT voice_calls_category_length CHECK (need_category IS NULL OR length(need_category) <= 64),
    CONSTRAINT voice_calls_urgency CHECK (urgency_tier IS NULL OR urgency_tier IN ('emergency', 'urgent', 'routine')),
    CONSTRAINT voice_calls_neighborhood_length CHECK (neighborhood IS NULL OR length(neighborhood) <= 80),
    CONSTRAINT voice_calls_disposition_length CHECK (disposition IS NULL OR length(disposition) <= 64),
    CONSTRAINT voice_calls_caller_hash_length CHECK (caller_hash IS NULL OR length(caller_hash) = 64)
);
CREATE INDEX voice_calls_linked_user_idx ON app.voice_calls (linked_user_id, created_at DESC)
    WHERE linked_user_id IS NOT NULL;

CREATE TABLE app.voice_call_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id UUID NOT NULL REFERENCES app.voice_calls(id) ON DELETE CASCADE,
    event_key TEXT NOT NULL,
    event_type TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::JSONB,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT voice_call_events_event_key_unique UNIQUE (event_key),
    CONSTRAINT voice_call_events_type_length CHECK (length(event_type) BETWEEN 1 AND 64),
    CONSTRAINT voice_call_events_details_object CHECK (jsonb_typeof(details) = 'object')
);
CREATE INDEX voice_call_events_call_idx ON app.voice_call_events (call_id, occurred_at);

-- A handoff code is the only bridge from an anonymous call to an account.
-- Store only a keyed hash; the spoken code expires quickly and is single-use.
CREATE TABLE app.voice_handoffs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id UUID NOT NULL UNIQUE REFERENCES app.voice_calls(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL UNIQUE,
    caller_hash TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    claimed_by UUID REFERENCES app.users(id) ON DELETE CASCADE,
    claimed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT voice_handoffs_hash_length CHECK (length(code_hash) = 64),
    CONSTRAINT voice_handoffs_caller_hash_length CHECK (caller_hash IS NULL OR length(caller_hash) = 64),
    CONSTRAINT voice_handoffs_claim_pair CHECK (
        (claimed_by IS NULL AND claimed_at IS NULL) OR
        (claimed_by IS NOT NULL AND claimed_at IS NOT NULL)
    )
);
CREATE INDEX voice_handoffs_user_idx ON app.voice_handoffs (claimed_by, claimed_at DESC)
    WHERE claimed_by IS NOT NULL;

CREATE TABLE app.voice_account_phones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    caller_hash TEXT NOT NULL UNIQUE,
    verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT voice_account_phones_hash_length CHECK (length(caller_hash) = 64),
    CONSTRAINT voice_account_phones_user_hash_unique UNIQUE (user_id, caller_hash)
);

CREATE TABLE app.voice_referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id UUID NOT NULL REFERENCES app.voice_calls(id) ON DELETE CASCADE,
    resource_id UUID NOT NULL REFERENCES app.voice_resources(id),
    status TEXT NOT NULL DEFAULT 'offered',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT voice_referrals_status CHECK (status IN ('offered', 'accepted', 'transfer_attempted', 'connected', 'declined', 'unavailable')),
    CONSTRAINT voice_referrals_call_resource_unique UNIQUE (call_id, resource_id)
);

CREATE TABLE app.voice_referral_outcomes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referral_id UUID NOT NULL REFERENCES app.voice_referrals(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    reason_code TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT voice_referral_outcomes_referral_unique UNIQUE (referral_id),
    CONSTRAINT voice_referral_outcomes_status CHECK (status IN ('connected', 'voicemail', 'no_answer', 'declined', 'unavailable', 'follow_up_needed', 'completed')),
    CONSTRAINT voice_referral_outcomes_reason_length CHECK (reason_code IS NULL OR length(reason_code) <= 64)
);

INSERT INTO app.voice_resources
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

CREATE FUNCTION app.voice_resource_list(p_category TEXT, p_language TEXT)
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
    FROM app.voice_resources r
    WHERE r.active
      AND (p_category IS NULL OR r.category = p_category)
      AND (p_language IS NULL OR p_language = ANY(r.languages))
    ORDER BY r.is_emergency DESC, r.priority, r.name
$$;

CREATE FUNCTION app.voice_call_ingest(
    p_conversation_id TEXT, p_event_timestamp BIGINT, p_language TEXT,
    p_need_category TEXT, p_urgency_tier TEXT, p_neighborhood TEXT,
    p_callback_consent BOOLEAN, p_disposition TEXT, p_caller_hash TEXT, p_started_at TIMESTAMPTZ,
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
        (conversation_id, event_timestamp, language, need_category, urgency_tier,
         neighborhood, callback_consent, disposition, caller_hash, linked_user_id,
         started_at, ended_at)
    VALUES
        (p_conversation_id, p_event_timestamp, p_language, p_need_category,
         p_urgency_tier, p_neighborhood, COALESCE(p_callback_consent, false),
         p_disposition, p_caller_hash,
         (SELECT a.user_id FROM app.voice_account_phones a WHERE a.caller_hash = p_caller_hash),
         p_started_at, p_ended_at)
    ON CONFLICT ON CONSTRAINT voice_calls_conversation_unique DO UPDATE SET
        event_timestamp = GREATEST(c.event_timestamp, EXCLUDED.event_timestamp),
        language = COALESCE(EXCLUDED.language, c.language),
        need_category = COALESCE(EXCLUDED.need_category, c.need_category),
        urgency_tier = COALESCE(EXCLUDED.urgency_tier, c.urgency_tier),
        neighborhood = COALESCE(EXCLUDED.neighborhood, c.neighborhood),
        callback_consent = c.callback_consent OR EXCLUDED.callback_consent,
        disposition = COALESCE(EXCLUDED.disposition, c.disposition),
        caller_hash = COALESCE(EXCLUDED.caller_hash, c.caller_hash),
        linked_user_id = COALESCE(c.linked_user_id, EXCLUDED.linked_user_id),
        started_at = COALESCE(EXCLUDED.started_at, c.started_at),
        ended_at = COALESCE(EXCLUDED.ended_at, c.ended_at), updated_at = now()
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
    INSERT INTO app.voice_call_events AS e (call_id, event_key, event_type, details, occurred_at)
    VALUES (p_call_id, p_event_key, p_event_type, CAST(COALESCE(p_details, '{}') AS JSONB), COALESCE(p_occurred_at, now()))
    ON CONFLICT ON CONSTRAINT voice_call_events_event_key_unique DO NOTHING
    RETURNING e.id, e.call_id, e.event_key, e.event_type, e.details, e.occurred_at
$$;

CREATE FUNCTION app.voice_referral_create(p_call_id UUID, p_resource_slug TEXT, p_status TEXT)
RETURNS TABLE (id UUID, call_id UUID, resource_id UUID, status TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql AS $$
    INSERT INTO app.voice_referrals AS f (call_id, resource_id, status)
    SELECT p_call_id, r.id, COALESCE(p_status, 'offered')
    FROM app.voice_resources r
    WHERE r.slug = p_resource_slug AND r.active AND NOT r.is_emergency
    ON CONFLICT ON CONSTRAINT voice_referrals_call_resource_unique DO UPDATE SET
        status = EXCLUDED.status, updated_at = now()
    RETURNING f.id, f.call_id, f.resource_id, f.status, f.created_at
$$;

CREATE FUNCTION app.voice_handoff_create(
    p_call_id UUID, p_code_hash TEXT, p_caller_hash TEXT, p_expires_at TIMESTAMPTZ
)
RETURNS TABLE (id UUID, call_id UUID, expires_at TIMESTAMPTZ)
LANGUAGE sql AS $$
    WITH linked_call AS (
        UPDATE app.voice_calls AS c
        SET caller_hash = COALESCE(p_caller_hash, c.caller_hash),
            linked_user_id = COALESCE(
                c.linked_user_id,
                (SELECT a.user_id FROM app.voice_account_phones a
                 WHERE a.caller_hash = p_caller_hash)
            ),
            updated_at = now()
        WHERE c.id = p_call_id
        RETURNING c.id
    )
    INSERT INTO app.voice_handoffs AS h (call_id, code_hash, caller_hash, expires_at)
    SELECT l.id, p_code_hash, p_caller_hash, p_expires_at FROM linked_call l
    WHERE true
    ON CONFLICT (call_id) DO UPDATE SET
        code_hash = CASE WHEN h.claimed_by IS NULL THEN EXCLUDED.code_hash ELSE h.code_hash END,
        caller_hash = CASE WHEN h.claimed_by IS NULL THEN EXCLUDED.caller_hash ELSE h.caller_hash END,
        expires_at = CASE WHEN h.claimed_by IS NULL THEN EXCLUDED.expires_at ELSE h.expires_at END
    RETURNING h.id, h.call_id, h.expires_at
$$;

CREATE FUNCTION app.voice_handoff_claim(p_code_hash TEXT, p_user_id UUID)
RETURNS TABLE (
    id UUID, call_id UUID, need_category TEXT, urgency_tier TEXT,
    disposition TEXT, resources TEXT[], linked_at TIMESTAMPTZ
)
LANGUAGE sql AS $$
    WITH claimed AS (
        UPDATE app.voice_handoffs AS h
        SET claimed_by = p_user_id, claimed_at = now()
        WHERE h.code_hash = p_code_hash
          AND h.claimed_by IS NULL
          AND h.expires_at > now()
        RETURNING h.call_id, h.caller_hash, h.claimed_at
    ), phone_link AS (
        INSERT INTO app.voice_account_phones AS a (user_id, caller_hash)
        SELECT p_user_id, x.caller_hash FROM claimed x WHERE x.caller_hash IS NOT NULL
        ON CONFLICT (caller_hash) DO UPDATE SET
            user_id = EXCLUDED.user_id, verified_at = now()
        RETURNING a.caller_hash
    ), linked_call AS (
        UPDATE app.voice_calls AS c SET linked_user_id = p_user_id, updated_at = now()
        FROM claimed x WHERE c.id = x.call_id
        RETURNING c.id
    )
    SELECT c.id, c.id, c.need_category, c.urgency_tier, c.disposition,
           COALESCE(array_agg(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL), ARRAY[]::TEXT[]),
           x.claimed_at
    FROM claimed x
    JOIN app.voice_calls c ON c.id = x.call_id
    JOIN linked_call l ON l.id = c.id
    LEFT JOIN app.voice_referrals f ON f.call_id = c.id
    LEFT JOIN app.voice_resources r ON r.id = f.resource_id
    GROUP BY c.id, c.need_category, c.urgency_tier, c.disposition, x.claimed_at
$$;

CREATE FUNCTION app.voice_follow_up_list(p_user_id UUID)
RETURNS TABLE (
    id UUID, call_id UUID, need_category TEXT, urgency_tier TEXT,
    disposition TEXT, resources TEXT[], linked_at TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
    SELECT c.id, c.id, c.need_category, c.urgency_tier, c.disposition,
           COALESCE(array_agg(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL), ARRAY[]::TEXT[]),
           COALESCE(h.claimed_at, c.created_at)
    FROM app.voice_calls c
    LEFT JOIN app.voice_handoffs h ON h.call_id = c.id AND h.claimed_by = p_user_id
    LEFT JOIN app.voice_referrals f ON f.call_id = c.id
    LEFT JOIN app.voice_resources r ON r.id = f.resource_id
    WHERE c.linked_user_id = p_user_id
    GROUP BY c.id, c.need_category, c.urgency_tier, c.disposition, h.claimed_at, c.created_at
    ORDER BY COALESCE(h.claimed_at, c.created_at) DESC
$$;

CREATE FUNCTION app.voice_referral_outcome_record(p_referral_id UUID, p_status TEXT, p_reason_code TEXT)
RETURNS TABLE (id UUID, referral_id UUID, status TEXT, reason_code TEXT, recorded_at TIMESTAMPTZ)
LANGUAGE sql AS $$
    INSERT INTO app.voice_referral_outcomes AS o (referral_id, status, reason_code)
    SELECT f.id, p_status, p_reason_code FROM app.voice_referrals f WHERE f.id = p_referral_id
    ON CONFLICT ON CONSTRAINT voice_referral_outcomes_referral_unique DO UPDATE SET
        status = EXCLUDED.status, reason_code = EXCLUDED.reason_code, recorded_at = now()
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
        (SELECT count(*) FROM app.voice_referrals),
        (SELECT count(*) FROM app.voice_referral_outcomes o WHERE o.status = 'connected'),
        (SELECT count(*) FROM app.voice_referral_outcomes o WHERE o.status = 'completed')
$$;

CREATE FUNCTION app.voice_impact_categories()
RETURNS TABLE (category TEXT, count BIGINT)
LANGUAGE sql STABLE AS $$
    SELECT c.need_category, count(*) FROM app.voice_calls c
    WHERE c.need_category IS NOT NULL
    GROUP BY c.need_category ORDER BY count(*) DESC, c.need_category
$$;

CREATE FUNCTION app.voice_active_referrals()
RETURNS TABLE (
    id UUID, category TEXT, resource_name TEXT, status TEXT,
    urgency_tier TEXT, neighborhood TEXT, created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
    SELECT f.id, c.need_category, r.name, f.status,
           c.urgency_tier, c.neighborhood, f.created_at
    FROM app.voice_referrals f
    JOIN app.voice_calls c ON c.id = f.call_id
    JOIN app.voice_resources r ON r.id = f.resource_id
    LEFT JOIN app.voice_referral_outcomes o ON o.referral_id = f.id
    WHERE o.status IS NULL OR o.status IN ('voicemail', 'no_answer', 'follow_up_needed')
    ORDER BY CASE c.urgency_tier WHEN 'emergency' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END,
             f.created_at
    LIMIT 50
$$;
