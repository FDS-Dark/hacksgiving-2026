-- =============================================================================
-- The in-app inbox (see 0016_notifications.py, and D2/D6 of
-- docs/design/on-call-and-push.md).
--
-- A notification is a reference, not a copy: who it is for, what kind of
-- event, and the case, history entry, task or referral it is about. No
-- message text is stored here. notification_view joins the current data
-- when the row is read, limited to what its reader may see: a resident
-- (role member) never gets internal notes, staff names or contact details,
-- and only sees request_update rows. So an edit or a deletion shows up
-- everywhere, and nothing sensitive gets a second copy with its own
-- retention.
--
-- Rows are created by the API's services (NotificationService.notify), in the
-- same transaction as the change, never by triggers: only the service knows
-- who acted, and the person who acted is never notified.
--
-- Same conventions as 0005 and 0011: app.<domain>_<verb>, p_ parameters, no
-- row means not found, SECURITY INVOKER (revision 0002's default privileges
-- give the app role EXECUTE on these functions and DML on these tables).
-- =============================================================================

CREATE TABLE app.notifications (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
    -- Phase 3 adds urgent_offer and urgent_unanswered: a later revision drops
    -- and re-adds this named constraint.
    kind           TEXT NOT NULL CONSTRAINT notifications_kind_check CHECK (kind IN (
                       'assignment', 'reply', 'request_update', 'task_due', 'referral_update')),
    case_id        UUID REFERENCES app.cases (id) ON DELETE CASCADE,
    case_update_id UUID REFERENCES app.case_updates (id) ON DELETE CASCADE,
    task_id        UUID REFERENCES app.tasks (id) ON DELETE CASCADE,
    -- referral_update rows: which referral (its resource and current status).
    referral_id    UUID REFERENCES app.case_referrals (id) ON DELETE CASCADE,
    actor_id       UUID REFERENCES app.users (id) ON DELETE SET NULL,
    -- One row per person per event: the same event twice is one row.
    dedupe_key     TEXT NOT NULL CONSTRAINT notifications_dedupe_key_check CHECK (length(dedupe_key) <= 200),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at        TIMESTAMPTZ,
    CONSTRAINT notifications_user_dedupe_key UNIQUE (user_id, dedupe_key)
);

CREATE INDEX notifications_user_created_idx ON app.notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON app.notifications (user_id) WHERE read_at IS NULL;
CREATE INDEX notifications_case_idx ON app.notifications (case_id);
CREATE INDEX notifications_created_idx ON app.notifications (created_at);

-- Push settings (phase 2 uses them). The inbox itself ignores mutes: it
-- always gets the row. No row means the defaults.
CREATE TABLE app.notification_preferences (
    user_id              UUID PRIMARY KEY REFERENCES app.users (id) ON DELETE CASCADE,
    push_enabled         BOOLEAN NOT NULL DEFAULT true,
    muted_kinds          TEXT[] NOT NULL DEFAULT '{}',
    quiet_start          TIME,
    quiet_end            TIME,
    urgent_when_off_call BOOLEAN NOT NULL DEFAULT false,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Each notification with the facts its reader may see. The reader is the
-- row's user_id; reader_is_staff decides what is filled in. Residents only
-- see request_update rows, and of those only public history entries.
CREATE VIEW app.notification_view AS
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
WHERE s.staff OR n.kind = 'request_update';

-- =============================================================================
-- FUNCTIONS
-- =============================================================================

-- The history entries the current transaction wrote on a case, by one
-- author, oldest first. case_update and referral_update write their own
-- history; this is how the caller learns those entries' ids (a
-- notification's dedupe key) without changing what they return.
-- case_updates.created_at is clock_timestamp(), so this transaction's
-- entries are the ones at or after its start (now()).
CREATE FUNCTION app.case_list_updates_this_transaction(p_case_id UUID, p_author_id UUID)
RETURNS SETOF app.case_update_view
LANGUAGE sql STABLE AS $$
    SELECT v.* FROM app.case_update_view v
    WHERE v.case_id = p_case_id AND v.author_id IS NOT DISTINCT FROM p_author_id AND v.created_at >= now()
    ORDER BY v.created_at, v.id
$$;

-- One notification. No row when it already exists (same user and dedupe
-- key), or when the person would be notified about their own action.
CREATE FUNCTION app.notification_create(
    p_user_id UUID, p_kind TEXT, p_dedupe_key TEXT, p_case_id UUID DEFAULT NULL,
    p_case_update_id UUID DEFAULT NULL, p_task_id UUID DEFAULT NULL, p_referral_id UUID DEFAULT NULL,
    p_actor_id UUID DEFAULT NULL)
RETURNS SETOF app.notifications
LANGUAGE sql AS $$
    INSERT INTO app.notifications AS n
        (user_id, kind, dedupe_key, case_id, case_update_id, task_id, referral_id, actor_id)
    SELECT p_user_id, p_kind, p_dedupe_key, p_case_id, p_case_update_id, p_task_id, p_referral_id, p_actor_id
    WHERE p_user_id IS DISTINCT FROM p_actor_id
    ON CONFLICT ON CONSTRAINT notifications_user_dedupe_key DO NOTHING
    RETURNING n.*
$$;

-- A person's notifications, newest first; p_before pages back by created_at.
CREATE FUNCTION app.notification_list(p_user_id UUID, p_before TIMESTAMPTZ, p_limit INT)
RETURNS SETOF app.notification_view
LANGUAGE sql STABLE AS $$
    SELECT v.* FROM app.notification_view v
    WHERE v.user_id = p_user_id AND (p_before IS NULL OR v.created_at < p_before)
    ORDER BY v.created_at DESC, v.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
$$;

-- One of the person's notifications, marked read. No row: not theirs, or
-- not one they may see.
CREATE FUNCTION app.notification_get(p_user_id UUID, p_notification_id UUID)
RETURNS SETOF app.notification_view
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE app.notifications AS n SET read_at = COALESCE(n.read_at, now())
    WHERE n.id = p_notification_id
      AND n.id IN (SELECT v.id FROM app.notification_view v WHERE v.user_id = p_user_id);
    RETURN QUERY SELECT v.* FROM app.notification_view v WHERE v.id = p_notification_id AND v.user_id = p_user_id;
END
$$;

CREATE FUNCTION app.notification_unread_count(p_user_id UUID)
RETURNS TABLE (count BIGINT)
LANGUAGE sql STABLE AS $$
    SELECT count(*) FROM app.notification_view v WHERE v.user_id = p_user_id AND v.read_at IS NULL
$$;

-- Mark one read. No row: not theirs (or not one they may see).
CREATE FUNCTION app.notification_read(p_user_id UUID, p_notification_id UUID)
RETURNS SETOF app.notifications
LANGUAGE sql AS $$
    UPDATE app.notifications AS n SET read_at = COALESCE(n.read_at, now())
    WHERE n.id = p_notification_id
      AND n.id IN (SELECT v.id FROM app.notification_view v WHERE v.user_id = p_user_id)
    RETURNING n.*
$$;

-- Mark all the person's unread rows read, or only one case's (p_case_id).
CREATE FUNCTION app.notification_read_all(p_user_id UUID, p_case_id UUID)
RETURNS TABLE (updated BIGINT)
LANGUAGE sql AS $$
    WITH marked AS (
        UPDATE app.notifications AS n SET read_at = now()
        WHERE n.user_id = p_user_id AND n.read_at IS NULL
          AND (p_case_id IS NULL OR n.case_id = p_case_id)
        RETURNING 1
    )
    SELECT count(*) FROM marked
$$;

-- The person's preferences, or the defaults when they never saved any.
CREATE FUNCTION app.notification_preferences_get(p_user_id UUID)
RETURNS SETOF app.notification_preferences
LANGUAGE sql STABLE AS $$
    SELECT p.* FROM app.notification_preferences p WHERE p.user_id = p_user_id
    UNION ALL
    SELECT p_user_id, true, '{}'::text[], NULL::time, NULL::time, false, now()
    WHERE NOT EXISTS (SELECT 1 FROM app.notification_preferences p WHERE p.user_id = p_user_id)
$$;

-- Replace the person's preferences (the service merges a PATCH first).
CREATE FUNCTION app.notification_preferences_save(
    p_user_id UUID, p_push_enabled BOOLEAN, p_muted_kinds TEXT[], p_quiet_start TIME, p_quiet_end TIME,
    p_urgent_when_off_call BOOLEAN)
RETURNS SETOF app.notification_preferences
LANGUAGE sql AS $$
    INSERT INTO app.notification_preferences AS p
        (user_id, push_enabled, muted_kinds, quiet_start, quiet_end, urgent_when_off_call, updated_at)
    VALUES (p_user_id, p_push_enabled, COALESCE(p_muted_kinds, '{}'), p_quiet_start, p_quiet_end,
            p_urgent_when_off_call, now())
    ON CONFLICT (user_id) DO UPDATE
    SET push_enabled = EXCLUDED.push_enabled, muted_kinds = EXCLUDED.muted_kinds,
        quiet_start = EXCLUDED.quiet_start, quiet_end = EXCLUDED.quiet_end,
        urgent_when_off_call = EXCLUDED.urgent_when_off_call, updated_at = now()
    RETURNING p.*
$$;

-- Delete notifications older than p_days (the worker's upkeep: 90).
CREATE FUNCTION app.notification_prune(p_days INT)
RETURNS TABLE (deleted BIGINT)
LANGUAGE sql AS $$
    WITH gone AS (
        DELETE FROM app.notifications n
        WHERE n.created_at < now() - make_interval(days => p_days)
        RETURNING 1
    )
    SELECT count(*) FROM gone
$$;
