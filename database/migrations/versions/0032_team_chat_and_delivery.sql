-- =============================================================================
-- Team chat, requests to partners, who delivered the help, and each worker's
-- export of their own records (see 0032_team_chat_and_delivery.py).
--
-- app.chat_messages       staff-only messages in three kinds of channel:
--                         team (all staff), oncall (whoever is on call now,
--                         plus admins) and case (one per case; never shown
--                         to the resident). `rapid` marks a message urgent:
--                         the API pushes it to the channel's members.
-- app.chat_reads          how far each person has read each channel.
-- app.chat_notifications  which channel an inbox row (kind chat_message or
--                         chat_rapid) is about, so the inbox can name and
--                         open it and reading the channel clears it.
-- app.partner_requests    a worker asking a partner for help with a case:
--                         who asked, what for, the text that went (or that
--                         the worker sent from their own phone or email).
-- app.case_referrals      gains who delivered the help (the provider, or
--                         ComForce and which worker) and who confirmed it.
-- export_*                one worker's own records, for "Export my records".
--                         Never contact details, never raw text or audio.
--
-- Same conventions as 0015-0029: app.<domain>_<verb>, p_ parameters, no row
-- means not found, SECURITY INVOKER.
-- =============================================================================

-- =============================================================================
-- TEAM CHAT
-- =============================================================================

CREATE TABLE app.chat_messages (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel    TEXT NOT NULL CONSTRAINT chat_messages_channel_check CHECK (channel IN ('team', 'oncall', 'case')),
    -- The case of a case channel; NULL for team and oncall.
    case_id    UUID REFERENCES app.cases (id) ON DELETE CASCADE,
    author_id  UUID REFERENCES app.users (id) ON DELETE SET NULL,
    body       TEXT NOT NULL CONSTRAINT chat_messages_body_check CHECK (length(body) BETWEEN 1 AND 2000),
    rapid      BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT chat_messages_case_check CHECK ((channel = 'case') = (case_id IS NOT NULL))
);

CREATE INDEX chat_messages_channel_idx ON app.chat_messages (channel, case_id, created_at DESC);
CREATE INDEX chat_messages_author_idx ON app.chat_messages (author_id) WHERE channel = 'case';

CREATE TABLE app.chat_reads (
    user_id      UUID NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
    channel      TEXT NOT NULL CONSTRAINT chat_reads_channel_check CHECK (channel IN ('team', 'oncall', 'case')),
    case_id      UUID REFERENCES app.cases (id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT chat_reads_key UNIQUE NULLS NOT DISTINCT (user_id, channel, case_id)
);

CREATE TABLE app.chat_notifications (
    notification_id UUID PRIMARY KEY REFERENCES app.notifications (id) ON DELETE CASCADE,
    channel         TEXT NOT NULL CONSTRAINT chat_notifications_channel_check CHECK (
                        channel IN ('team', 'oncall', 'case')),
    case_id         UUID REFERENCES app.cases (id) ON DELETE CASCADE
);

-- 0019's kinds plus the chat kinds. chat_message: inbox only, never pushed.
-- chat_rapid: a rapid-response message, pushed like any other update.
ALTER TABLE app.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE app.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
    'assignment', 'reply', 'request_update', 'task_due', 'referral_update', 'test',
    'urgent_offer', 'urgent_unanswered', 'community_alert', 'chat_message', 'chat_rapid'));

-- 0019's view with chat_channel at the end (columns may only be added there).
-- The WHERE is unchanged: residents never see chat rows.
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
       n.alert_id,
       CASE WHEN s.staff THEN cn.channel END AS chat_channel
FROM app.notifications n
JOIN app.users reader ON reader.id = n.user_id
CROSS JOIN LATERAL (SELECT reader.role IN ('worker', 'admin') AS staff) s
LEFT JOIN app.cases c ON c.id = n.case_id
LEFT JOIN app.case_updates u ON u.id = n.case_update_id
LEFT JOIN app.tasks t ON t.id = n.task_id
LEFT JOIN app.case_referrals f ON f.id = n.referral_id
LEFT JOIN app.resources res ON res.id = f.resource_id
LEFT JOIN app.users a ON a.id = n.actor_id
LEFT JOIN app.chat_notifications cn ON cn.notification_id = n.id
WHERE s.staff OR n.kind IN ('request_update', 'test', 'community_alert');

-- A message with its author, and how many people other than the author have
-- read it.
CREATE VIEW app.chat_message_view AS
SELECT m.id, m.channel, m.case_id, m.author_id, a.display_name AS author_name, m.body, m.rapid, m.created_at,
       (SELECT count(*) FROM app.chat_reads r
        WHERE r.channel = m.channel AND r.case_id IS NOT DISTINCT FROM m.case_id
          AND r.last_read_at >= m.created_at AND r.user_id IS DISTINCT FROM m.author_id)::INT AS read_by
FROM app.chat_messages m
LEFT JOIN app.users a ON a.id = m.author_id;

-- Who belongs to a channel now, with when each last read it. team: every
-- staff member. oncall: whoever is on call now (0015's oncall_now) and every
-- admin. case: the assignee, whoever opened the case, and everyone who has
-- written in its channel. Staff only, always.
CREATE FUNCTION app.chat_members(p_channel TEXT, p_case_id UUID)
RETURNS TABLE (user_id UUID, last_read_at TIMESTAMPTZ)
LANGUAGE sql STABLE AS $$
    WITH ids AS (
        SELECT u.id FROM app.users u WHERE p_channel = 'team' AND u.role IN ('worker', 'admin')
        UNION
        SELECT o.user_id FROM app.oncall_now() o WHERE p_channel = 'oncall' AND o.slot = 'current'
        UNION
        SELECT u.id FROM app.users u WHERE p_channel = 'oncall' AND u.role = 'admin'
        UNION
        SELECT c.assigned_worker_id FROM app.cases c WHERE p_channel = 'case' AND c.id = p_case_id
        UNION
        SELECT c.created_by FROM app.cases c WHERE p_channel = 'case' AND c.id = p_case_id
        UNION
        SELECT m.author_id FROM app.chat_messages m
        WHERE p_channel = 'case' AND m.channel = 'case' AND m.case_id = p_case_id
    )
    SELECT u.id, r.last_read_at
    FROM ids
    JOIN app.users u ON u.id = ids.id AND u.role IN ('worker', 'admin')
    LEFT JOIN app.chat_reads r ON r.user_id = u.id AND r.channel = p_channel
                              AND r.case_id IS NOT DISTINCT FROM (CASE WHEN p_channel = 'case' THEN p_case_id END)
    ORDER BY u.id
$$;

-- The caller's channels with their latest message and unread counts: team
-- and oncall always, then the case channels they belong to that have a
-- message, newest first. With p_channel, just that one (a case channel
-- whenever the case exists, so "Discuss this case" opens even when empty).
CREATE FUNCTION app.chat_channel_list(p_user_id UUID, p_channel TEXT, p_case_id UUID)
RETURNS TABLE (
    channel TEXT, case_id UUID, case_number BIGINT, case_title TEXT, last_message_at TIMESTAMPTZ,
    last_message TEXT, last_author_name TEXT, last_read_at TIMESTAMPTZ, unread INT, rapid_unread INT)
LANGUAGE sql STABLE AS $$
    WITH channels AS (
        SELECT 'team'::TEXT AS channel, NULL::UUID AS case_id WHERE p_channel IS NULL OR p_channel = 'team'
        UNION ALL
        SELECT 'oncall', NULL WHERE p_channel IS NULL OR p_channel = 'oncall'
        UNION ALL
        SELECT 'case', c.id FROM app.cases c WHERE p_channel = 'case' AND c.id = p_case_id
        UNION ALL
        SELECT 'case', c.id FROM app.cases c
        WHERE p_channel IS NULL
          AND EXISTS (SELECT 1 FROM app.chat_messages m WHERE m.channel = 'case' AND m.case_id = c.id)
          AND (c.assigned_worker_id = p_user_id OR c.created_by = p_user_id
               OR EXISTS (SELECT 1 FROM app.chat_messages m
                          WHERE m.channel = 'case' AND m.case_id = c.id AND m.author_id = p_user_id))
    )
    SELECT ch.channel, ch.case_id, c.number, c.title, last.created_at, last.body, last.author_name, r.last_read_at,
           COALESCE(counts.unread, 0), COALESCE(counts.rapid_unread, 0)
    FROM channels ch
    LEFT JOIN app.cases c ON c.id = ch.case_id
    LEFT JOIN app.chat_reads r ON r.user_id = p_user_id AND r.channel = ch.channel
                              AND r.case_id IS NOT DISTINCT FROM ch.case_id
    LEFT JOIN LATERAL (
        SELECT m.created_at, m.body, a.display_name AS author_name
        FROM app.chat_messages m
        LEFT JOIN app.users a ON a.id = m.author_id
        WHERE m.channel = ch.channel AND m.case_id IS NOT DISTINCT FROM ch.case_id
        ORDER BY m.created_at DESC
        LIMIT 1
    ) last ON true
    LEFT JOIN LATERAL (
        SELECT count(*)::INT AS unread, (count(*) FILTER (WHERE m.rapid))::INT AS rapid_unread
        FROM app.chat_messages m
        WHERE m.channel = ch.channel AND m.case_id IS NOT DISTINCT FROM ch.case_id
          AND m.author_id IS DISTINCT FROM p_user_id
          AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)
    ) counts ON true
    ORDER BY ch.channel = 'case', last.created_at DESC NULLS LAST, ch.case_id
$$;

-- The newest p_limit messages of a channel (before p_before, when given),
-- oldest first.
CREATE FUNCTION app.chat_message_list(p_channel TEXT, p_case_id UUID, p_before TIMESTAMPTZ, p_limit INT)
RETURNS SETOF app.chat_message_view
LANGUAGE sql STABLE AS $$
    SELECT * FROM (
        SELECT v.* FROM app.chat_message_view v
        WHERE v.channel = p_channel AND v.case_id IS NOT DISTINCT FROM p_case_id
          AND (p_before IS NULL OR v.created_at < p_before)
        ORDER BY v.created_at DESC, v.id DESC
        LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
    ) newest
    ORDER BY newest.created_at, newest.id
$$;

-- A new message; its author has read the channel up to it. No row when a
-- case channel's case doesn't exist.
CREATE FUNCTION app.chat_message_create(
    p_author_id UUID, p_channel TEXT, p_case_id UUID, p_body TEXT, p_rapid BOOLEAN)
RETURNS SETOF app.chat_message_view
LANGUAGE plpgsql AS $$
DECLARE
    v_id UUID;
    v_at TIMESTAMPTZ;
BEGIN
    IF p_channel = 'case' AND NOT EXISTS (SELECT 1 FROM app.cases c WHERE c.id = p_case_id) THEN
        RETURN;
    END IF;
    INSERT INTO app.chat_messages AS m (channel, case_id, author_id, body, rapid)
    VALUES (p_channel, CASE WHEN p_channel = 'case' THEN p_case_id END, p_author_id, p_body,
            COALESCE(p_rapid, false))
    RETURNING m.id, m.created_at INTO v_id, v_at;
    INSERT INTO app.chat_reads AS r (user_id, channel, case_id, last_read_at)
    VALUES (p_author_id, p_channel, CASE WHEN p_channel = 'case' THEN p_case_id END, v_at)
    ON CONFLICT ON CONSTRAINT chat_reads_key DO UPDATE SET last_read_at = GREATEST(r.last_read_at, EXCLUDED.last_read_at);
    RETURN QUERY SELECT v.* FROM app.chat_message_view v WHERE v.id = v_id;
END
$$;

-- The caller has read the channel up to now: their chat inbox rows about it
-- are read too.
CREATE FUNCTION app.chat_read(p_user_id UUID, p_channel TEXT, p_case_id UUID)
RETURNS TABLE (last_read_at TIMESTAMPTZ, notifications_read BIGINT)
LANGUAGE plpgsql AS $$
DECLARE
    v_case UUID := CASE WHEN p_channel = 'case' THEN p_case_id END;
    v_at TIMESTAMPTZ;
    v_read BIGINT;
BEGIN
    INSERT INTO app.chat_reads AS r (user_id, channel, case_id, last_read_at)
    VALUES (p_user_id, p_channel, v_case, clock_timestamp())
    ON CONFLICT ON CONSTRAINT chat_reads_key DO UPDATE SET last_read_at = GREATEST(r.last_read_at, EXCLUDED.last_read_at)
    RETURNING r.last_read_at INTO v_at;
    WITH done AS (
        UPDATE app.notifications AS n SET read_at = now()
        FROM app.chat_notifications cn
        WHERE cn.notification_id = n.id AND n.user_id = p_user_id AND n.read_at IS NULL
          AND cn.channel = p_channel AND cn.case_id IS NOT DISTINCT FROM v_case
        RETURNING 1
    )
    SELECT count(*) INTO v_read FROM done;
    RETURN QUERY SELECT v_at, v_read;
END
$$;

-- An inbox row about a channel (like 0018's notification_create, plus the
-- channel). The same key twice, or the person who acted: no row.
CREATE FUNCTION app.chat_notify(
    p_user_id UUID, p_kind TEXT, p_dedupe_key TEXT, p_channel TEXT, p_case_id UUID, p_actor_id UUID)
RETURNS SETOF app.notifications
LANGUAGE plpgsql AS $$
DECLARE
    v_row app.notifications;
BEGIN
    INSERT INTO app.notifications AS n (user_id, kind, dedupe_key, case_id, actor_id)
    SELECT p_user_id, p_kind, p_dedupe_key, CASE WHEN p_channel = 'case' THEN p_case_id END, p_actor_id
    WHERE p_user_id IS DISTINCT FROM p_actor_id
    ON CONFLICT ON CONSTRAINT notifications_user_dedupe_key DO NOTHING
    RETURNING n.* INTO v_row;
    IF v_row.id IS NULL THEN
        RETURN;
    END IF;
    INSERT INTO app.chat_notifications (notification_id, channel, case_id)
    VALUES (v_row.id, p_channel, v_row.case_id);
    RETURN NEXT v_row;
END
$$;

-- Which channel a chat notification is about (the push job's fixed text
-- names it). No row: not a chat notification.
CREATE FUNCTION app.chat_notification_channel(p_notification_id UUID)
RETURNS TABLE (channel TEXT)
LANGUAGE sql STABLE AS $$
    SELECT cn.channel FROM app.chat_notifications cn WHERE cn.notification_id = p_notification_id
$$;

-- =============================================================================
-- REQUESTS TO PARTNERS
-- =============================================================================

CREATE TABLE app.partner_requests (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id           UUID NOT NULL REFERENCES app.cases (id) ON DELETE CASCADE,
    partner_id        UUID NOT NULL REFERENCES app.partners (id) ON DELETE RESTRICT,
    requested_by      UUID REFERENCES app.users (id) ON DELETE SET NULL,
    -- The ComForce service the help is for.
    need              TEXT NOT NULL CONSTRAINT partner_requests_need_check CHECK (need IN (
                          'homelessness', 'missing_persons', 'meal_programs', 'violence_prevention',
                          'transportation', 'incident_deescalation', 'burial_assistance',
                          'bridge_to_employment', 'other')),
    -- The worker's own words.
    note              TEXT NOT NULL CONSTRAINT partner_requests_note_check CHECK (length(note) BETWEEN 1 AND 1000),
    -- The whole text the partner gets: the record of what they were told.
    message           TEXT NOT NULL CONSTRAINT partner_requests_message_check CHECK (length(message) <= 4000),
    -- sms: texted from the worker's upkeep (pending until then). compose:
    -- returned to the app, sent from the worker's own email or phone.
    delivery          TEXT NOT NULL CONSTRAINT partner_requests_delivery_check CHECK (delivery IN ('sms', 'compose')),
    status            TEXT NOT NULL CONSTRAINT partner_requests_status_check CHECK (
                          status IN ('pending', 'sent', 'failed', 'composed')),
    reason            TEXT CONSTRAINT partner_requests_reason_check CHECK (length(reason) <= 120),
    provider_id       TEXT CONSTRAINT partner_requests_provider_id_check CHECK (length(provider_id) <= 64),
    -- Only with a live consented share with this partner that included them.
    included_contact  BOOLEAN NOT NULL DEFAULT false,
    included_location BOOLEAN NOT NULL DEFAULT false,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at           TIMESTAMPTZ
);

CREATE INDEX partner_requests_case_idx ON app.partner_requests (case_id, created_at DESC);
CREATE INDEX partner_requests_pending_idx ON app.partner_requests (created_at) WHERE status = 'pending';

CREATE VIEW app.partner_request_view AS
SELECT q.id, q.case_id, q.partner_id, p.name AS partner_name, p.email AS partner_email, p.phone AS partner_phone,
       q.requested_by, u.display_name AS requested_by_name, q.need, q.note, q.message, q.delivery, q.status,
       q.reason, q.included_contact, q.included_location, q.created_at, q.sent_at
FROM app.partner_requests q
JOIN app.partners p ON p.id = q.partner_id
LEFT JOIN app.users u ON u.id = q.requested_by;

-- A new request, and its line on the case's history (internal) in the same
-- statement. No row when the case or an active partner is missing.
CREATE FUNCTION app.partner_request_create(
    p_case_id UUID, p_partner_id UUID, p_requested_by UUID, p_need TEXT, p_note TEXT, p_message TEXT,
    p_delivery TEXT, p_included_contact BOOLEAN, p_included_location BOOLEAN)
RETURNS SETOF app.partner_request_view
LANGUAGE plpgsql AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO app.partner_requests AS q (case_id, partner_id, requested_by, need, note, message, delivery, status,
                                           included_contact, included_location)
    SELECT c.id, p.id, p_requested_by, p_need, p_note, p_message, p_delivery,
           CASE WHEN p_delivery = 'sms' THEN 'pending' ELSE 'composed' END,
           COALESCE(p_included_contact, false), COALESCE(p_included_location, false)
    FROM app.cases c, app.partners p
    WHERE c.id = p_case_id AND p.id = p_partner_id AND p.active
    RETURNING q.id INTO v_id;
    IF v_id IS NULL THEN
        RETURN;
    END IF;

    INSERT INTO app.case_updates (case_id, author_id, update_type, content)
    SELECT p_case_id, p_requested_by, 'note',
           'Asked ' || v.partner_name || ' for help ('
           || CASE WHEN p_delivery = 'sms' THEN 'by text' ELSE 'by email or phone' END || '): ' || p_note
           || CASE WHEN v.included_contact THEN ' Shared the name and phone, with consent.' ELSE '' END
    FROM app.partner_request_view v WHERE v.id = v_id;
    UPDATE app.cases AS c SET updated_at = now() WHERE c.id = p_case_id;

    RETURN QUERY SELECT v.* FROM app.partner_request_view v WHERE v.id = v_id;
END
$$;

CREATE FUNCTION app.partner_request_list(p_case_id UUID)
RETURNS SETOF app.partner_request_view
LANGUAGE sql STABLE AS $$
    SELECT v.* FROM app.partner_request_view v WHERE v.case_id = p_case_id ORDER BY v.created_at DESC, v.id
$$;

-- Requests still to text, oldest first, with the partner's number as stored.
CREATE FUNCTION app.partner_request_pending(p_limit INT)
RETURNS TABLE (id UUID, case_id UUID, partner_phone TEXT, message TEXT)
LANGUAGE sql STABLE AS $$
    SELECT q.id, q.case_id, p.phone, q.message
    FROM app.partner_requests q
    JOIN app.partners p ON p.id = q.partner_id
    WHERE q.status = 'pending'
    ORDER BY q.created_at, q.id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 200)
$$;

-- What happened to a pending text. Nothing when it isn't pending any more.
CREATE FUNCTION app.partner_request_mark(p_request_id UUID, p_status TEXT, p_reason TEXT, p_provider_id TEXT)
RETURNS SETOF app.partner_request_view
LANGUAGE plpgsql AS $$
DECLARE
    v_id UUID;
BEGIN
    UPDATE app.partner_requests AS q
    SET status = p_status, reason = left(p_reason, 120), provider_id = left(p_provider_id, 64),
        sent_at = CASE WHEN p_status = 'sent' THEN now() END
    WHERE q.id = p_request_id AND q.status = 'pending'
    RETURNING q.id INTO v_id;
    RETURN QUERY SELECT v.* FROM app.partner_request_view v WHERE v.id = v_id;
END
$$;

-- =============================================================================
-- WHO DELIVERED THE HELP
-- =============================================================================

-- Set when a referral is marked completed (the person got the help):
-- provider (the referral's resource) or comforce (and which worker), and who
-- confirmed it and when. Cleared if the referral moves off completed.
ALTER TABLE app.case_referrals
    ADD COLUMN delivered_by           TEXT CONSTRAINT case_referrals_delivered_by_check CHECK (
                                          delivered_by IN ('provider', 'comforce')),
    ADD COLUMN delivered_by_worker_id UUID REFERENCES app.users (id) ON DELETE SET NULL,
    ADD COLUMN confirmed_by           UUID REFERENCES app.users (id) ON DELETE SET NULL,
    ADD COLUMN confirmed_at           TIMESTAMPTZ;

-- 0005's view with the delivery columns at the end.
CREATE OR REPLACE VIEW app.referral_view AS
SELECT f.id, f.case_id, f.resource_id, r.name AS resource_name, r.category AS resource_category,
       r.phone AS resource_phone, r.website AS resource_website, r.is_sample AS resource_is_sample,
       f.status, f.outcome, f.created_by, f.created_at, f.updated_at,
       f.delivered_by, f.delivered_by_worker_id, dw.display_name AS delivered_by_worker_name,
       f.confirmed_by, cu.display_name AS confirmed_by_name, f.confirmed_at
FROM app.case_referrals f
JOIN app.resources r ON r.id = f.resource_id
LEFT JOIN app.users dw ON dw.id = f.delivered_by_worker_id
LEFT JOIN app.users cu ON cu.id = f.confirmed_by;

-- 0005's, plus who delivered the help. Marking a referral completed records
-- p_delivered_by (default provider; comforce takes p_delivered_by_worker_id,
-- default the actor) and the actor as the one who confirmed it, in the same
-- history line as the status change. On a referral already completed, a new
-- p_delivered_by changes it with a line of its own.
DROP FUNCTION app.referral_update;
CREATE FUNCTION app.referral_update(
    p_case_id UUID, p_referral_id UUID, p_status TEXT, p_outcome TEXT, p_actor_id UUID,
    p_delivered_by TEXT DEFAULT NULL, p_delivered_by_worker_id UUID DEFAULT NULL)
RETURNS SETOF app.referral_view
LANGUAGE plpgsql AS $$
DECLARE
    v_old TEXT;
    v_old_by TEXT;
    v_new TEXT;
    v_by TEXT;
    v_delivered TEXT := '';
BEGIN
    SELECT f.status, f.delivered_by INTO v_old, v_old_by FROM app.case_referrals f
    WHERE f.id = p_referral_id AND f.case_id = p_case_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    UPDATE app.case_referrals AS f
    SET status = COALESCE(p_status, f.status), outcome = COALESCE(p_outcome, f.outcome), updated_at = now()
    WHERE f.id = p_referral_id
    RETURNING f.status INTO v_new;

    IF v_new = 'completed' AND (v_old IS DISTINCT FROM 'completed' OR p_delivered_by IS NOT NULL) THEN
        v_by := COALESCE(p_delivered_by, v_old_by, 'provider');
        UPDATE app.case_referrals AS f
        SET delivered_by = v_by,
            delivered_by_worker_id = CASE WHEN v_by = 'comforce' THEN COALESCE(p_delivered_by_worker_id, p_actor_id) END,
            confirmed_by = p_actor_id, confirmed_at = now()
        WHERE f.id = p_referral_id;
        SELECT ' Delivered by '
               || CASE WHEN v.delivered_by = 'comforce'
                       THEN 'ComForce MKE' || COALESCE(' (' || v.delivered_by_worker_name || ')', '')
                       ELSE v.resource_name END
               || COALESCE(' · confirmed by ' || v.confirmed_by_name, '') || '.'
        INTO v_delivered
        FROM app.referral_view v WHERE v.id = p_referral_id;
    ELSIF v_new <> 'completed' THEN
        UPDATE app.case_referrals AS f
        SET delivered_by = NULL, delivered_by_worker_id = NULL, confirmed_by = NULL, confirmed_at = NULL
        WHERE f.id = p_referral_id AND f.delivered_by IS NOT NULL;
    END IF;

    IF v_new IS DISTINCT FROM v_old THEN
        INSERT INTO app.case_updates (case_id, author_id, update_type, content)
        SELECT p_case_id, p_actor_id, 'referral',
               'Referral to ' || v.resource_name || ' marked ' || v_new || '.' || COALESCE(v_delivered, '')
        FROM app.referral_view v WHERE v.id = p_referral_id;
    ELSIF COALESCE(v_delivered, '') <> '' THEN
        INSERT INTO app.case_updates (case_id, author_id, update_type, content)
        VALUES (p_case_id, p_actor_id, 'referral', ltrim(v_delivered));
    END IF;
    IF p_outcome IS NOT NULL THEN
        INSERT INTO app.case_updates (case_id, author_id, update_type, content)
        SELECT p_case_id, p_actor_id, 'referral', 'Outcome for ' || v.resource_name || ': ' || p_outcome
        FROM app.referral_view v WHERE v.id = p_referral_id;
    END IF;
    UPDATE app.cases AS c SET updated_at = now() WHERE c.id = p_case_id;

    RETURN QUERY SELECT * FROM app.referral_view v WHERE v.id = p_referral_id;
END
$$;

-- Helped (completed) referrals confirmed in [p_start, p_end) by who
-- delivered them: each provider by name, and ComForce MKE itself. Cases in
-- p_district only, when given (0020's case_places).
CREATE FUNCTION app.insights_delivered_by(p_start TIMESTAMPTZ, p_end TIMESTAMPTZ, p_district TEXT)
RETURNS TABLE (provider TEXT, delivered_by TEXT, helped BIGINT)
LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN f.delivered_by = 'comforce' THEN 'ComForce MKE' ELSE r.name END,
           COALESCE(f.delivered_by, 'provider'), count(*)
    FROM app.case_referrals f
    JOIN app.resources r ON r.id = f.resource_id
    LEFT JOIN app.case_places p ON p.case_id = f.case_id
    WHERE f.status = 'completed'
      AND COALESCE(f.confirmed_at, f.updated_at) >= p_start AND COALESCE(f.confirmed_at, f.updated_at) < p_end
      AND (p_district IS NULL OR p.police_district = p_district)
    GROUP BY 1, 2
    ORDER BY count(*) DESC, 1
$$;

-- =============================================================================
-- EXPORT MY RECORDS (only the caller's own; never contact details)
-- =============================================================================

-- Debriefs the worker recorded that reached review: the AI's reading as
-- reviewed (summary and fields), never the text or the audio.
CREATE FUNCTION app.export_debriefs(p_user_id UUID)
RETURNS TABLE (
    id UUID, created_at TIMESTAMPTZ, confirmed_at TIMESTAMPTZ, status TEXT, source TEXT, title TEXT, summary TEXT,
    kind TEXT, category TEXT, priority TEXT, location TEXT, risk_flags TEXT, case_number BIGINT)
LANGUAGE sql STABLE AS $$
    SELECT r.id, r.created_at, r.confirmed_at, r.status, r.source, r.extraction ->> 'title',
           r.extraction ->> 'summary', r.extraction ->> 'kind', r.extraction ->> 'category',
           r.extraction ->> 'priority', r.extraction ->> 'location',
           (SELECT string_agg(x, '; ') FROM jsonb_array_elements_text(
               CASE WHEN jsonb_typeof(r.extraction -> 'risk_flags') = 'array' THEN r.extraction -> 'risk_flags'
                    ELSE '[]'::jsonb END) x),
           c.number
    FROM app.records r
    LEFT JOIN app.cases c ON c.id = r.case_id
    WHERE r.author_id = p_user_id AND r.status IN ('ready', 'confirmed')
    ORDER BY r.created_at, r.id
$$;

-- Cases assigned to or opened by the worker, with how their referrals went.
CREATE FUNCTION app.export_cases(p_user_id UUID)
RETURNS TABLE (
    id UUID, number BIGINT, title TEXT, kind TEXT, category TEXT, priority TEXT, status TEXT, source TEXT,
    assigned BOOLEAN, created BOOLEAN, created_at TIMESTAMPTZ, resolved_at TIMESTAMPTZ, referrals BIGINT,
    helped BIGINT)
LANGUAGE sql STABLE AS $$
    SELECT c.id, c.number, c.title, c.kind, c.category, c.priority, c.status, c.source,
           c.assigned_worker_id IS NOT DISTINCT FROM p_user_id, c.created_by IS NOT DISTINCT FROM p_user_id,
           c.created_at, c.resolved_at,
           (SELECT count(*) FROM app.case_referrals f WHERE f.case_id = c.id),
           (SELECT count(*) FROM app.case_referrals f WHERE f.case_id = c.id AND f.status = 'completed')
    FROM app.cases c
    WHERE c.assigned_worker_id = p_user_id OR c.created_by = p_user_id
    ORDER BY c.created_at, c.id
$$;

-- Tasks the worker completed.
CREATE FUNCTION app.export_tasks(p_user_id UUID)
RETURNS TABLE (id UUID, title TEXT, case_number BIGINT, created_at TIMESTAMPTZ, due_at TIMESTAMPTZ,
               completed_at TIMESTAMPTZ)
LANGUAGE sql STABLE AS $$
    SELECT t.id, t.title, c.number, t.created_at, t.due_at, t.completed_at
    FROM app.tasks t
    JOIN app.cases c ON c.id = t.case_id
    WHERE t.completed_by = p_user_id AND t.status = 'done'
    ORDER BY t.completed_at, t.id
$$;

-- Referral outcomes the worker confirmed.
CREATE FUNCTION app.export_outcomes(p_user_id UUID)
RETURNS TABLE (id UUID, case_id UUID, case_number BIGINT, resource_name TEXT, status TEXT, delivered_by TEXT,
               delivered_by_worker_name TEXT, outcome TEXT, confirmed_at TIMESTAMPTZ)
LANGUAGE sql STABLE AS $$
    SELECT v.id, v.case_id, c.number, v.resource_name, v.status, v.delivered_by, v.delivered_by_worker_name,
           v.outcome, v.confirmed_at
    FROM app.referral_view v
    JOIN app.cases c ON c.id = v.case_id
    WHERE v.confirmed_by = p_user_id
    ORDER BY v.confirmed_at, v.id
$$;
