"""The resident lane: open bed counts on resources, weather alerts the
worker has acted on (outreach tasks), community alert opt-ins with the
`community_alert` notification kind, and push subscriptions for requests
sent without an account. The SQL is in 0019_resident_lane.sql.

Never edit this file once it has been applied; change a function in a new
revision.

Revision ID: 0019
Revises: 0018
Create Date: 2026-11-21
"""

from alembic import context, op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None

# Every function 0019_resident_lane.sql creates (none is overloaded).
# test_migrations.py checks the union of every revision's list against the
# database.
FUNCTIONS = (
    "resource_beds_set",
    "weather_alert_claim_new",
    "weather_outreach_tasks",
    "community_alerts_get",
    "community_alerts_set",
    "community_alert_recipients",
    "request_push_subscribe",
    "request_push_unsubscribe",
    "request_push_targets",
    "request_push_disable",
)

DOWNGRADE = """
DROP TABLE app.request_push_subscriptions;

-- 0018's view and kinds.
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

DELETE FROM app.notifications WHERE kind = 'community_alert';
ALTER TABLE app.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE app.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
    'assignment', 'reply', 'request_update', 'task_due', 'referral_update', 'test',
    'urgent_offer', 'urgent_unanswered'));

DROP TABLE app.community_alert_subscribers;
DROP TABLE app.weather_alert_handled;

ALTER TABLE app.resources
    DROP CONSTRAINT resources_beds_dated,
    DROP COLUMN beds_updated_by,
    DROP COLUMN beds_updated_at,
    DROP COLUMN beds_available;
"""


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    drops = "\n".join(f"DROP FUNCTION app.{name};" for name in FUNCTIONS)
    context.config.attributes["execute_script"](op.get_bind(), drops + DOWNGRADE)
