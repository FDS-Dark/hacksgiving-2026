DROP FUNCTION app.voice_checkpoint_resume;
DROP FUNCTION app.voice_contact_plan_get;
DROP FUNCTION app.voice_case_contact_plan_add;
DROP FUNCTION app.voice_referral_follow_up_list;
DROP FUNCTION app.voice_referral_follow_up_due;
DROP FUNCTION app.voice_referral_outcome_record_for_user;
DROP FUNCTION app.voice_impact_funnel;

DROP FUNCTION app.voice_referral_create;
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

DROP FUNCTION app.voice_referral_outcome_record;
CREATE FUNCTION app.voice_referral_outcome_record(p_referral_id UUID, p_status TEXT, p_reason_code TEXT)
RETURNS TABLE (id UUID, referral_id UUID, status TEXT, reason_code TEXT, recorded_at TIMESTAMPTZ)
LANGUAGE sql AS $$
    INSERT INTO app.voice_referral_outcomes AS o (referral_id, status, reason_code)
    SELECT f.id, p_status, p_reason_code FROM app.voice_referrals f WHERE f.id = p_referral_id
    ON CONFLICT ON CONSTRAINT voice_referral_outcomes_referral_unique DO UPDATE SET
        status = EXCLUDED.status, reason_code = EXCLUDED.reason_code, recorded_at = now()
    RETURNING o.id, o.referral_id, o.status, o.reason_code, o.recorded_at
$$;

ALTER TABLE app.voice_referrals DROP COLUMN follow_up_status, DROP COLUMN follow_up_due_at;
