"""The in-app inbox: app.notifications (one row per person per event) and
app.notification_preferences. The SQL is in 0016_notifications.sql.

Never edit this file once it has been applied; change a function in a new
revision.

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-21
"""

from alembic import context, op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None

# Every function 0016_notifications.sql creates (none is overloaded).
# test_migrations.py checks the union of every revision's list against the
# database.
FUNCTIONS = (
    "case_list_updates_this_transaction",
    "notification_create",
    "notification_list",
    "notification_get",
    "notification_unread_count",
    "notification_read",
    "notification_read_all",
    "notification_preferences_get",
    "notification_preferences_save",
    "notification_prune",
)

DOWNGRADE = """
DROP VIEW app.notification_view;
DROP TABLE app.notification_preferences;
DROP TABLE app.notifications;
"""


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    drops = "\n".join(f"DROP FUNCTION app.{name};" for name in FUNCTIONS)
    context.config.attributes["execute_script"](op.get_bind(), drops + DOWNGRADE)
