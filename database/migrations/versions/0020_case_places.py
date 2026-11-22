"""Case places and Insights patterns: app.case_places (where each case is,
worked out by the worker from its coordinates or free-text location) and
the insights_* functions behind the staff Insights filters and "Pattern
spotted". The SQL is in 0020_case_places.sql.

Never edit this file once it has been applied; change a function in a new
revision.

Revision ID: 0020
Revises: 0019
Create Date: 2026-11-21
"""

from alembic import context, op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None

# Every function 0020_case_places.sql creates (none is overloaded).
# test_migrations.py checks the union of every revision's list against the
# database.
FUNCTIONS = (
    "case_place_pending",
    "case_place_save",
    "insights_districts",
    "insights_totals",
    "insights_by_category",
    "insights_patterns",
)

DOWNGRADE = """
DROP TABLE app.case_places;
"""


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    drops = "\n".join(f"DROP FUNCTION app.{name};" for name in FUNCTIONS)
    context.config.attributes["execute_script"](op.get_bind(), drops + DOWNGRADE)
