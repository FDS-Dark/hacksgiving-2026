"""External community resources, requests, opportunities and feed.

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-21
"""

from alembic import context, op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

FUNCTIONS = (
    "public_resource_search",
    "public_opportunity_list",
    "assistance_request_create",
    "assistance_request_list_mine",
    "community_post_list",
    "community_post_create",
)


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    drops = "\n".join(f"DROP FUNCTION app.{name};" for name in FUNCTIONS)
    op.execute(drops)
    op.execute("DROP TABLE app.community_posts")
    op.execute("DROP TABLE app.assistance_requests")
    op.execute("DROP TABLE app.opportunities")
    op.execute("ALTER TABLE app.resources DROP COLUMN longitude, DROP COLUMN latitude, DROP COLUMN address_label, DROP COLUMN website_url")
