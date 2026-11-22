"""Case attachments (app.case_attachments, files in the private object
store) and knowledge search (app.knowledge_search, full-text over the
resource directory, resolved cases, their notes and attachment notes). The
SQL is in 0025_attachments_and_knowledge.sql.

Never edit this file once it has been applied; change a function in a new
revision.

Revision ID: 0025
Revises: 0024
Create Date: 2026-11-21
"""

from alembic import context, op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None

# Every function 0025_attachments_and_knowledge.sql creates. test_migrations.py
# checks the union of every revision's list against the database.
FUNCTIONS = (
    "attachment_create",
    "attachment_get",
    "attachment_list",
    "attachment_mark_ready",
    "attachment_delete",
    "knowledge_search",
)


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    drops = "\n".join(f"DROP FUNCTION app.{name};" for name in FUNCTIONS)
    context.config.attributes["execute_script"](
        op.get_bind(), drops + "\nDROP VIEW app.case_attachment_view;\nDROP TABLE app.case_attachments;"
    )
