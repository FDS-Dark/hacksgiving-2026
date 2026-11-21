-- =============================================================================
-- Workers add tasks to a case, and resources get coordinates (see
-- 0009_case_tasks_resource_coordinates.py).
--
--   * task_add: a task a worker adds by hand. It reuses task_create for the
--     insert and, like task_update, writes the change to the case's
--     (internal) history. task_create itself stays silent: the API calls it
--     for the tasks it plans when a case comes in.
--   * app.resources.latitude/longitude, so the app can put resources on a
--     map. resource_list and resource_get return SETOF app.resources (r.*),
--     so they return the new columns as they are; resource_create takes two
--     new parameters, so it is dropped and created again. They come last and
--     default to NULL, so an API that doesn't send them yet (one still
--     running while this migrates) keeps working.
--
-- Same conventions as 0003 and 0005: app.<domain>_<verb>, p_ parameters, no
-- row means not found, SECURITY INVOKER.
-- =============================================================================

-- =============================================================================
-- RESOURCES: coordinates
-- =============================================================================

ALTER TABLE app.resources
    ADD COLUMN latitude  DOUBLE PRECISION CONSTRAINT resources_latitude_check CHECK (latitude BETWEEN -90 AND 90),
    ADD COLUMN longitude DOUBLE PRECISION CONSTRAINT resources_longitude_check CHECK (longitude BETWEEN -180 AND 180);

DROP FUNCTION app.resource_create(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID);

CREATE FUNCTION app.resource_create(
    p_name TEXT, p_category TEXT, p_description TEXT, p_address TEXT, p_neighborhood TEXT,
    p_phone TEXT, p_website TEXT, p_hours TEXT, p_created_by UUID,
    p_latitude DOUBLE PRECISION DEFAULT NULL, p_longitude DOUBLE PRECISION DEFAULT NULL)
RETURNS SETOF app.resources
LANGUAGE sql AS $$
    INSERT INTO app.resources AS r (name, category, description, address, neighborhood, phone, website,
                                    hours, latitude, longitude, created_by)
    VALUES (p_name, p_category, p_description, p_address, p_neighborhood, p_phone, p_website, p_hours,
            p_latitude, p_longitude, p_created_by)
    RETURNING r.*
$$;

-- The sample resources from 0006, placed in their neighborhoods. Approximate,
-- like the rows themselves; the citywide ones (hotlines, dispatch, rides) get
-- a plausible office near downtown.
UPDATE app.resources AS r
SET latitude = v.latitude, longitude = v.longitude
FROM (VALUES
    ('Northside Community Pantry (Sample)',     43.0752, -87.9105),  -- Harambee
    ('Southside Hot Meals (Sample)',            43.0172, -87.9398),  -- Clarke Square
    ('Emergency Family Shelter (Sample)',       43.0598, -87.9330),  -- Lindsay Heights
    ('Housing Navigation Desk (Sample)',        43.0389, -87.9065),  -- Downtown
    ('Ride to Care Program (Sample)',           43.0336, -87.9228),  -- Citywide (Menomonee Valley)
    ('Bus Pass Assistance (Sample)',            43.0645, -87.9505),  -- Midtown
    ('Peace Keepers Outreach (Sample)',         43.0795, -87.9630),  -- Sherman Park
    ('Family Safety Hotline (Sample)',          43.0412, -87.9108),  -- Citywide (downtown)
    ('Crisis De-escalation Team (Sample)',      43.0448, -87.9196),  -- Citywide (near downtown)
    ('Missing Persons Family Support (Sample)', 43.0371, -87.9147),  -- Citywide (downtown)
    ('Funeral Cost Assistance Fund (Sample)',   43.0302, -87.9112),  -- Citywide (Walker's Point)
    ('Second Chance Jobs Center (Sample)',      43.0478, -87.9662),  -- Washington Park
    ('Youth Job Training Program (Sample)',     43.0712, -87.8992),  -- Riverwest
    ('Neighborhood Resource Hub (Sample)',      43.0718, -87.9062)   -- Harambee
) AS v (name, latitude, longitude)
WHERE r.is_sample AND r.name = v.name;

-- =============================================================================
-- TASK FUNCTIONS (workers)
-- =============================================================================

-- A task a worker adds to a case: task_create's insert, plus a note in the
-- case's history by p_actor_id. No row when the case doesn't exist.
CREATE FUNCTION app.task_add(
    p_case_id UUID, p_title TEXT, p_due_at TIMESTAMPTZ, p_assigned_worker_id UUID, p_actor_id UUID)
RETURNS SETOF app.task_view
LANGUAGE plpgsql AS $$
DECLARE
    v_task app.task_view;
BEGIN
    SELECT * INTO v_task
    FROM app.task_create(p_case_id => p_case_id, p_title => p_title, p_detail => '', p_due_at => p_due_at,
                         p_assigned_worker_id => p_assigned_worker_id, p_created_by => p_actor_id);
    IF NOT FOUND THEN
        RETURN;
    END IF;

    UPDATE app.cases AS c SET updated_at = now() WHERE c.id = p_case_id;
    INSERT INTO app.case_updates (case_id, author_id, update_type, content)
    VALUES (p_case_id, p_actor_id, 'note', 'Task added: ' || v_task.title);

    RETURN NEXT v_task;
END
$$;
