-- 0019: the resident lane.
--   * Open bed counts on a resource (Figma R3 "12 beds"): staff enter them,
--     residents see them on Nearby while they are fresh.

-- =============================================================================
-- BED COUNTS
-- =============================================================================

ALTER TABLE app.resources
    ADD COLUMN beds_available  INTEGER CHECK (beds_available BETWEEN 0 AND 10000),
    ADD COLUMN beds_updated_at TIMESTAMPTZ,
    ADD COLUMN beds_updated_by UUID REFERENCES app.users (id) ON DELETE SET NULL,
    ADD CONSTRAINT resources_beds_dated CHECK ((beds_available IS NULL) = (beds_updated_at IS NULL));

-- p_beds NULL clears the count ("we don't know").
CREATE FUNCTION app.resource_beds_set(p_resource_id UUID, p_beds INTEGER, p_updated_by UUID)
RETURNS SETOF app.resources
LANGUAGE sql AS $$
    UPDATE app.resources AS r
    SET beds_available = p_beds,
        beds_updated_at = CASE WHEN p_beds IS NULL THEN NULL ELSE now() END,
        beds_updated_by = p_updated_by
    WHERE r.id = p_resource_id
    RETURNING r.*
$$;
