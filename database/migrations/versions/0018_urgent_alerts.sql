-- =============================================================================
-- Urgent escalation (see 0018_urgent_alerts.py, D3 of
-- docs/design/on-call-and-push.md and phase 3 of
-- docs/design/push-escalation-contract.md).
--
-- An open, unassigned case of priority high or critical gets one open alert
-- (status offering or unanswered). It is offered down a ladder of steps:
--   1  everyone on a rank-1 shift now
--   2  everyone on a rank-2 shift now; if nobody is, whoever's shift starts
--      next within 12 hours (oncall_now's 'next' slot)
--   3  every admin, and workers who switched on urgent_when_off_call
-- leaving out people already offered on the alert. A step with nobody new
-- is skipped. Each offer is a row in oncall_offers. When the last step runs
-- out the alert is `unanswered` until someone accepts. Any staff member may
-- accept an open alert; the first one wins (one guarded UPDATE).
--
-- The API's jobs (services/oncall_jobs.py) call these functions; every one
-- that changes an alert checks its status and step again under the lock,
-- so a late or duplicate job does nothing.
--
-- Lock order, everywhere: the case row first, then the alert, then its
-- offers (oncall_alert_lock). case_update locks the case FOR UPDATE and
-- CaseService then closes the alert in the same transaction, so taking the
-- alert first and touching the case later (a history entry, a notification
-- that references it) could deadlock. No function here locks app.users or
-- app.oncall_shifts (0015's order, users then shifts, is untouched): the
-- ladder only reads shifts.
--
-- Also: notifications.alert_id and the urgent_offer / urgent_unanswered
-- kinds, and the history type 'alert' (internal entries: accepted, on scene).
--
-- Same conventions as 0015 and 0016: app.<domain>_<verb>, p_ parameters, no
-- row means not found, outcomes as a column rather than exceptions,
-- SECURITY INVOKER (0002's default privileges cover the new objects).
-- =============================================================================

CREATE TABLE app.oncall_alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id         UUID NOT NULL REFERENCES app.cases (id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'offering' CONSTRAINT oncall_alerts_status_check CHECK (status IN (
                        'offering', 'unanswered', 'accepted', 'resolved', 'cancelled')),
    step            SMALLINT NOT NULL DEFAULT 1 CONSTRAINT oncall_alerts_step_check CHECK (step BETWEEN 1 AND 3),
    -- When the current step's offers run out; NULL while its offers aren't
    -- made yet, and once the alert isn't offering.
    step_expires_at TIMESTAMPTZ,
    accepted_by     UUID REFERENCES app.users (id) ON DELETE SET NULL,
    accepted_at     TIMESTAMPTZ,
    arrived_at      TIMESTAMPTZ,
    reminders_sent  SMALLINT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Resolved (assigned by hand) or cancelled (closed, or no longer urgent).
    closed_at       TIMESTAMPTZ
);

-- At most one open alert per case.
CREATE UNIQUE INDEX oncall_alerts_open_case_key ON app.oncall_alerts (case_id)
    WHERE status IN ('offering', 'unanswered');
CREATE INDEX oncall_alerts_case_idx ON app.oncall_alerts (case_id);
CREATE INDEX oncall_alerts_created_idx ON app.oncall_alerts (created_at DESC);

CREATE TABLE app.oncall_offers (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id     UUID NOT NULL REFERENCES app.oncall_alerts (id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
    step         SMALLINT NOT NULL CONSTRAINT oncall_offers_step_check CHECK (step BETWEEN 1 AND 3),
    offered_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    outcome      TEXT NOT NULL DEFAULT 'pending' CONSTRAINT oncall_offers_outcome_check CHECK (outcome IN (
                     'pending', 'accepted', 'passed', 'timed_out', 'superseded')),
    pass_reason  TEXT CONSTRAINT oncall_offers_pass_reason_check CHECK (pass_reason IN (
                     'busy', 'too_far', 'not_safe_alone')),
    responded_at TIMESTAMPTZ,
    CONSTRAINT oncall_offers_alert_user_step_key UNIQUE (alert_id, user_id, step)
);

CREATE INDEX oncall_offers_user_idx ON app.oncall_offers (user_id);

-- urgent_* notifications point at their alert.
ALTER TABLE app.notifications
    ADD COLUMN alert_id UUID REFERENCES app.oncall_alerts (id) ON DELETE CASCADE;
CREATE INDEX notifications_alert_idx ON app.notifications (alert_id) WHERE alert_id IS NOT NULL;

-- The final kind list (0017's plus the urgent kinds).
ALTER TABLE app.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE app.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
    'assignment', 'reply', 'request_update', 'task_due', 'referral_update', 'test',
    'urgent_offer', 'urgent_unanswered'));

-- Internal history entries about an alert (accepted, on scene).
ALTER TABLE app.case_updates DROP CONSTRAINT case_updates_type_check;
ALTER TABLE app.case_updates ADD CONSTRAINT case_updates_type_check CHECK (update_type IN (
    'created', 'note', 'message', 'status_change', 'priority_change',
    'category_change', 'assignment', 'referral', 'reply', 'alert'));

-- 0017's view with alert_id at the end (columns may only be added there).
-- Residents never see urgent rows: the WHERE is unchanged.
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
WHERE s.staff OR n.kind IN ('request_update', 'test');

-- An alert with the case facts a responder needs. Never the requester's
-- contact details.
CREATE VIEW app.oncall_alert_view AS
SELECT a.id, a.case_id, c.number AS case_number, c.title AS case_title, c.category, c.priority,
       a.status, a.step, a.step_expires_at, a.created_at, a.accepted_by, w.display_name AS accepted_by_name,
       a.accepted_at, a.arrived_at, a.reminders_sent,
       c.description, c.location, c.latitude, c.longitude, c.contact_method, c.safe_to_contact
FROM app.oncall_alerts a
JOIN app.cases c ON c.id = a.case_id
LEFT JOIN app.users w ON w.id = a.accepted_by;

-- =============================================================================
-- FUNCTIONS
-- =============================================================================

-- 0017's, with p_alert_id.
DROP FUNCTION app.notification_create;
CREATE FUNCTION app.notification_create(
    p_user_id UUID, p_kind TEXT, p_dedupe_key TEXT, p_case_id UUID DEFAULT NULL,
    p_case_update_id UUID DEFAULT NULL, p_task_id UUID DEFAULT NULL, p_referral_id UUID DEFAULT NULL,
    p_actor_id UUID DEFAULT NULL, p_expires_at TIMESTAMPTZ DEFAULT NULL, p_alert_id UUID DEFAULT NULL)
RETURNS SETOF app.notifications
LANGUAGE sql AS $$
    INSERT INTO app.notifications AS n
        (user_id, kind, dedupe_key, case_id, case_update_id, task_id, referral_id, actor_id, expires_at, alert_id)
    SELECT p_user_id, p_kind, p_dedupe_key, p_case_id, p_case_update_id, p_task_id, p_referral_id, p_actor_id,
           p_expires_at, p_alert_id
    WHERE p_user_id IS DISTINCT FROM p_actor_id
    ON CONFLICT ON CONSTRAINT notifications_user_dedupe_key DO NOTHING
    RETURNING n.*
$$;

-- Who step p_step offers to now, by name, leaving out anyone already
-- offered on p_alert_id (NULL: nobody is left out). Staff only.
CREATE FUNCTION app.oncall_ladder(p_step SMALLINT, p_alert_id UUID)
RETURNS TABLE (user_id UUID, display_name TEXT)
LANGUAGE sql STABLE AS $$
    WITH roster AS (SELECT * FROM app.oncall_now()),
    candidates AS (
        SELECT r.user_id FROM roster r WHERE p_step = 1 AND r.slot = 'current' AND r.rank = 1
        UNION
        SELECT r.user_id FROM roster r WHERE p_step = 2 AND r.slot = 'current' AND r.rank = 2
        UNION
        SELECT r.user_id FROM roster r
        WHERE p_step = 2 AND r.slot = 'next'
          AND NOT EXISTS (SELECT 1 FROM roster x WHERE x.slot = 'current' AND x.rank = 2)
        UNION
        SELECT u.id FROM app.users u
        LEFT JOIN app.notification_preferences p ON p.user_id = u.id
        WHERE p_step = 3 AND (u.role = 'admin' OR (u.role = 'worker' AND COALESCE(p.urgent_when_off_call, false)))
    )
    SELECT u.id, u.display_name
    FROM candidates c
    JOIN app.users u ON u.id = c.user_id AND u.role IN ('worker', 'admin')
    WHERE NOT EXISTS (SELECT 1 FROM app.oncall_offers o WHERE o.alert_id = p_alert_id AND o.user_id = u.id)
    ORDER BY u.display_name NULLS LAST, u.id
$$;

-- The alert, locked in this module's order: its case first, then the alert.
-- No row: no such alert.
CREATE FUNCTION app.oncall_alert_lock(p_alert_id UUID)
RETURNS SETOF app.oncall_alerts
LANGUAGE plpgsql AS $$
DECLARE
    v_case_id UUID;
BEGIN
    SELECT a.case_id INTO v_case_id FROM app.oncall_alerts a WHERE a.id = p_alert_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    PERFORM 1 FROM app.cases c WHERE c.id = v_case_id FOR NO KEY UPDATE;
    RETURN QUERY SELECT a.* FROM app.oncall_alerts a WHERE a.id = p_alert_id FOR UPDATE;
END;
$$;

-- Open an alert for a case that pages on call (the same rule as
-- models/case_enums.py pages_on_call), at step 1 with no offers yet. Called
-- in the case write's transaction, which holds the case. No row: the case
-- doesn't page, or already has an open alert.
CREATE FUNCTION app.oncall_alert_open(p_case_id UUID)
RETURNS SETOF app.oncall_alerts
LANGUAGE sql AS $$
    INSERT INTO app.oncall_alerts AS a (case_id)
    SELECT c.id FROM app.cases c
    WHERE c.id = p_case_id
      AND c.status IN ('new', 'in_progress', 'awaiting_resources')
      AND c.assigned_worker_id IS NULL
      AND c.priority IN ('high', 'critical')
    ON CONFLICT (case_id) WHERE status IN ('offering', 'unanswered') DO NOTHING
    RETURNING a.*
$$;

-- The upkeep's safety net: alerts for cases from the last hour that page
-- but have no open alert (a code path missed them). Cases being written
-- right now are skipped; the next round sees them. An hour, not a day: the
-- first deploy must not page on-call staff for yesterday's cases at once.
CREATE FUNCTION app.oncall_alert_sweep()
RETURNS SETOF app.oncall_alerts
LANGUAGE sql AS $$
    WITH due AS (
        SELECT c.id FROM app.cases c
        WHERE c.created_at >= now() - interval '1 hour'
          AND c.status IN ('new', 'in_progress', 'awaiting_resources')
          AND c.assigned_worker_id IS NULL
          AND c.priority IN ('high', 'critical')
          AND NOT EXISTS (
              SELECT 1 FROM app.oncall_alerts a
              WHERE a.case_id = c.id AND a.status IN ('offering', 'unanswered'))
        ORDER BY c.created_at
        FOR NO KEY UPDATE OF c SKIP LOCKED
    )
    INSERT INTO app.oncall_alerts AS a (case_id)
    SELECT due.id FROM due
    ON CONFLICT (case_id) WHERE status IN ('offering', 'unanswered') DO NOTHING
    RETURNING a.*
$$;

-- Make the offers of step p_step (the oncall.offer job). Each offer lasts
-- p_offer_seconds. A step with nobody new is skipped to the next; with
-- nobody left at all the alert becomes 'unanswered'. Rows:
--   'offered'     one per pending offer of the step the alert is now at
--                 (the same offers again if this step's were already made)
--   'unanswered'  one row, no offer
--   'noop'        one row: no such alert, or it isn't offering at p_step
--                 (accepted, passed on, closed). A case that stopped paging
--                 without its alert closing closes it here.
CREATE FUNCTION app.oncall_offer_step(p_alert_id UUID, p_step SMALLINT, p_offer_seconds INT)
RETURNS TABLE (
    outcome TEXT, case_id UUID, step SMALLINT, step_expires_at TIMESTAMPTZ,
    offer_id UUID, user_id UUID, expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
DECLARE
    v app.oncall_alerts;
    v_case app.cases;
    v_step SMALLINT := p_step;
    v_expires TIMESTAMPTZ;
    v_count INT := 0;
BEGIN
    SELECT * INTO v FROM app.oncall_alert_lock(p_alert_id);
    IF v.id IS NULL OR v.status <> 'offering' OR v.step <> p_step THEN
        RETURN QUERY SELECT 'noop'::TEXT, NULL::UUID, NULL::SMALLINT, NULL::TIMESTAMPTZ, NULL::UUID, NULL::UUID,
            NULL::TIMESTAMPTZ;
        RETURN;
    END IF;

    SELECT * INTO v_case FROM app.cases c WHERE c.id = v.case_id;
    IF NOT (v_case.status IN ('new', 'in_progress', 'awaiting_resources')
            AND v_case.assigned_worker_id IS NULL AND v_case.priority IN ('high', 'critical')) THEN
        PERFORM app.oncall_resolve_for_case(
            v.case_id,
            CASE WHEN v_case.assigned_worker_id IS NOT NULL
                      AND v_case.status IN ('new', 'in_progress', 'awaiting_resources')
                 THEN 'resolved' ELSE 'cancelled' END);
        RETURN QUERY SELECT 'noop'::TEXT, NULL::UUID, NULL::SMALLINT, NULL::TIMESTAMPTZ, NULL::UUID, NULL::UUID,
            NULL::TIMESTAMPTZ;
        RETURN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM app.oncall_offers o WHERE o.alert_id = p_alert_id AND o.step = p_step) THEN
        LOOP
            v_expires := now() + make_interval(secs => p_offer_seconds);
            INSERT INTO app.oncall_offers (alert_id, user_id, step, expires_at)
            SELECT p_alert_id, l.user_id, v_step, v_expires FROM app.oncall_ladder(v_step, p_alert_id) l
            ON CONFLICT ON CONSTRAINT oncall_offers_alert_user_step_key DO NOTHING;
            GET DIAGNOSTICS v_count = ROW_COUNT;
            EXIT WHEN v_count > 0 OR v_step >= 3;
            v_step := v_step + 1;
        END LOOP;

        IF v_count = 0 THEN
            UPDATE app.oncall_alerts AS a SET status = 'unanswered', step_expires_at = NULL WHERE a.id = p_alert_id;
            RETURN QUERY SELECT 'unanswered'::TEXT, v.case_id, v.step, NULL::TIMESTAMPTZ, NULL::UUID, NULL::UUID,
                NULL::TIMESTAMPTZ;
            RETURN;
        END IF;
        UPDATE app.oncall_alerts AS a SET step = v_step, step_expires_at = v_expires WHERE a.id = p_alert_id;
    END IF;

    RETURN QUERY
        SELECT 'offered'::TEXT, a.case_id, a.step, a.step_expires_at, o.id, o.user_id, o.expires_at
        FROM app.oncall_alerts a
        JOIN app.oncall_offers o ON o.alert_id = a.id AND o.step = a.step AND o.outcome = 'pending'
        WHERE a.id = p_alert_id
        ORDER BY o.offered_at, o.id;
END;
$$;

-- The step's time ran out (the oncall.escalate job): its pending offers time
-- out and the alert moves to the next step ('next', offers not made yet),
-- or after step 3 to 'unanswered'. 'noop' unless it is still offering at
-- p_step.
CREATE FUNCTION app.oncall_escalate(p_alert_id UUID, p_step SMALLINT)
RETURNS TABLE (outcome TEXT, step SMALLINT)
LANGUAGE plpgsql AS $$
DECLARE
    v app.oncall_alerts;
BEGIN
    SELECT * INTO v FROM app.oncall_alert_lock(p_alert_id);
    IF v.id IS NULL OR v.status <> 'offering' OR v.step <> p_step THEN
        RETURN QUERY SELECT 'noop'::TEXT, NULL::SMALLINT;
        RETURN;
    END IF;
    UPDATE app.oncall_offers AS o SET outcome = 'timed_out'
    WHERE o.alert_id = p_alert_id AND o.step = p_step AND o.outcome = 'pending';
    RETURN QUERY SELECT * FROM app.oncall_advance(p_alert_id, p_step);
END;
$$;

-- Move a locked, offering alert past p_step (oncall_escalate, oncall_pass).
CREATE FUNCTION app.oncall_advance(p_alert_id UUID, p_step SMALLINT)
RETURNS TABLE (outcome TEXT, step SMALLINT)
LANGUAGE plpgsql AS $$
BEGIN
    IF p_step < 3 THEN
        UPDATE app.oncall_alerts AS a SET step = p_step + 1, step_expires_at = NULL WHERE a.id = p_alert_id;
        RETURN QUERY SELECT 'next'::TEXT, (p_step + 1)::SMALLINT;
    ELSE
        UPDATE app.oncall_alerts AS a SET status = 'unanswered', step_expires_at = NULL WHERE a.id = p_alert_id;
        RETURN QUERY SELECT 'unanswered'::TEXT, p_step;
    END IF;
END;
$$;

-- Take the case (any staff member, while the alert is offering or
-- unanswered). The first accept wins: one guarded UPDATE. Then the
-- acceptor's pending offer is accepted and every other pending one
-- superseded, the case is assigned to the acceptor and moves new ->
-- in_progress (case_update writes those history entries), and an internal
-- 'alert' entry says how long it took. Outcomes: 'accepted' (with the
-- requester and the status_change entry, for the API to notify),
-- 'already_accepted' (with who), 'closed', 'not_found'.
CREATE FUNCTION app.oncall_accept(p_alert_id UUID, p_user_id UUID)
RETURNS TABLE (
    outcome TEXT, accepted_by_name TEXT, case_id UUID, requester_id UUID, status_update_id UUID
)
LANGUAGE plpgsql AS $$
DECLARE
    v app.oncall_alerts;
    v_case_id UUID;
    v_case app.cases;
    v_seconds INT;
    v_status_update UUID;
BEGIN
    SELECT a.case_id INTO v_case_id FROM app.oncall_alerts a WHERE a.id = p_alert_id;
    IF v_case_id IS NULL THEN
        RETURN QUERY SELECT 'not_found'::TEXT, NULL::TEXT, NULL::UUID, NULL::UUID, NULL::UUID;
        RETURN;
    END IF;
    -- The case first (the lock case_update takes), then the alert.
    SELECT * INTO v_case FROM app.cases c WHERE c.id = v_case_id FOR UPDATE;

    UPDATE app.oncall_alerts AS a
    SET status = 'accepted', accepted_by = p_user_id, accepted_at = now(), step_expires_at = NULL
    WHERE a.id = p_alert_id AND a.status IN ('offering', 'unanswered')
    RETURNING a.* INTO v;
    IF v.id IS NULL THEN
        RETURN QUERY
            SELECT CASE WHEN a.status = 'accepted' THEN 'already_accepted' ELSE 'closed' END,
                   u.display_name, a.case_id, NULL::UUID, NULL::UUID
            FROM app.oncall_alerts a LEFT JOIN app.users u ON u.id = a.accepted_by
            WHERE a.id = p_alert_id;
        RETURN;
    END IF;

    UPDATE app.oncall_offers AS o
    SET outcome = CASE WHEN o.user_id = p_user_id THEN 'accepted' ELSE 'superseded' END, responded_at = now()
    WHERE o.alert_id = p_alert_id AND o.outcome = 'pending';

    PERFORM app.case_update(
        p_case_id => v.case_id, p_actor_id => p_user_id, p_kind => NULL, p_title => NULL,
        p_description => NULL, p_category => NULL, p_priority => NULL,
        p_status => CASE WHEN v_case.status = 'new' THEN 'in_progress' END, p_location => NULL,
        p_assigned_worker_id => p_user_id, p_unassign => false);
    IF v_case.status = 'new' THEN
        SELECT u.id INTO v_status_update FROM app.case_updates u
        WHERE u.case_id = v.case_id AND u.author_id = p_user_id AND u.update_type = 'status_change'
          AND u.created_at >= now()
        ORDER BY u.created_at DESC LIMIT 1;
    END IF;

    -- Never negative, even if the server's clock steps back.
    v_seconds := GREATEST(floor(extract(epoch FROM v.accepted_at - v.created_at)), 0)::INT;
    INSERT INTO app.case_updates (case_id, author_id, update_type, visibility, content)
    VALUES (v.case_id, p_user_id, 'alert', 'internal',
            'Accepted on call after ' || (v_seconds / 60) || ':' || lpad((v_seconds % 60)::TEXT, 2, '0')
            || ', step ' || v.step);

    RETURN QUERY
        SELECT 'accepted'::TEXT, u.display_name, v.case_id, v_case.requester_id, v_status_update
        FROM app.users u WHERE u.id = p_user_id;
END;
$$;

-- Pass on my pending offer in the alert's current step, with an optional
-- reason. When nobody in the step is left to answer, the alert moves on at
-- once ('next' or 'unanswered', as oncall_escalate). Otherwise 'passed'.
-- Also 'not_found', 'closed' (not open) and 'not_offered' (no pending offer
-- of mine in this step).
CREATE FUNCTION app.oncall_pass(p_alert_id UUID, p_user_id UUID, p_reason TEXT)
RETURNS TABLE (outcome TEXT, step SMALLINT)
LANGUAGE plpgsql AS $$
DECLARE
    v app.oncall_alerts;
BEGIN
    SELECT * INTO v FROM app.oncall_alert_lock(p_alert_id);
    IF v.id IS NULL THEN
        RETURN QUERY SELECT 'not_found'::TEXT, NULL::SMALLINT;
        RETURN;
    END IF;
    IF v.status NOT IN ('offering', 'unanswered') THEN
        RETURN QUERY SELECT 'closed'::TEXT, v.step;
        RETURN;
    END IF;

    UPDATE app.oncall_offers AS o SET outcome = 'passed', pass_reason = p_reason, responded_at = now()
    WHERE o.alert_id = p_alert_id AND o.user_id = p_user_id AND o.step = v.step AND o.outcome = 'pending';
    IF NOT FOUND THEN
        RETURN QUERY SELECT 'not_offered'::TEXT, v.step;
        RETURN;
    END IF;

    IF v.status = 'offering' AND NOT EXISTS (
        SELECT 1 FROM app.oncall_offers o WHERE o.alert_id = p_alert_id AND o.step = v.step AND o.outcome = 'pending'
    ) THEN
        RETURN QUERY SELECT * FROM app.oncall_advance(p_alert_id, v.step);
        RETURN;
    END IF;
    RETURN QUERY SELECT 'passed'::TEXT, v.step;
END;
$$;

-- "I've arrived", by whoever accepted: sets arrived_at and writes "On
-- scene" to the history, once. 'arrived', 'already', 'not_acceptor',
-- 'not_found'.
CREATE FUNCTION app.oncall_arrived(p_alert_id UUID, p_user_id UUID)
RETURNS TABLE (outcome TEXT)
LANGUAGE plpgsql AS $$
DECLARE
    v app.oncall_alerts;
BEGIN
    SELECT * INTO v FROM app.oncall_alert_lock(p_alert_id);
    IF v.id IS NULL THEN
        RETURN QUERY SELECT 'not_found'::TEXT;
        RETURN;
    END IF;
    IF v.status <> 'accepted' OR v.accepted_by IS DISTINCT FROM p_user_id THEN
        RETURN QUERY SELECT 'not_acceptor'::TEXT;
        RETURN;
    END IF;
    IF v.arrived_at IS NOT NULL THEN
        RETURN QUERY SELECT 'already'::TEXT;
        RETURN;
    END IF;
    UPDATE app.oncall_alerts AS a SET arrived_at = now() WHERE a.id = p_alert_id;
    INSERT INTO app.case_updates (case_id, author_id, update_type, visibility, content)
    VALUES (v.case_id, p_user_id, 'alert', 'internal', 'On scene');
    RETURN QUERY SELECT 'arrived'::TEXT;
END;
$$;

-- Alerts as p_user_id sees them, newest first (at most 100): all of them,
-- or only open ones (offering, unanswered), or just p_alert_id. my_offer_*
-- is p_user_id's latest offer on it; next_names who the next step with
-- anyone in it would offer to (offering alerts only).
CREATE FUNCTION app.oncall_alert_list(p_user_id UUID, p_open_only BOOLEAN, p_alert_id UUID DEFAULT NULL)
RETURNS TABLE (
    id UUID, case_id UUID, case_number BIGINT, case_title TEXT, category TEXT, priority TEXT,
    status TEXT, step SMALLINT, step_expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ,
    accepted_by UUID, accepted_by_name TEXT, accepted_at TIMESTAMPTZ, arrived_at TIMESTAMPTZ,
    reminders_sent SMALLINT, description TEXT, location TEXT, latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION, contact_method TEXT, safe_to_contact BOOLEAN,
    my_offer_id UUID, my_offer_step SMALLINT, my_offer_expires_at TIMESTAMPTZ, my_offer_outcome TEXT,
    next_names TEXT[]
)
LANGUAGE sql STABLE AS $$
    SELECT v.id, v.case_id, v.case_number, v.case_title, v.category, v.priority,
           v.status, v.step, v.step_expires_at, v.created_at,
           v.accepted_by, v.accepted_by_name, v.accepted_at, v.arrived_at,
           v.reminders_sent, v.description, v.location, v.latitude,
           v.longitude, v.contact_method, v.safe_to_contact,
           mine.id, mine.step, mine.expires_at, mine.outcome,
           nxt.names
    FROM app.oncall_alert_view v
    LEFT JOIN LATERAL (
        SELECT o.id, o.step, o.expires_at, o.outcome FROM app.oncall_offers o
        WHERE o.alert_id = v.id AND o.user_id = p_user_id
        ORDER BY o.step DESC, o.offered_at DESC LIMIT 1
    ) mine ON true
    LEFT JOIN LATERAL (
        SELECT array_agg(COALESCE(l.display_name, 'Someone') ORDER BY l.display_name NULLS LAST) AS names
        FROM (
            SELECT s.n FROM generate_series(v.step + 1, 3) AS s(n)
            WHERE EXISTS (SELECT 1 FROM app.oncall_ladder(s.n::SMALLINT, v.id))
            ORDER BY s.n LIMIT 1
        ) first_step
        CROSS JOIN LATERAL app.oncall_ladder(first_step.n::SMALLINT, v.id) l
    ) nxt ON v.status = 'offering'
    WHERE (p_alert_id IS NULL OR v.id = p_alert_id)
      AND (NOT COALESCE(p_open_only, false) OR v.status IN ('offering', 'unanswered'))
    ORDER BY v.created_at DESC, v.id
    LIMIT 100
$$;

-- One alert as p_user_id sees it (p_user_id NULL: no my_offer). No row: no such alert.
CREATE FUNCTION app.oncall_alert_get(p_alert_id UUID, p_user_id UUID)
RETURNS TABLE (
    id UUID, case_id UUID, case_number BIGINT, case_title TEXT, category TEXT, priority TEXT,
    status TEXT, step SMALLINT, step_expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ,
    accepted_by UUID, accepted_by_name TEXT, accepted_at TIMESTAMPTZ, arrived_at TIMESTAMPTZ,
    reminders_sent SMALLINT, description TEXT, location TEXT, latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION, contact_method TEXT, safe_to_contact BOOLEAN,
    my_offer_id UUID, my_offer_step SMALLINT, my_offer_expires_at TIMESTAMPTZ, my_offer_outcome TEXT,
    next_names TEXT[]
)
LANGUAGE sql STABLE AS $$
    SELECT * FROM app.oncall_alert_list(p_user_id, false, p_alert_id)
$$;

-- Close a case's open alert: 'resolved' (someone was assigned by hand) or
-- 'cancelled' (the case was resolved or closed, or no longer pages). Its
-- pending offers are superseded. Called in the case write's transaction,
-- which holds the case. Returns the alerts closed.
CREATE FUNCTION app.oncall_resolve_for_case(p_case_id UUID, p_status TEXT)
RETURNS TABLE (id UUID)
LANGUAGE plpgsql AS $$
BEGIN
    IF p_status NOT IN ('resolved', 'cancelled') THEN
        RAISE EXCEPTION 'An alert is closed as resolved or cancelled, not %', p_status
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN QUERY
        WITH closed AS (
            UPDATE app.oncall_alerts AS a
            SET status = p_status, closed_at = now(), step_expires_at = NULL
            WHERE a.case_id = p_case_id AND a.status IN ('offering', 'unanswered')
            RETURNING a.id
        ), handed_on AS (
            -- An accepted alert ends too once the case is no longer the
            -- acceptor's (reassigned) or is finished: their Responding
            -- screen must not stay live.
            UPDATE app.oncall_alerts AS a
            SET status = 'resolved', closed_at = now()
            FROM app.cases c
            WHERE a.case_id = p_case_id AND a.status = 'accepted' AND c.id = a.case_id
              AND (c.assigned_worker_id IS DISTINCT FROM a.accepted_by OR c.status IN ('resolved', 'closed'))
            RETURNING a.id
        ), superseded AS (
            UPDATE app.oncall_offers AS o SET outcome = 'superseded', responded_at = now()
            WHERE o.alert_id IN (SELECT closed.id FROM closed) AND o.outcome = 'pending'
        )
        SELECT closed.id FROM closed UNION ALL SELECT handed_on.id FROM handed_on;
END;
$$;

-- Reminder p_n (of at most p_max) for an unanswered alert (the oncall.remind
-- job): counts it and returns every admin to notify ('reminded'; one row
-- with no user when there are none). 'noop' when the alert isn't
-- unanswered any more, or this reminder already went out.
CREATE FUNCTION app.oncall_remind(p_alert_id UUID, p_n INT, p_max INT)
RETURNS TABLE (outcome TEXT, case_id UUID, user_id UUID)
LANGUAGE plpgsql AS $$
DECLARE
    v app.oncall_alerts;
BEGIN
    SELECT * INTO v FROM app.oncall_alert_lock(p_alert_id);
    IF v.id IS NULL OR v.status <> 'unanswered' OR p_n > p_max OR v.reminders_sent <> p_n - 1 THEN
        RETURN QUERY SELECT 'noop'::TEXT, NULL::UUID, NULL::UUID;
        RETURN;
    END IF;
    UPDATE app.oncall_alerts AS a SET reminders_sent = p_n WHERE a.id = p_alert_id;
    RETURN QUERY
        SELECT 'reminded'::TEXT, v.case_id, u.id
        FROM (SELECT 1) one
        LEFT JOIN app.users u ON u.role = 'admin'
        ORDER BY u.id;
END;
$$;

-- Alerts opened in [p_from, p_to): how many, how many were accepted and how
-- many went unanswered, the average seconds from opening to accept and from
-- accept to arrival (never below 0, should the clock step back), and passes
-- by reason ('none' for no reason given).
CREATE FUNCTION app.oncall_stats(p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TABLE (
    alerts BIGINT, accepted BIGINT, unanswered BIGINT, avg_seconds_to_accept DOUBLE PRECISION,
    avg_seconds_to_arrive DOUBLE PRECISION, passes_by_reason JSONB
)
LANGUAGE sql STABLE AS $$
    WITH chosen AS (
        SELECT a.* FROM app.oncall_alerts a WHERE a.created_at >= p_from AND a.created_at < p_to
    ),
    passes AS (
        SELECT COALESCE(o.pass_reason, 'none') AS reason, count(*) AS n
        FROM app.oncall_offers o JOIN chosen ON chosen.id = o.alert_id
        WHERE o.outcome = 'passed'
        GROUP BY 1
    )
    SELECT count(*),
           count(*) FILTER (WHERE chosen.accepted_at IS NOT NULL),
           count(*) FILTER (WHERE chosen.status = 'unanswered' OR chosen.reminders_sent > 0),
           (avg(GREATEST(extract(epoch FROM chosen.accepted_at - chosen.created_at), 0))
               FILTER (WHERE chosen.accepted_at IS NOT NULL))::DOUBLE PRECISION,
           (avg(GREATEST(extract(epoch FROM chosen.arrived_at - chosen.accepted_at), 0))
               FILTER (WHERE chosen.arrived_at IS NOT NULL))::DOUBLE PRECISION,
           (SELECT COALESCE(jsonb_object_agg(p.reason, p.n), '{}'::JSONB) FROM passes p)
    FROM chosen
$$;
