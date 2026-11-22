"""Team chat (app.chat_messages, app.chat_reads), requests for help sent to
partners (app.partner_requests), who delivered a referral's help (new
app.case_referrals columns) and each worker's export of their own records.
The SQL is in 0031_team_chat_and_delivery.sql; the downgrade in
0031_team_chat_and_delivery.downgrade.sql.

Never edit this file once it has been applied; change a function in a new
revision.

Revision ID: 0031
Revises: 0030
Create Date: 2026-11-22
"""

from pathlib import Path

from alembic import context, op

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None

# Every function 0031_team_chat_and_delivery.sql creates (none is
# overloaded). referral_update is replaced (it gains the delivered-by
# parameters) and notification_view gains chat_channel: the downgrade puts
# 0005's referral functions and 0019's view back. test_migrations.py checks
# the union of every revision's list against the database.
FUNCTIONS = (
    "chat_members",
    "chat_channel_list",
    "chat_message_list",
    "chat_message_create",
    "chat_read",
    "chat_notify",
    "chat_notification_channel",
    "partner_request_create",
    "partner_request_list",
    "partner_request_pending",
    "partner_request_mark",
    "insights_delivered_by",
    "export_debriefs",
    "export_cases",
    "export_tasks",
    "export_outcomes",
)


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    drops = "\n".join(f"DROP FUNCTION app.{name};" for name in FUNCTIONS)
    rest = Path(__file__).with_name("0031_team_chat_and_delivery.downgrade.sql").read_text(encoding="utf-8")
    context.config.attributes["execute_script"](op.get_bind(), drops + "\n" + rest)
