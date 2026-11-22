-- The downgrade of 0032_team_chat_and_delivery.sql, after its FUNCTIONS are
-- dropped (0032_team_chat_and_delivery.py).

-- Referrals: the view loses its delivery columns, and a view can't drop a
-- column in place, so the functions returning its row go and come back
-- with it (0005's).
DROP FUNCTION app.referral_list;
DROP FUNCTION app.referral_add;
DROP FUNCTION app.referral_update;
DROP VIEW app.referral_view;
ALTER TABLE app.case_referrals
    DROP COLUMN delivered_by, DROP COLUMN delivered_by_worker_id, DROP COLUMN confirmed_by,
    DROP COLUMN confirmed_at;

CREATE VIEW app.referral_view AS
SELECT f.id, f.case_id, f.resource_id, r.name AS resource_name, r.category AS resource_category,
       r.phone AS resource_phone, r.website AS resource_website, r.is_sample AS resource_is_sample,
       f.status, f.outcome, f.created_by, f.created_at, f.updated_at
FROM app.case_referrals f
JOIN app.resources r ON r.id = f.resource_id;

CREATE FUNCTION app.referral_list(p_case_id UUID)
RETURNS SETOF app.referral_view
LANGUAGE sql STABLE AS $$
    SELECT v.* FROM app.referral_view v WHERE v.case_id = p_case_id ORDER BY v.created_at
$$;

CREATE FUNCTION app.referral_add(p_case_id UUID, p_resource_id UUID, p_status TEXT, p_actor_id UUID)
RETURNS SETOF app.referral_view
LANGUAGE plpgsql AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO app.case_referrals AS f (case_id, resource_id, status, created_by)
    SELECT c.id, r.id, p_status, p_actor_id
    FROM app.cases c, app.resources r
    WHERE c.id = p_case_id AND r.id = p_resource_id
    ON CONFLICT ON CONSTRAINT case_referrals_case_resource_key DO NOTHING
    RETURNING f.id INTO v_id;
    IF v_id IS NULL THEN
        RETURN;
    END IF;

    INSERT INTO app.case_updates (case_id, author_id, update_type, content)
    SELECT p_case_id, p_actor_id, 'referral', 'Referral to ' || r.name || ' ' || p_status || '.'
    FROM app.resources r WHERE r.id = p_resource_id;
    UPDATE app.cases AS c SET updated_at = now() WHERE c.id = p_case_id;

    RETURN QUERY SELECT * FROM app.referral_view v WHERE v.id = v_id;
END
$$;

CREATE FUNCTION app.referral_update(
    p_case_id UUID, p_referral_id UUID, p_status TEXT, p_outcome TEXT, p_actor_id UUID)
RETURNS SETOF app.referral_view
LANGUAGE plpgsql AS $$
DECLARE
    v_old TEXT;
    v_new TEXT;
BEGIN
    SELECT f.status INTO v_old FROM app.case_referrals f
    WHERE f.id = p_referral_id AND f.case_id = p_case_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    UPDATE app.case_referrals AS f
    SET status = COALESCE(p_status, f.status), outcome = COALESCE(p_outcome, f.outcome), updated_at = now()
    WHERE f.id = p_referral_id
    RETURNING f.status INTO v_new;

    IF v_new IS DISTINCT FROM v_old THEN
        INSERT INTO app.case_updates (case_id, author_id, update_type, content)
        SELECT p_case_id, p_actor_id, 'referral', 'Referral to ' || v.resource_name || ' marked ' || v_new || '.'
        FROM app.referral_view v WHERE v.id = p_referral_id;
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

DROP VIEW app.partner_request_view;
DROP TABLE app.partner_requests;

-- Notifications: 0019's view (without chat_channel), and with it the two
-- functions that return its row (0016's).
DROP FUNCTION app.notification_list;
DROP FUNCTION app.notification_get;
DROP VIEW app.notification_view;
CREATE VIEW app.notification_view AS
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

CREATE FUNCTION app.notification_list(p_user_id UUID, p_before TIMESTAMPTZ, p_limit INT)
RETURNS SETOF app.notification_view
LANGUAGE sql STABLE AS $$
    SELECT v.* FROM app.notification_view v
    WHERE v.user_id = p_user_id AND (p_before IS NULL OR v.created_at < p_before)
    ORDER BY v.created_at DESC, v.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
$$;

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

DROP TABLE app.chat_notifications;
DELETE FROM app.notifications WHERE kind IN ('chat_message', 'chat_rapid');
ALTER TABLE app.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE app.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
    'assignment', 'reply', 'request_update', 'task_due', 'referral_update', 'test',
    'urgent_offer', 'urgent_unanswered', 'community_alert'));

DROP VIEW app.chat_message_view;
DROP TABLE app.chat_reads;
DROP TABLE app.chat_messages;
