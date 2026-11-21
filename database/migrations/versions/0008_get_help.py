"""A resident asks for help: safe-contact preferences, requests sent without
an account (read back with an access code), requester replies, and tasks
generated for each case. The SQL is in 0008_get_help.sql.

Never edit this file once it has been applied; change a function in a new
revision.

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-21
"""

from alembic import context, op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None

# Every function 0008_get_help.sql creates (none is overloaded).
# test_migrations.py checks the union of every revision's list against the
# database.
FUNCTIONS = (
    "request_create",
    "request_get_by_code",
    "request_list_public_updates",
    "request_add_reply",
    "task_create",
    "task_list",
    "task_get",
    "task_update",
)

# case_view keeps its two new columns (a view's columns can't be dropped
# while 0005's functions return its row type); they read NULL until the next
# upgrade fills them again.
DOWNGRADE = """
DROP VIEW app.task_view;
DROP TABLE app.tasks;
DELETE FROM app.case_updates WHERE update_type = 'reply';
ALTER TABLE app.case_updates DROP CONSTRAINT case_updates_type_check;
ALTER TABLE app.case_updates ADD CONSTRAINT case_updates_type_check CHECK (update_type IN (
    'created', 'note', 'message', 'status_change', 'priority_change',
    'category_change', 'assignment', 'referral'));
CREATE OR REPLACE VIEW app.case_view AS
SELECT c.id, c.number, c.kind, c.title, c.description, c.category, c.priority, c.status, c.source,
       c.location, c.latitude, c.longitude, c.contact_name, c.contact_phone, c.contact_email,
       c.requester_id, c.assigned_worker_id, w.display_name AS assigned_worker_name,
       c.created_by, c.created_at, c.updated_at, c.resolved_at,
       (SELECT count(*) FROM app.case_referrals r WHERE r.case_id = c.id) AS referral_count,
       COALESCE((SELECT max(u.created_at) FROM app.case_updates u WHERE u.case_id = c.id), c.created_at)
           AS last_activity_at,
       NULL::text AS contact_method, NULL::boolean AS safe_to_contact
FROM app.cases c
LEFT JOIN app.users w ON w.id = c.assigned_worker_id;
ALTER TABLE app.cases DROP COLUMN access_code_hash, DROP COLUMN safe_to_contact, DROP COLUMN contact_method;
"""


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    drops = "\n".join(f"DROP FUNCTION app.{name};" for name in FUNCTIONS)
    context.config.attributes["execute_script"](op.get_bind(), drops + DOWNGRADE)
