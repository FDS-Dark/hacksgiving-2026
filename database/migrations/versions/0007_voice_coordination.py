"""Privacy-first voice calls, verified resources, referrals and outcomes.

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-21
"""

from alembic import context, op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None

FUNCTIONS = (
    "voice_resource_list",
    "voice_call_ingest",
    "voice_call_begin",
    "voice_call_get_by_conversation",
    "voice_call_event_append",
    "voice_referral_create",
    "voice_referral_outcome_record",
    "voice_handoff_create",
    "voice_handoff_claim",
    "voice_follow_up_list",
    "voice_impact_summary",
    "voice_impact_categories",
    "voice_active_referrals",
)


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    op.execute("\n".join(f"DROP FUNCTION app.{name};" for name in FUNCTIONS))
    op.execute("DROP TABLE app.voice_referral_outcomes")
    op.execute("DROP TABLE app.voice_referrals")
    op.execute("DROP TABLE app.voice_account_phones")
    op.execute("DROP TABLE app.voice_handoffs")
    op.execute("DROP TABLE app.voice_call_events")
    op.execute("DROP TABLE app.voice_calls")
    op.execute("DROP TABLE app.voice_resources")
