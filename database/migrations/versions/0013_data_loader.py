"""The data loader: opportunities and resources imported by a nightly batch
job (api/loader) next to the ones staff enter, with source tracking,
duplicate fingerprints, an education kind, audiences and cost. The SQL is in
0013_data_loader.sql; docs/data-loader.md describes the job.

Never edit this file once it has been applied; change a function in a new
revision.

Revision ID: 0013
Revises: 0010
Create Date: 2026-11-21
"""

from alembic import context, op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None

# Every function 0013_data_loader.sql creates (none is overloaded).
# opportunity_list, opportunity_create and opportunity_set_active are 0010's,
# replaced here; the downgrade puts 0010's definitions back.
# test_migrations.py checks the union of every revision's list against the
# database.
FUNCTIONS = (
    "opportunity_sync_upsert",
    "opportunity_sync_retire",
    "resource_sync_upsert",
    "resource_sync_retire",
    # Last: the generated dedupe_key columns use them, and those columns go
    # first (BEFORE_DROPS).
    "opportunity_fingerprint",
    "resource_fingerprint",
    "loader_normalize",
)

# Imported rows go with the columns that describe them; staff postings and
# resources stay. 0010 only knew job and volunteer, so education postings go
# too.
BEFORE_DROPS = """
DELETE FROM app.opportunities WHERE source <> 'manual' OR kind = 'education';
DELETE FROM app.resources r WHERE r.source <> 'manual'
  AND NOT EXISTS (SELECT 1 FROM app.case_referrals f WHERE f.resource_id = r.id);
ALTER TABLE app.resources
    DROP CONSTRAINT resources_source_external_id_key,
    DROP COLUMN dedupe_key, DROP COLUMN last_seen_at, DROP COLUMN external_id, DROP COLUMN source;
ALTER TABLE app.opportunities
    DROP CONSTRAINT opportunities_source_external_id_key,
    DROP COLUMN dedupe_key, DROP COLUMN closed_by_staff, DROP COLUMN last_seen_at, DROP COLUMN expires_at,
    DROP COLUMN posted_at, DROP COLUMN cost, DROP COLUMN audiences, DROP COLUMN external_id, DROP COLUMN source;
ALTER TABLE app.opportunities DROP CONSTRAINT opportunities_kind_check;
ALTER TABLE app.opportunities
    ADD CONSTRAINT opportunities_kind_check CHECK (kind IN ('volunteer', 'job'));
"""

RESTORE_0010 = """
DROP FUNCTION app.opportunity_list;
CREATE FUNCTION app.opportunity_list(p_query TEXT, p_kind TEXT, p_include_closed BOOLEAN)
RETURNS SETOF app.opportunities
LANGUAGE sql STABLE AS $$
    SELECT o.* FROM app.opportunities o
    WHERE (p_include_closed OR o.active)
      AND (p_kind IS NULL OR o.kind = p_kind)
      AND (p_query IS NULL OR p_query = ''
           OR o.title ILIKE '%' || p_query || '%'
           OR o.organization ILIKE '%' || p_query || '%'
           OR o.description ILIKE '%' || p_query || '%'
           OR o.location ILIKE '%' || p_query || '%')
    ORDER BY o.active DESC, o.created_at DESC
$$;

DROP FUNCTION app.opportunity_create;
CREATE FUNCTION app.opportunity_create(
    p_kind TEXT, p_title TEXT, p_organization TEXT, p_description TEXT, p_location TEXT, p_schedule TEXT,
    p_pay TEXT, p_contact_phone TEXT, p_contact_email TEXT, p_apply_url TEXT, p_created_by UUID)
RETURNS SETOF app.opportunities
LANGUAGE sql AS $$
    INSERT INTO app.opportunities AS o (kind, title, organization, description, location, schedule, pay,
                                        contact_phone, contact_email, apply_url, created_by)
    VALUES (p_kind, p_title, p_organization, p_description, p_location, p_schedule, p_pay,
            p_contact_phone, p_contact_email, p_apply_url, p_created_by)
    RETURNING o.*
$$;

CREATE OR REPLACE FUNCTION app.opportunity_set_active(p_opportunity_id UUID, p_active BOOLEAN)
RETURNS SETOF app.opportunities
LANGUAGE sql AS $$
    UPDATE app.opportunities o SET active = p_active, updated_at = now()
    WHERE o.id = p_opportunity_id
    RETURNING o.*
$$;
"""


def upgrade() -> None:
    context.config.attributes["run_sql_file"](__file__)


def downgrade() -> None:
    # The functions' return type is the table's row, so put 0010's
    # definitions back after the columns are gone.
    drops = "\n".join(f"DROP FUNCTION app.{name};" for name in FUNCTIONS)
    context.config.attributes["execute_script"](op.get_bind(), BEFORE_DROPS + drops + RESTORE_0010)
