-- Privacy-safe additions for the phone navigator. No transcript, raw caller
-- number, exact address or free-form narrative is introduced here.

ALTER TABLE app.voice_referrals
    ADD COLUMN follow_up_due_at TIMESTAMPTZ,
    ADD COLUMN follow_up_status TEXT NOT NULL DEFAULT 'not_scheduled'
        CONSTRAINT voice_referrals_follow_up_status_check
        CHECK (follow_up_status IN ('not_scheduled', 'pending', 'completed', 'needs_help'));

-- Same signature and return shape as 0007: callers do not need a coordinated
-- deployment. Accepted referrals receive a check-in one day later.
CREATE OR REPLACE FUNCTION app.voice_referral_create(p_call_id UUID, p_resource_slug TEXT, p_status TEXT)
RETURNS TABLE (id UUID, call_id UUID, resource_id UUID, status TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql AS $$
    INSERT INTO app.voice_referrals AS f
        (call_id, resource_id, status, follow_up_due_at, follow_up_status)
    SELECT p_call_id, r.id, COALESCE(p_status, 'offered'),
           CASE WHEN COALESCE(p_status, 'offered') IN ('accepted', 'transfer_attempted', 'connected')
                THEN now() + interval '1 day' END,
           CASE WHEN COALESCE(p_status, 'offered') IN ('accepted', 'transfer_attempted', 'connected')
                THEN 'pending' ELSE 'not_scheduled' END
    FROM app.voice_resources r
    WHERE r.slug = p_resource_slug AND r.active AND NOT r.is_emergency
    ON CONFLICT ON CONSTRAINT voice_referrals_call_resource_unique DO UPDATE SET
        status = EXCLUDED.status,
        follow_up_due_at = COALESCE(f.follow_up_due_at, EXCLUDED.follow_up_due_at),
        follow_up_status = CASE
            WHEN f.follow_up_status IN ('completed', 'needs_help') THEN f.follow_up_status
            ELSE EXCLUDED.follow_up_status
        END,
        updated_at = now()
    RETURNING f.id, f.call_id, f.resource_id, f.status, f.created_at
$$;

CREATE OR REPLACE FUNCTION app.voice_referral_outcome_record(p_referral_id UUID, p_status TEXT, p_reason_code TEXT)
RETURNS TABLE (id UUID, referral_id UUID, status TEXT, reason_code TEXT, recorded_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE app.voice_referrals f
    SET follow_up_status = CASE
            WHEN p_status IN ('connected', 'completed') THEN 'completed'
            WHEN p_status = 'follow_up_needed' THEN 'needs_help'
            ELSE f.follow_up_status
        END,
        updated_at = now()
    WHERE f.id = p_referral_id;

    RETURN QUERY
    INSERT INTO app.voice_referral_outcomes AS o (referral_id, status, reason_code)
    SELECT f.id, p_status, p_reason_code FROM app.voice_referrals f WHERE f.id = p_referral_id
    ON CONFLICT ON CONSTRAINT voice_referral_outcomes_referral_unique DO UPDATE SET
        status = EXCLUDED.status, reason_code = EXCLUDED.reason_code, recorded_at = now()
    RETURNING o.id, o.referral_id, o.status, o.reason_code, o.recorded_at;
END
$$;

CREATE FUNCTION app.voice_referral_outcome_record_for_user(
    p_user_id UUID, p_referral_id UUID, p_status TEXT, p_reason_code TEXT
)
RETURNS TABLE (id UUID, referral_id UUID, status TEXT, reason_code TEXT, recorded_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM app.voice_referrals f
        JOIN app.voice_calls c ON c.id = f.call_id
        WHERE f.id = p_referral_id AND c.linked_user_id = p_user_id
    ) THEN
        RETURN;
    END IF;
    RETURN QUERY SELECT * FROM app.voice_referral_outcome_record(
        p_referral_id, p_status, p_reason_code
    );
END
$$;

CREATE FUNCTION app.voice_referral_follow_up_list(p_user_id UUID, p_call_id UUID)
RETURNS TABLE (referral_id UUID, due_at TIMESTAMPTZ, status TEXT)
LANGUAGE sql STABLE AS $$
    SELECT f.id, f.follow_up_due_at, f.follow_up_status
    FROM app.voice_referrals f
    JOIN app.voice_calls c ON c.id = f.call_id
    WHERE (p_user_id IS NULL OR c.linked_user_id = p_user_id)
      AND (p_call_id IS NULL OR c.id = p_call_id)
    ORDER BY f.created_at DESC
$$;

CREATE FUNCTION app.voice_referral_follow_up_due()
RETURNS TABLE (
    referral_id UUID, call_id UUID, resource_name TEXT, due_at TIMESTAMPTZ,
    need_category TEXT, language TEXT, neighborhood TEXT
)
LANGUAGE sql STABLE AS $$
    SELECT f.id, c.id, r.name, f.follow_up_due_at,
           c.need_category, c.language, c.neighborhood
    FROM app.voice_referrals f
    JOIN app.voice_calls c ON c.id = f.call_id
    JOIN app.voice_resources r ON r.id = f.resource_id
    WHERE f.follow_up_status = 'pending' AND f.follow_up_due_at <= now()
    ORDER BY f.follow_up_due_at
    LIMIT 200
$$;

-- The checkpoint payload is a fixed allowlist written by the API. It contains
-- only routing state and expires from consideration after 24 hours.
CREATE FUNCTION app.voice_checkpoint_resume(p_caller_hash TEXT)
RETURNS TABLE (
    service TEXT, neighborhood TEXT, language TEXT, referral_slug TEXT,
    consent_pending BOOLEAN, saved_at TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
    SELECT e.details->>'service', e.details->>'neighborhood',
           e.details->>'language', e.details->>'referral_slug',
           COALESCE((e.details->>'consent_pending')::BOOLEAN, false), e.occurred_at
    FROM app.voice_call_events e
    JOIN app.voice_calls c ON c.id = e.call_id
    WHERE c.caller_hash = p_caller_hash
      AND e.event_type = 'structured_checkpoint'
      AND e.occurred_at >= now() - interval '24 hours'
    ORDER BY e.occurred_at DESC
    LIMIT 1
$$;

CREATE FUNCTION app.voice_contact_plan_get(p_call_id UUID)
RETURNS TABLE (
    contact_method TEXT, safe_to_contact BOOLEAN, voicemail_allowed BOOLEAN,
    neutral_message_only BOOLEAN, safe_contact_window TEXT
)
LANGUAGE sql STABLE AS $$
    SELECT e.details->>'contact_method',
           COALESCE((e.details->>'safe_to_contact')::BOOLEAN, false),
           COALESCE((e.details->>'voicemail_allowed')::BOOLEAN, false),
           COALESCE((e.details->>'neutral_message_only')::BOOLEAN, false),
           NULLIF(e.details->>'safe_contact_window', '')
    FROM app.voice_call_events e
    WHERE e.call_id = p_call_id AND e.event_type = 'case_submitted'
      AND e.details ? 'contact_method'
      AND e.details->>'contact_method' <> 'none'
    ORDER BY e.occurred_at DESC
    LIMIT 1
$$;

CREATE FUNCTION app.voice_case_contact_plan_add(
    p_case_id UUID, p_contact_method TEXT, p_safe_to_contact BOOLEAN,
    p_voicemail_allowed BOOLEAN, p_neutral_message_only BOOLEAN,
    p_safe_contact_window TEXT
)
RETURNS TABLE (added BOOLEAN)
LANGUAGE sql AS $$
    WITH inserted AS (
        INSERT INTO app.case_updates
            (case_id, author_id, update_type, visibility, content)
        SELECT c.id, NULL, 'note', 'internal',
               'Phone assistant contact plan: ' || replace(p_contact_method, '_', ' ')
               || '; safe to contact: ' || CASE WHEN p_safe_to_contact THEN 'yes' ELSE 'no' END
               || '; voicemail/message: ' || CASE WHEN p_voicemail_allowed THEN 'allowed' ELSE 'not allowed' END
               || CASE WHEN p_neutral_message_only THEN '; neutral message only—do not name ComForce or the reason' ELSE '' END
               || CASE WHEN NULLIF(p_safe_contact_window, '') IS NOT NULL
                       THEN '; approved window: ' || p_safe_contact_window ELSE '' END || '.'
        FROM app.cases c
        WHERE c.id = p_case_id AND p_contact_method IN ('call', 'text')
        RETURNING true
    )
    SELECT true FROM inserted
$$;

CREATE FUNCTION app.voice_impact_funnel()
RETURNS TABLE (
    routed_calls BIGINT, referrals_accepted BIGINT, connection_attempts BIGINT,
    residents_helped BIGINT, follow_ups_due BIGINT, incomplete_calls BIGINT,
    tool_failures BIGINT
)
LANGUAGE sql STABLE AS $$
    SELECT
        (SELECT count(*) FROM app.voice_calls c WHERE c.need_category IS NOT NULL),
        (SELECT count(*) FROM app.voice_referrals f WHERE f.status IN ('accepted', 'transfer_attempted', 'connected')),
        (SELECT count(*) FROM app.voice_referrals f WHERE f.status IN ('transfer_attempted', 'connected')),
        (SELECT count(*) FROM app.voice_referral_outcomes o WHERE o.status IN ('connected', 'completed')),
        (SELECT count(*) FROM app.voice_referrals f WHERE f.follow_up_status = 'pending' AND f.follow_up_due_at <= now()),
        (SELECT count(*) FROM app.voice_calls c WHERE c.ended_at IS NOT NULL AND c.disposition IS NULL),
        (SELECT count(*) FROM app.voice_call_events e WHERE e.event_type IN ('tool_failure', 'call_failed'))
$$;
