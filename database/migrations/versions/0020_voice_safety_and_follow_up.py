"""Voice safety plans, resumable checkpoints, referral follow-up and funnel metrics.

Revision ID: 0020
Revises: 0019
Create Date: 2026-11-21
"""

from pathlib import Path

from alembic import context, op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None

FUNCTIONS = (
    "voice_checkpoint_resume",
    "voice_contact_plan_get",
    "voice_case_contact_plan_add",
    "voice_referral_follow_up_list",
    "voice_referral_follow_up_due",
    "voice_referral_outcome_record_for_user",
    "voice_impact_funnel",
)


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    sql = (
        Path(__file__)
        .with_name("0020_voice_safety_and_follow_up.downgrade.sql")
        .read_text(encoding="utf-8")
    )
    context.config.attributes["execute_script"](op.get_bind(), sql)
