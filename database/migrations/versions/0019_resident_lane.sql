-- 0019: the resident lane.
--   * Open bed counts on a resource (Figma R3 "12 beds"): staff enter them,
--     residents see them on Nearby while they are fresh.
--   * Weather alerts the worker has acted on, once each: cold and heat
--     alerts give every open homelessness case a check-in task.
--   * Community alerts (Figma R5): residents who opt in get a push for a
--     serious weather alert. The `community_alert` notification kind.
--   * Push for requests sent without an account: a phone subscribes to one
--     request with its number and access code.

-- =============================================================================
-- BED COUNTS
-- =============================================================================

ALTER TABLE app.resources
    ADD COLUMN beds_available  INTEGER CHECK (beds_available BETWEEN 0 AND 10000),
    ADD COLUMN beds_updated_at TIMESTAMPTZ,
    ADD COLUMN beds_updated_by UUID REFERENCES app.users (id) ON DELETE SET NULL,
    ADD CONSTRAINT resources_beds_dated CHECK ((beds_available IS NULL) = (beds_updated_at IS NULL));

-- p_beds NULL clears the count ("we don't know").
CREATE FUNCTION app.resource_beds_set(p_resource_id UUID, p_beds INTEGER, p_updated_by UUID)
RETURNS SETOF app.resources
LANGUAGE sql AS $$
    UPDATE app.resources AS r
    SET beds_available = p_beds,
        beds_updated_at = CASE WHEN p_beds IS NULL THEN NULL ELSE now() END,
        beds_updated_by = p_updated_by
    WHERE r.id = p_resource_id
    RETURNING r.*
$$;

-- =============================================================================
-- WEATHER ALERTS THE WORKER HAS ACTED ON
-- =============================================================================

-- One row per alert, written when the worker first sees it in effect; its
-- primary key is what makes the outreach happen once across replicas.
CREATE TABLE app.weather_alert_handled (
    source      TEXT NOT NULL,
    external_id TEXT NOT NULL,
    handled_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source, external_id)
);

-- Alerts in effect that no worker has handled yet, marked handled as they
-- are returned. Call it inside the transaction that acts on them: a
-- rollback leaves them for the next round.
CREATE FUNCTION app.weather_alert_claim_new()
RETURNS SETOF app.weather_alerts
LANGUAGE sql AS $$
    WITH claimed AS (
        INSERT INTO app.weather_alert_handled (source, external_id)
        SELECT w.source, w.external_id FROM app.weather_alerts w
        WHERE (w.effective_at IS NULL OR w.effective_at <= now())
          AND (w.expires_at IS NULL OR w.expires_at > now())
        ON CONFLICT DO NOTHING
        RETURNING source, external_id
    )
    SELECT w.* FROM app.weather_alerts w JOIN claimed c USING (source, external_id)
$$;

-- A check-in task on every open homelessness case. Unassigned tasks follow
-- whoever holds the case. Returns the new tasks' ids.
CREATE FUNCTION app.weather_outreach_tasks(p_title TEXT, p_detail TEXT, p_due_at TIMESTAMPTZ)
RETURNS TABLE (id UUID)
LANGUAGE sql AS $$
    INSERT INTO app.tasks AS t (case_id, title, detail, due_at)
    SELECT c.id, p_title, p_detail, p_due_at FROM app.cases c
    WHERE c.category = 'homelessness' AND c.status NOT IN ('resolved', 'closed')
    RETURNING t.id
$$;

-- =============================================================================
-- COMMUNITY ALERTS
-- =============================================================================

-- Opted in. Off by default: a buzz at the wrong moment can put someone at
-- risk, so a resident chooses it (Me -> Community alerts).
CREATE TABLE app.community_alert_subscribers (
    user_id    UUID PRIMARY KEY REFERENCES app.users (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE FUNCTION app.community_alerts_get(p_user_id UUID)
RETURNS TABLE (subscribed BOOLEAN)
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM app.community_alert_subscribers s WHERE s.user_id = p_user_id)
$$;

CREATE FUNCTION app.community_alerts_set(p_user_id UUID, p_subscribed BOOLEAN)
RETURNS TABLE (subscribed BOOLEAN)
LANGUAGE plpgsql AS $$
BEGIN
    IF p_subscribed THEN
        INSERT INTO app.community_alert_subscribers (user_id) VALUES (p_user_id) ON CONFLICT DO NOTHING;
    ELSE
        DELETE FROM app.community_alert_subscribers s WHERE s.user_id = p_user_id;
    END IF;
    RETURN QUERY SELECT p_subscribed;
END
$$;

CREATE FUNCTION app.community_alert_recipients()
RETURNS TABLE (user_id UUID)
LANGUAGE sql STABLE AS $$
    SELECT s.user_id FROM app.community_alert_subscribers s ORDER BY s.created_at
$$;

-- 0018's kinds plus community_alert.
ALTER TABLE app.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE app.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
    'assignment', 'reply', 'request_update', 'task_due', 'referral_update', 'test',
    'urgent_offer', 'urgent_unanswered', 'community_alert'));

-- 0018's view; residents may now also read their community alerts.
CREATE OR REPLACE VIEW app.notification_view AS
SELECT n.id, n.user_id, n.kind, n.case_id, c.number AS case_number, c.title AS case_title,
       c.status AS case_status, n.task_id, t.title AS task_title, n.created_at, n.read_at,
       s.staff AS reader_is_staff,
       CASE WHEN s.staff OR u.visibility = 'public' THEN u.update_type END AS update_type,
       CASE WHEN s.staff OR u.visibility = 'public' THEN u.content END AS update_content,
       CASE WHEN s.staff THEN a.display_name END AS actor_name,
       CASE WHEN s.staff THEN c.contact_name END AS contact_name,
       CASE WHEN s.staff THEN f.status END AS referral_status,
       CASE WHEN s.staff THEN res.name END AS resource_name,
       n.alert_id
FROM app.notifications n
JOIN app.users reader ON reader.id = n.user_id
CROSS JOIN LATERAL (SELECT reader.role IN ('worker', 'admin') AS staff) s
LEFT JOIN app.cases c ON c.id = n.case_id
LEFT JOIN app.case_updates u ON u.id = n.case_update_id
LEFT JOIN app.tasks t ON t.id = n.task_id
LEFT JOIN app.case_referrals f ON f.id = n.referral_id
LEFT JOIN app.resources res ON res.id = f.resource_id
LEFT JOIN app.users a ON a.id = n.actor_id
WHERE s.staff OR n.kind IN ('request_update', 'test', 'community_alert');

-- =============================================================================
-- PUSH FOR REQUESTS SENT WITHOUT AN ACCOUNT
-- =============================================================================

-- A phone that holds a request's access code and asked to hear about it.
-- The code already opens the whole public thread, so subscribing gives its
-- holder nothing more; the push itself is generic ("You have a new
-- update"). At most 3 phones per request: a 4th replaces the oldest.
CREATE TABLE app.request_push_subscriptions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id         UUID NOT NULL REFERENCES app.cases (id) ON DELETE CASCADE,
    token           TEXT NOT NULL CHECK (length(token) BETWEEN 1 AND 200),
    platform        TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
    environment     TEXT CHECK (environment IN ('sandbox', 'production')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    disabled_at     TIMESTAMPTZ,
    disabled_reason TEXT,
    CONSTRAINT request_push_case_token UNIQUE (case_id, token)
);

-- Subscribe, if p_number and p_code_hash match a request. No row back: no
-- such request (a wrong number or code alike).
CREATE FUNCTION app.request_push_subscribe(
    p_number INTEGER, p_code_hash BYTEA, p_token TEXT, p_platform TEXT, p_environment TEXT)
RETURNS TABLE (case_id UUID)
LANGUAGE plpgsql AS $$
DECLARE
    v_case UUID;
BEGIN
    SELECT c.id INTO v_case FROM app.cases c WHERE c.number = p_number AND c.access_code_hash = p_code_hash;
    IF v_case IS NULL THEN
        RETURN;
    END IF;
    INSERT INTO app.request_push_subscriptions AS s (case_id, token, platform, environment)
    VALUES (v_case, p_token, p_platform, p_environment)
    ON CONFLICT ON CONSTRAINT request_push_case_token DO UPDATE
    SET platform = EXCLUDED.platform, environment = EXCLUDED.environment, created_at = now(),
        disabled_at = NULL, disabled_reason = NULL;
    DELETE FROM app.request_push_subscriptions s
    WHERE s.case_id = v_case AND s.id NOT IN (
        SELECT k.id FROM app.request_push_subscriptions k
        WHERE k.case_id = v_case AND k.disabled_at IS NULL
        ORDER BY k.created_at DESC LIMIT 3);
    RETURN QUERY SELECT v_case;
END
$$;

CREATE FUNCTION app.request_push_unsubscribe(p_number INTEGER, p_code_hash BYTEA, p_token TEXT)
RETURNS TABLE (removed BIGINT)
LANGUAGE sql AS $$
    WITH gone AS (
        DELETE FROM app.request_push_subscriptions s
        USING app.cases c
        WHERE s.case_id = c.id AND c.number = p_number AND c.access_code_hash = p_code_hash AND s.token = p_token
        RETURNING 1
    )
    SELECT count(*) FROM gone
$$;

-- The phones to push for an update on p_case_id. A request closed more
-- than 7 days ago has nobody left listening.
CREATE FUNCTION app.request_push_targets(p_case_id UUID)
RETURNS TABLE (id UUID, token TEXT, environment TEXT)
LANGUAGE sql STABLE AS $$
    SELECT s.id, s.token, s.environment FROM app.request_push_subscriptions s
    JOIN app.cases c ON c.id = s.case_id
    WHERE s.case_id = p_case_id AND s.disabled_at IS NULL AND s.platform = 'ios'
      AND NOT (c.status IN ('resolved', 'closed') AND c.updated_at < now() - interval '7 days')
    ORDER BY s.created_at
$$;

CREATE FUNCTION app.request_push_disable(p_id UUID, p_reason TEXT)
RETURNS TABLE (id UUID)
LANGUAGE sql AS $$
    UPDATE app.request_push_subscriptions s SET disabled_at = now(), disabled_reason = p_reason
    WHERE s.id = p_id AND s.disabled_at IS NULL
    RETURNING s.id
$$;
