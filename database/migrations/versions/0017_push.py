"""Push delivery: app.push_devices (one row per installed app per user),
app.push_deliveries (one row per notification per device), the
notifications.expires_at column and the `test` kind. The SQL is in
0017_push.sql.

Never edit this file once it has been applied; change a function in a new
revision.

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-21
"""

from alembic import context, op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None

# Every function 0017_push.sql creates (none is overloaded).
# notification_create is 0016's, replaced here (it gains p_expires_at); the
# downgrade puts 0016's definition back, with 0016's view and kind list.
# test_migrations.py checks the union of every revision's list against the
# database.
FUNCTIONS = (
    "push_device_register",
    "push_device_remove",
    "push_device_disable",
    "push_device_list_active",
    "push_device_prune",
    "notification_push_facts",
    "notification_delivery_claim",
    "notification_delivery_record",
    "notification_delivery_give_up",
    "notification_delivery_prune",
    "notification_stats",
)

DOWNGRADE = """
DROP TABLE app.notification_deliveries;
DROP TABLE app.push_devices;

DELETE FROM app.notifications WHERE kind = 'test';

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
WHERE s.staff OR n.kind = 'request_update';

ALTER TABLE app.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE app.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
    'assignment', 'reply', 'request_update', 'task_due', 'referral_update'));

-- The function returns the table's row, so it goes before the column does.
DROP FUNCTION app.notification_create;
ALTER TABLE app.notifications DROP COLUMN expires_at;
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
"""


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    drops = "\n".join(f"DROP FUNCTION app.{name};" for name in FUNCTIONS)
    context.config.attributes["execute_script"](op.get_bind(), drops + DOWNGRADE)
