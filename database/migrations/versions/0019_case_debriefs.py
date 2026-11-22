"""Debriefs for an existing case: a record can name its case when it's
captured (app.record_set_case), so confirming it updates that case. The SQL
is in 0019_case_debriefs.sql.

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

# Every function 0019_case_debriefs.sql creates. test_migrations.py checks the
# union of every revision's list against the database.
FUNCTIONS = ("record_set_case",)


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    drops = "\n".join(f"DROP FUNCTION app.{name};" for name in FUNCTIONS)
    context.config.attributes["execute_script"](op.get_bind(), drops)
