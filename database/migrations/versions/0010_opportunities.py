"""Volunteer and job opportunities: staff post them, residents search them.
The SQL is in 0010_opportunities.sql.

Never edit this file once it has been applied; change a function in a new
revision.

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-21
"""

from alembic import context, op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None

# Every function 0010_opportunities.sql creates (none is overloaded).
# test_migrations.py checks the union of every revision's list against the
# database.
FUNCTIONS = (
    "opportunity_list",
    "opportunity_get",
    "opportunity_create",
    "opportunity_set_active",
)


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    drops = "\n".join(f"DROP FUNCTION app.{name};" for name in FUNCTIONS)
    context.config.attributes["execute_script"](op.get_bind(), drops + "\nDROP TABLE app.opportunities;")
