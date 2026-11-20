"""The API's stored functions (ADR 0007): each databridge method calls one
function in the `app` schema by name, and the API itself contains no SQL.
The functions are in 0003_api_functions.sql, grouped by domain.

Changing what a function does is a new revision that replaces it
(`CREATE OR REPLACE FUNCTION`, or drop and create when its signature
changes). Never edit this file once it has been applied.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-19
"""

from alembic import context, op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

# Every function 0003_api_functions.sql creates. None is overloaded, so the
# name alone identifies it. test_migrations.py checks this list against the
# database, so a function added to the .sql file can't be left out here.
FUNCTIONS = (
    "user_get_by_sub",
    "user_provision",
    "user_update",
)


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    drops = "\n".join(f"DROP FUNCTION app.{name};" for name in FUNCTIONS)
    context.config.attributes["execute_script"](op.get_bind(), drops)
