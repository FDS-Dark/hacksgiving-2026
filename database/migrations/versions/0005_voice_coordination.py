"""Privacy-first voice calls, verified resources, referrals and outcomes.

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-21
"""

from alembic import context, op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

FUNCTIONS = (
    "resource_list",
    "voice_call_ingest",
    "voice_call_begin",
    "voice_call_get_by_conversation",
    "voice_call_event_append",
    "referral_create",
    "referral_outcome_record",
    "voice_impact_summary",
    "voice_impact_categories",
    "voice_active_referrals",
)


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    drops = "\n".join(f"DROP FUNCTION app.{name};" for name in FUNCTIONS)
    op.execute(drops)
    op.execute("DROP TABLE app.referral_outcomes")
    op.execute("DROP TABLE app.referrals")
    op.execute("DROP TABLE app.voice_call_events")
    op.execute("DROP TABLE app.voice_calls")
    op.execute("DROP TABLE app.resources")
