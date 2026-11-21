-- Structured resident referral history and staff review. These views expose no
-- audio, transcript, caller phone number, exact address or free-form call text.

CREATE FUNCTION app.voice_referral_list_for_user(p_user_id UUID)
RETURNS TABLE (
    id UUID, call_id UUID, need_category TEXT, resource_slug TEXT,
    resource_name TEXT, resource_category TEXT, resource_description TEXT,
    phone_e164 TEXT, languages TEXT[], service_area TEXT, hours_label TEXT,
    status TEXT, outcome_status TEXT, outcome_reason_code TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
    SELECT f.id, c.id, c.need_category, r.slug, r.name, r.category,
           r.description, r.phone_e164, r.languages, r.service_area,
           r.hours_label, f.status, o.status, o.reason_code, f.created_at
    FROM app.voice_referrals f
    JOIN app.voice_calls c ON c.id = f.call_id
    JOIN app.voice_resources r ON r.id = f.resource_id
    LEFT JOIN app.voice_referral_outcomes o ON o.referral_id = f.id
    WHERE c.linked_user_id = p_user_id
    ORDER BY f.created_at DESC
$$;

CREATE FUNCTION app.voice_referral_get_for_user(p_user_id UUID, p_referral_id UUID)
RETURNS TABLE (
    id UUID, call_id UUID, need_category TEXT, resource_slug TEXT,
    resource_name TEXT, resource_category TEXT, resource_description TEXT,
    phone_e164 TEXT, languages TEXT[], service_area TEXT, hours_label TEXT,
    status TEXT, outcome_status TEXT, outcome_reason_code TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
    SELECT f.id, c.id, c.need_category, r.slug, r.name, r.category,
           r.description, r.phone_e164, r.languages, r.service_area,
           r.hours_label, f.status, o.status, o.reason_code, f.created_at
    FROM app.voice_referrals f
    JOIN app.voice_calls c ON c.id = f.call_id
    JOIN app.voice_resources r ON r.id = f.resource_id
    LEFT JOIN app.voice_referral_outcomes o ON o.referral_id = f.id
    WHERE c.linked_user_id = p_user_id AND f.id = p_referral_id
$$;

CREATE FUNCTION app.voice_call_review_list()
RETURNS TABLE (
    id UUID, need_category TEXT, urgency_tier TEXT, callback_consent BOOLEAN,
    disposition TEXT, started_at TIMESTAMPTZ, ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ, referral_count BIGINT, referral_names TEXT[],
    request_id UUID, request_number BIGINT
)
LANGUAGE sql STABLE AS $$
    SELECT c.id, c.need_category, c.urgency_tier, c.callback_consent,
           c.disposition, c.started_at, c.ended_at, c.created_at,
           (SELECT count(*) FROM app.voice_referrals f WHERE f.call_id = c.id),
           COALESCE((
               SELECT array_agg(DISTINCT r.name ORDER BY r.name)
               FROM app.voice_referrals f
               JOIN app.voice_resources r ON r.id = f.resource_id
               WHERE f.call_id = c.id
           ), ARRAY[]::TEXT[]),
           (
               SELECT NULLIF(e.details->>'request_id', '')::UUID
               FROM app.voice_call_events e
               WHERE e.call_id = c.id AND e.event_type = 'case_submitted'
               ORDER BY e.occurred_at DESC LIMIT 1
           ),
           (
               SELECT (e.details->>'request_number')::BIGINT
               FROM app.voice_call_events e
               WHERE e.call_id = c.id AND e.event_type = 'case_submitted'
               ORDER BY e.occurred_at DESC LIMIT 1
           )
    FROM app.voice_calls c
    ORDER BY COALESCE(c.started_at, c.created_at) DESC
    LIMIT 200
$$;

CREATE FUNCTION app.voice_call_review_get(p_call_id UUID)
RETURNS TABLE (
    id UUID, need_category TEXT, urgency_tier TEXT, callback_consent BOOLEAN,
    disposition TEXT, started_at TIMESTAMPTZ, ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ, referral_count BIGINT, referral_names TEXT[],
    request_id UUID, request_number BIGINT
)
LANGUAGE sql STABLE AS $$
    -- The list intentionally caps the staff inbox at 200 rows. Detail lookup
    -- must query by id directly so an older bookmarked call remains reviewable.
    SELECT c.id, c.need_category, c.urgency_tier, c.callback_consent,
           c.disposition, c.started_at, c.ended_at, c.created_at,
           (SELECT count(*) FROM app.voice_referrals f WHERE f.call_id = c.id),
           COALESCE((
               SELECT array_agg(DISTINCT r.name ORDER BY r.name)
               FROM app.voice_referrals f
               JOIN app.voice_resources r ON r.id = f.resource_id
               WHERE f.call_id = c.id
           ), ARRAY[]::TEXT[]),
           (
               SELECT NULLIF(e.details->>'request_id', '')::UUID
               FROM app.voice_call_events e
               WHERE e.call_id = c.id AND e.event_type = 'case_submitted'
               ORDER BY e.occurred_at DESC LIMIT 1
           ),
           (
               SELECT (e.details->>'request_number')::BIGINT
               FROM app.voice_call_events e
               WHERE e.call_id = c.id AND e.event_type = 'case_submitted'
               ORDER BY e.occurred_at DESC LIMIT 1
           )
    FROM app.voice_calls c
    WHERE c.id = p_call_id
$$;

CREATE FUNCTION app.voice_referral_list_for_call(p_call_id UUID)
RETURNS TABLE (
    id UUID, call_id UUID, need_category TEXT, resource_slug TEXT,
    resource_name TEXT, resource_category TEXT, resource_description TEXT,
    phone_e164 TEXT, languages TEXT[], service_area TEXT, hours_label TEXT,
    status TEXT, outcome_status TEXT, outcome_reason_code TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
    SELECT f.id, c.id, c.need_category, r.slug, r.name, r.category,
           r.description, r.phone_e164, r.languages, r.service_area,
           r.hours_label, f.status, o.status, o.reason_code, f.created_at
    FROM app.voice_referrals f
    JOIN app.voice_calls c ON c.id = f.call_id
    JOIN app.voice_resources r ON r.id = f.resource_id
    LEFT JOIN app.voice_referral_outcomes o ON o.referral_id = f.id
    WHERE c.id = p_call_id
    ORDER BY f.created_at
$$;
