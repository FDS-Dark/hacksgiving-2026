"""Urgent escalation: app.oncall_alerts (one per urgent case that needs
someone) and app.oncall_offers (one per person per step), the
notifications.alert_id column, the urgent notification kinds and the
`alert` history type. The SQL is in 0018_urgent_alerts.sql.

Never edit this file once it has been applied; change a function in a new
revision.

Revision ID: 0018
Revises: 0017
Create Date: 2026-11-21
"""

from alembic import context, op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None

# Every function 0018_urgent_alerts.sql creates (none is overloaded).
# notification_create is replaced (it gains p_alert_id): the downgrade puts
# 0017's back, and with 0017's view the two functions that return its row.
# test_migrations.py checks the union of every revision's list against the
# database.
FUNCTIONS = (
    "oncall_ladder",
    "oncall_alert_lock",
    "oncall_alert_open",
    "oncall_alert_sweep",
    "oncall_offer_step",
    "oncall_escalate",
    "oncall_advance",
    "oncall_accept",
    "oncall_pass",
    "oncall_arrived",
    "oncall_alert_list",
    "oncall_alert_get",
    "oncall_resolve_for_case",
    "oncall_remind",
    "oncall_stats",
)

DOWNGRADE = """
DROP VIEW app.oncall_alert_view;

-- The view loses alert_id, and a view can't drop a column in place: the
-- functions returning its row go and come back with it (0016's).
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

DELETE FROM app.notifications WHERE kind IN ('urgent_offer', 'urgent_unanswered');
ALTER TABLE app.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE app.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
    'assignment', 'reply', 'request_update', 'task_due', 'referral_update', 'test'));

DELETE FROM app.case_updates WHERE update_type = 'alert';
ALTER TABLE app.case_updates DROP CONSTRAINT case_updates_type_check;
ALTER TABLE app.case_updates ADD CONSTRAINT case_updates_type_check CHECK (update_type IN (
    'created', 'note', 'message', 'status_change', 'priority_change',
    'category_change', 'assignment', 'referral', 'reply'));

-- The function returns the table's row, so it goes before the column does.
DROP FUNCTION app.notification_create;
ALTER TABLE app.notifications DROP COLUMN alert_id;
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

DROP TABLE app.oncall_offers;
DROP TABLE app.oncall_alerts;
"""


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    drops = "\n".join(f"DROP FUNCTION app.{name};" for name in FUNCTIONS)
    context.config.attributes["execute_script"](op.get_bind(), drops + DOWNGRADE)
