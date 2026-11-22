"""Named directory resources usable by the phone referral flow.

Revision ID: 0030
Revises: 0029
Create Date: 2026-11-22
"""

from alembic import context, op

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None

FUNCTIONS = ("voice_directory_resource_list",)


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    context.config.attributes["execute_script"](
        op.get_bind(), "DROP FUNCTION app.voice_directory_resource_list;"
    )
