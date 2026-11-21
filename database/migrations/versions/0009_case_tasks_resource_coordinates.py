"""Workers add tasks to a case (app.task_add), and community resources get
coordinates (latitude, longitude; the 0006 samples are placed in their
neighborhoods). The SQL is in 0009_case_tasks_resource_coordinates.sql.

Never edit this file once it has been applied; change a function in a new
revision.

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-21
"""

from alembic import context, op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None

# Every function 0009_case_tasks_resource_coordinates.sql creates (none is
# overloaded). resource_create is 0005's, replaced here; the downgrade puts
# 0005's definition back. test_migrations.py checks the union of every
# revision's list against the database.
FUNCTIONS = ("task_add",)

DOWNGRADE = """
DROP FUNCTION app.resource_create;
CREATE FUNCTION app.resource_create(
    p_name TEXT, p_category TEXT, p_description TEXT, p_address TEXT, p_neighborhood TEXT,
    p_phone TEXT, p_website TEXT, p_hours TEXT, p_created_by UUID)
RETURNS SETOF app.resources
LANGUAGE sql AS $$
    INSERT INTO app.resources AS r (name, category, description, address, neighborhood, phone, website,
                                    hours, created_by)
    VALUES (p_name, p_category, p_description, p_address, p_neighborhood, p_phone, p_website, p_hours,
            p_created_by)
    RETURNING r.*
$$;
ALTER TABLE app.resources DROP COLUMN latitude, DROP COLUMN longitude;
"""


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    drops = "\n".join(f"DROP FUNCTION app.{name};" for name in FUNCTIONS)
    context.config.attributes["execute_script"](op.get_bind(), drops + DOWNGRADE)
