"""Resident referral history and staff call review views.

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-21
"""

from alembic import context, op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None

FUNCTIONS = (
    "voice_referral_list_for_user",
    "voice_referral_get_for_user",
    "voice_call_review_list",
    "voice_call_review_get",
    "voice_referral_list_for_call",
)


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    op.execute("\n".join(f"DROP FUNCTION app.{name};" for name in FUNCTIONS))
