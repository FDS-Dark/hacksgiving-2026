"""Shift handoff briefs: what someone leaves for the next person on call
when they switch off (app.shift_handoffs). The SQL is in
0023_shift_handoffs.sql.

Never edit this file once it has been applied; change a function in a new
revision.

Revision ID: 0023
Revises: 0022
Create Date: 2026-11-21
"""

from alembic import context, op

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None

# Every function 0023_shift_handoffs.sql creates. test_migrations.py checks the
# union of every revision's list against the database.
FUNCTIONS = (
    "shift_handoff_create",
    "shift_handoff_get",
    "shift_handoff_list",
    "shift_handoff_set_summary",
)


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    drops = "\n".join(f"DROP FUNCTION app.{name};" for name in FUNCTIONS)
    context.config.attributes["execute_script"](
        op.get_bind(), drops + "\nDROP VIEW app.shift_handoff_view;\nDROP TABLE app.shift_handoffs;"
    )
