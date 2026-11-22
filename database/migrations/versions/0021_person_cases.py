"""The person behind a case: app.person_cases finds a resident's other
cases by account, phone or email. The SQL is in 0021_person_cases.sql.

Never edit this file once it has been applied; change a function in a new
revision.

Revision ID: 0021
Revises: 0020
Create Date: 2026-11-21
"""

from alembic import context, op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None

# Every function 0021_person_cases.sql creates. test_migrations.py checks the
# union of every revision's list against the database.
FUNCTIONS = ("phone_key", "person_cases")


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    # person_cases uses phone_key, so it goes first.
    context.config.attributes["execute_script"](
        op.get_bind(), "DROP FUNCTION app.person_cases;\nDROP FUNCTION app.phone_key;"
    )
