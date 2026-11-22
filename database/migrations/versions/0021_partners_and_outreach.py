"""Partners (app.partners), consented case sharing (app.case_shares), texts
to requesters (app.case_texts) and need versus coverage by census tract
(insights_coverage). The SQL is in 0021_partners_and_outreach.sql.

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

# Every function 0021_partners_and_outreach.sql creates (none is
# overloaded). test_migrations.py checks the union of every revision's list
# against the database.
FUNCTIONS = (
    "partner_list",
    "partner_get",
    "partner_create",
    "partner_update",
    "case_share_create",
    "case_share_list",
    "case_share_revoke",
    "case_text_pending",
    "case_text_record",
    "case_text_list",
    "insights_coverage",
)

DOWNGRADE = """
DROP VIEW app.case_share_view;
DROP TABLE app.case_texts;
DROP TABLE app.case_shares;
DROP TABLE app.partners;
"""


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    drops = "\n".join(f"DROP FUNCTION app.{name};" for name in FUNCTIONS)
    context.config.attributes["execute_script"](op.get_bind(), drops + DOWNGRADE)
