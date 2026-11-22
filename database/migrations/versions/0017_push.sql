-- =============================================================================
-- Push delivery (see 0017_push.py, and D4/D5 of docs/design/on-call-and-push.md).
--
-- app.push_devices: one row per installed app, by its APNs device token. The
-- upsert is by token, so a phone that changes hands moves to its new user.
-- app.notification_deliveries: one row per (notification, device), so a
-- notification goes to each device at most once in normal operation. A row
-- moves pending -> sending (committed before the APNs call) -> sent, failed
-- or back to pending for a retry. `reason` holds APNs' reason only, never
-- content: the push text is fixed per kind (D5) and lives in the API.
--
-- Also: notifications.expires_at (an urgent offer's apns-expiration), the
-- `test` kind (POST /v1/notifications/test), and notification_create gains
-- p_expires_at.
--
-- Same conventions as 0016: app.<domain>_<verb>, p_ parameters, no row means
-- not found, SECURITY INVOKER (revision 0002's default privileges give the
-- app role EXECUTE on these functions and DML on these tables).
-- =============================================================================

CREATE TABLE app.push_devices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token           TEXT NOT NULL CONSTRAINT push_devices_token_key UNIQUE
                        CONSTRAINT push_devices_token_check CHECK (token ~ '^[0-9a-f]{32,200}$'),
    user_id         UUID NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
    -- Android (FCM) later.
    platform        TEXT NOT NULL CONSTRAINT push_devices_platform_check CHECK (platform IN ('ios')),
    -- The APNs host the token belongs to.
    environment     TEXT NOT NULL CONSTRAINT push_devices_environment_check
                        CHECK (environment IN ('sandbox', 'production')),
    app_version     TEXT CONSTRAINT push_devices_app_version_check CHECK (length(app_version) <= 40),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Set when APNs says the token is dead, or when the user has more than
    -- 10 devices (the oldest goes). A disabled device comes back only when it
    -- registers with a different environment (a new token is a new row).
    disabled_at     TIMESTAMPTZ,
    disabled_reason TEXT CONSTRAINT push_devices_disabled_reason_check CHECK (length(disabled_reason) <= 100)
);

CREATE INDEX push_devices_user_active_idx ON app.push_devices (user_id) WHERE disabled_at IS NULL;
CREATE INDEX push_devices_last_seen_idx ON app.push_devices (last_seen_at);

CREATE TABLE app.notification_deliveries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id UUID NOT NULL REFERENCES app.notifications (id) ON DELETE CASCADE,
    device_id       UUID NOT NULL REFERENCES app.push_devices (id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'pending' CONSTRAINT notification_deliveries_status_check
                        CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
    apns_id         TEXT CONSTRAINT notification_deliveries_apns_id_check CHECK (length(apns_id) <= 64),
    -- APNs' reason (BadDeviceToken, ...) or why it was skipped. Never content.
    reason          TEXT CONSTRAINT notification_deliveries_reason_check CHECK (length(reason) <= 100),
    attempts        SMALLINT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT notification_deliveries_notification_device_key UNIQUE (notification_id, device_id)
);

CREATE INDEX notification_deliveries_device_idx ON app.notification_deliveries (device_id);
CREATE INDEX notification_deliveries_updated_idx ON app.notification_deliveries (updated_at);

-- An urgent offer's end: APNs drops the push if it can't deliver it by then.
ALTER TABLE app.notifications ADD COLUMN expires_at TIMESTAMPTZ;

-- 0018 drops and re-adds this named constraint with the urgent kinds.
ALTER TABLE app.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE app.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
    'assignment', 'reply', 'request_update', 'task_due', 'referral_update', 'test'));

-- A resident sees their own `test` rows too (they can send one from Me).
CREATE OR REPLACE VIEW app.notification_view AS
SELECT n.id, n.user_id, n.kind, n.case_id, c.number AS case_number, c.title AS case_title,
       c.status AS case_status, n.task_id, t.title AS task_title, n.created_at, n.read_at,
       s.staff AS reader_is_staff,
       CASE WHEN s.staff OR u.visibility = 'public' THEN u.update_type END AS update_type,
       CASE WHEN s.staff OR u.visibility = 'public' THEN u.content END AS update_content,
       CASE WHEN s.staff THEN a.display_name END AS actor_name,
       CASE WHEN s.staff THEN c.contact_name END AS contact_name,
       CASE WHEN s.staff THEN f.status END AS referral_status,
       CASE WHEN s.staff THEN res.name END AS resource_name
FROM app.notifications n
JOIN app.users reader ON reader.id = n.user_id
CROSS JOIN LATERAL (SELECT reader.role IN ('worker', 'admin') AS staff) s
LEFT JOIN app.cases c ON c.id = n.case_id
LEFT JOIN app.case_updates u ON u.id = n.case_update_id
LEFT JOIN app.tasks t ON t.id = n.task_id
LEFT JOIN app.case_referrals f ON f.id = n.referral_id
LEFT JOIN app.resources res ON res.id = f.resource_id
LEFT JOIN app.users a ON a.id = n.actor_id
WHERE s.staff OR n.kind IN ('request_update', 'test');

-- =============================================================================
-- FUNCTIONS
-- =============================================================================

-- 0016's, with p_expires_at. The API queues the push job when a row comes back.
DROP FUNCTION app.notification_create;
CREATE FUNCTION app.notification_create(
    p_user_id UUID, p_kind TEXT, p_dedupe_key TEXT, p_case_id UUID DEFAULT NULL,
    p_case_update_id UUID DEFAULT NULL, p_task_id UUID DEFAULT NULL, p_referral_id UUID DEFAULT NULL,
    p_actor_id UUID DEFAULT NULL, p_expires_at TIMESTAMPTZ DEFAULT NULL)
RETURNS SETOF app.notifications
LANGUAGE sql AS $$
    INSERT INTO app.notifications AS n
        (user_id, kind, dedupe_key, case_id, case_update_id, task_id, referral_id, actor_id, expires_at)
    SELECT p_user_id, p_kind, p_dedupe_key, p_case_id, p_case_update_id, p_task_id, p_referral_id, p_actor_id,
           p_expires_at
    WHERE p_user_id IS DISTINCT FROM p_actor_id
    ON CONFLICT ON CONSTRAINT notifications_user_dedupe_key DO NOTHING
    RETURNING n.*
$$;

-- Register (or refresh) a device for p_user_id, by token: a token another
-- user had moves to this one. Re-registering keeps a device APNs disabled
-- disabled unless its environment changed; one only disabled for the cap
-- ('replaced') is in use again. At most 10 active devices per user: the
-- least recently seen beyond that are disabled ('replaced').
CREATE FUNCTION app.push_device_register(
    p_user_id UUID, p_token TEXT, p_platform TEXT, p_environment TEXT, p_app_version TEXT)
RETURNS SETOF app.push_devices
LANGUAGE plpgsql AS $$
DECLARE
    v_device app.push_devices;
BEGIN
    -- One registration per user at a time, so the cap holds.
    PERFORM 1 FROM app.users u WHERE u.id = p_user_id FOR NO KEY UPDATE;
    INSERT INTO app.push_devices AS d (token, user_id, platform, environment, app_version)
    VALUES (lower(p_token), p_user_id, p_platform, p_environment, p_app_version)
    ON CONFLICT ON CONSTRAINT push_devices_token_key DO UPDATE
    SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, environment = EXCLUDED.environment,
        app_version = EXCLUDED.app_version, last_seen_at = now(),
        -- Registering again re-enables a token APNs had rejected: Apple's
        -- rule is to stop sending until the app registers it again, and
        -- iOS often hands back the same token after a reinstall.
        disabled_at = NULL,
        disabled_reason = NULL
    RETURNING d.* INTO v_device;

    UPDATE app.push_devices AS d SET disabled_at = now(), disabled_reason = 'replaced'
    WHERE d.id IN (
        SELECT x.id FROM app.push_devices x
        WHERE x.user_id = p_user_id AND x.disabled_at IS NULL
        ORDER BY x.last_seen_at DESC, x.created_at DESC
        OFFSET 10
    );

    RETURN QUERY SELECT d.* FROM app.push_devices d WHERE d.id = v_device.id;
END
$$;

-- Sign-out: forget the device. No row: it wasn't this user's.
CREATE FUNCTION app.push_device_remove(p_user_id UUID, p_token TEXT)
RETURNS SETOF app.push_devices
LANGUAGE sql AS $$
    DELETE FROM app.push_devices d WHERE d.token = lower(p_token) AND d.user_id = p_user_id RETURNING d.*
$$;

-- APNs says the token is dead. No row: already disabled, or gone.
CREATE FUNCTION app.push_device_disable(p_device_id UUID, p_reason TEXT)
RETURNS SETOF app.push_devices
LANGUAGE sql AS $$
    UPDATE app.push_devices d SET disabled_at = now(), disabled_reason = left(p_reason, 100)
    WHERE d.id = p_device_id AND d.disabled_at IS NULL
    RETURNING d.*
$$;

CREATE FUNCTION app.push_device_list_active(p_user_id UUID)
RETURNS SETOF app.push_devices
LANGUAGE sql STABLE AS $$
    SELECT d.* FROM app.push_devices d
    WHERE d.user_id = p_user_id AND d.disabled_at IS NULL
    ORDER BY d.last_seen_at DESC
$$;

-- Delete devices not seen for p_days (the worker's upkeep: 60).
CREATE FUNCTION app.push_device_prune(p_days INT)
RETURNS TABLE (deleted BIGINT)
LANGUAGE sql AS $$
    WITH gone AS (
        DELETE FROM app.push_devices d
        WHERE d.last_seen_at < now() - make_interval(days => p_days)
        RETURNING 1
    )
    SELECT count(*) FROM gone
$$;

-- Everything the push job decides on, for one notification. No row: gone.
-- The counts leave this notification's own deliveries out, so a retry after
-- a partial send isn't coalesced or capped by itself. recent_push_count is
-- non-urgent notifications pushed to this user in the last hour;
-- last_case_push_at the last push to them about the same case.
CREATE FUNCTION app.notification_push_facts(p_notification_id UUID)
RETURNS TABLE (
    id UUID, user_id UUID, kind TEXT, case_id UUID, created_at TIMESTAMPTZ, read_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ, push_enabled BOOLEAN, muted_kinds TEXT[], quiet_start TIME, quiet_end TIME,
    timezone TEXT, reader_is_staff BOOLEAN, unread_count BIGINT, recent_push_count BIGINT,
    last_case_push_at TIMESTAMPTZ)
LANGUAGE sql STABLE AS $$
    SELECT n.id, n.user_id, n.kind, n.case_id, n.created_at, n.read_at, n.expires_at,
           COALESCE(p.push_enabled, true), COALESCE(p.muted_kinds, '{}'::text[]), p.quiet_start, p.quiet_end,
           u.timezone, u.role IN ('worker', 'admin'),
           (SELECT count(*) FROM app.notification_view v WHERE v.user_id = n.user_id AND v.read_at IS NULL),
           (SELECT count(DISTINCT o.id) FROM app.notifications o
            JOIN app.notification_deliveries d ON d.notification_id = o.id
            WHERE o.user_id = n.user_id AND o.id <> n.id
              AND o.kind NOT IN ('urgent_offer', 'urgent_unanswered', 'test')
              AND d.status IN ('sending', 'sent') AND d.updated_at > now() - interval '1 hour'),
           (SELECT max(d.updated_at) FROM app.notifications o
            JOIN app.notification_deliveries d ON d.notification_id = o.id
            WHERE o.user_id = n.user_id AND o.id <> n.id AND n.case_id IS NOT NULL AND o.case_id = n.case_id
              AND d.status IN ('sending', 'sent'))
    FROM app.notifications n
    JOIN app.users u ON u.id = n.user_id
    LEFT JOIN app.notification_preferences p ON p.user_id = n.user_id
    WHERE n.id = p_notification_id
$$;

-- Claim this notification's deliveries: one row per active device of its
-- user (made when missing), pending -> sending, committed by the caller
-- before it calls APNs. Rows still in `sending` (a crash between the send
-- and its record) come back too, with was_sending: they are resent once,
-- under the same collapse id, so the phone shows one notification.
-- With p_skip_reason, nothing is claimed: missing rows are made `skipped`
-- with that reason, and pending ones become skipped.
CREATE FUNCTION app.notification_delivery_claim(p_notification_id UUID, p_skip_reason TEXT DEFAULT NULL)
RETURNS TABLE (
    delivery_id UUID, device_id UUID, token TEXT, platform TEXT, environment TEXT, attempts SMALLINT,
    was_sending BOOLEAN)
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO app.notification_deliveries AS x (notification_id, device_id, status, reason)
    SELECT n.id, d.id, CASE WHEN p_skip_reason IS NULL THEN 'pending' ELSE 'skipped' END, left(p_skip_reason, 100)
    FROM app.notifications n
    JOIN app.push_devices d ON d.user_id = n.user_id AND d.disabled_at IS NULL
    WHERE n.id = p_notification_id
    ON CONFLICT ON CONSTRAINT notification_deliveries_notification_device_key DO NOTHING;

    IF p_skip_reason IS NOT NULL THEN
        UPDATE app.notification_deliveries x SET status = 'skipped', reason = left(p_skip_reason, 100),
               updated_at = now()
        -- 'sending' too: rows a crashed attempt left behind must not stay
        -- 'sending' (they would count toward coalescing and the cap).
        WHERE x.notification_id = p_notification_id AND x.status IN ('pending', 'sending');
        RETURN;
    END IF;

    RETURN QUERY
    WITH todo AS (
        SELECT x.id, x.status AS was
        FROM app.notification_deliveries x
        JOIN app.notifications n ON n.id = x.notification_id
        -- Only devices still active and still this user's: a phone that
        -- moved to someone else never gets the old account's push.
        JOIN app.push_devices d ON d.id = x.device_id AND d.user_id = n.user_id AND d.disabled_at IS NULL
        WHERE x.notification_id = p_notification_id AND x.status IN ('pending', 'sending')
        FOR UPDATE OF x
    ), claimed AS (
        UPDATE app.notification_deliveries x
        SET status = 'sending', attempts = x.attempts + 1, updated_at = now()
        FROM todo
        WHERE x.id = todo.id
        RETURNING x.id, x.device_id, x.attempts, todo.was
    )
    SELECT c.id, d.id, d.token, d.platform, d.environment, c.attempts, c.was = 'sending'
    FROM claimed c JOIN app.push_devices d ON d.id = c.device_id
    ORDER BY d.last_seen_at DESC;
END
$$;

-- APNs' answer for one claimed delivery: 'sent' (with its apns-id),
-- 'failed', or 'pending' again (to retry). No row: it wasn't sending.
CREATE FUNCTION app.notification_delivery_record(
    p_delivery_id UUID, p_status TEXT, p_apns_id TEXT DEFAULT NULL, p_reason TEXT DEFAULT NULL)
RETURNS SETOF app.notification_deliveries
LANGUAGE sql AS $$
    UPDATE app.notification_deliveries x
    SET status = p_status, apns_id = left(p_apns_id, 64), reason = left(p_reason, 100), updated_at = now()
    WHERE x.id = p_delivery_id AND x.status = 'sending'
    RETURNING x.*
$$;

-- A push job that ran out of attempts: its unfinished rows are failed.
CREATE FUNCTION app.notification_delivery_give_up(p_notification_id UUID)
RETURNS TABLE (updated BIGINT)
LANGUAGE sql AS $$
    WITH failed AS (
        UPDATE app.notification_deliveries x
        SET status = 'failed', reason = COALESCE(x.reason, 'gave_up'), updated_at = now()
        WHERE x.notification_id = p_notification_id AND x.status IN ('pending', 'sending')
        RETURNING 1
    )
    SELECT count(*) FROM failed
$$;

-- Delete deliveries older than p_days (the worker's upkeep: 30).
CREATE FUNCTION app.notification_delivery_prune(p_days INT)
RETURNS TABLE (deleted BIGINT)
LANGUAGE sql AS $$
    WITH gone AS (
        DELETE FROM app.notification_deliveries x
        WHERE x.updated_at < now() - make_interval(days => p_days)
        RETURNING 1
    )
    SELECT count(*) FROM gone
$$;

-- For admins: deliveries since p_since by status, devices, and the most
-- common APNs reasons (failed rows) since then.
CREATE FUNCTION app.notification_stats(p_since TIMESTAMPTZ)
RETURNS TABLE (deliveries JSONB, active_devices BIGINT, disabled_devices BIGINT, top_reasons JSONB)
LANGUAGE sql STABLE AS $$
    SELECT
        (SELECT COALESCE(jsonb_object_agg(s.status, s.n), '{}'::jsonb)
         FROM (SELECT x.status, count(*) AS n FROM app.notification_deliveries x
               WHERE x.updated_at >= p_since GROUP BY x.status) s),
        (SELECT count(*) FROM app.push_devices d WHERE d.disabled_at IS NULL),
        (SELECT count(*) FROM app.push_devices d WHERE d.disabled_at IS NOT NULL),
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('reason', r.reason, 'count', r.n) ORDER BY r.n DESC, r.reason),
                         '[]'::jsonb)
         FROM (SELECT x.reason, count(*) AS n FROM app.notification_deliveries x
               WHERE x.updated_at >= p_since AND x.status = 'failed' AND x.reason IS NOT NULL
               GROUP BY x.reason ORDER BY count(*) DESC, x.reason LIMIT 5) r)
$$;
