"""Referral outcomes per resource (app.resource_outcome_stats), so resource
suggestions rank by what has actually helped. The SQL is in
0026_referral_outcomes.sql.

Never edit this file once it has been applied; change a function in a new
revision.

Revision ID: 0026
Revises: 0025
Create Date: 2026-11-21
"""

from alembic import context, op

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None

# Every function 0026_referral_outcomes.sql creates. test_migrations.py checks
# the union of every revision's list against the database.
FUNCTIONS = ("resource_outcome_stats",)


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    drops = "\n".join(f"DROP FUNCTION app.{name};" for name in FUNCTIONS)
    context.config.attributes["execute_script"](op.get_bind(), drops)
