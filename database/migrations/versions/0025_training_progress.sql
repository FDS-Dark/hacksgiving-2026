-- =============================================================================
-- Worker training progress (see 0025_training_progress.py).
--
-- The course content lives in the app (apps/mobile/src/lib/training.ts); this
-- stores which modules each worker has finished, so progress survives a
-- restart and admins can see who is ready for the field. The API checks
-- module ids against the course.
-- =============================================================================

CREATE TABLE app.training_progress (
    user_id       UUID NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
    module_id     TEXT NOT NULL CONSTRAINT training_progress_module_check CHECK (module_id ~ '^[a-z0-9-]{1,60}$'),
    completed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, module_id)
);

CREATE FUNCTION app.training_progress_list(p_user_id UUID)
RETURNS SETOF app.training_progress
LANGUAGE sql STABLE AS $$
    SELECT t.* FROM app.training_progress t WHERE t.user_id = p_user_id ORDER BY t.completed_at
$$;

-- Marks a module done (keeping the first completion time) or not done.
-- Returns the person's progress afterwards.
CREATE FUNCTION app.training_progress_set(p_user_id UUID, p_module_id TEXT, p_done BOOLEAN)
RETURNS SETOF app.training_progress
LANGUAGE plpgsql AS $$
BEGIN
    IF p_done THEN
        INSERT INTO app.training_progress (user_id, module_id) VALUES (p_user_id, p_module_id)
        ON CONFLICT (user_id, module_id) DO NOTHING;
    ELSE
        DELETE FROM app.training_progress t WHERE t.user_id = p_user_id AND t.module_id = p_module_id;
    END IF;
    RETURN QUERY SELECT t.* FROM app.training_progress t WHERE t.user_id = p_user_id ORDER BY t.completed_at;
END
$$;

-- Each staff member's completed modules, for admins.
CREATE FUNCTION app.training_team()
RETURNS TABLE (user_id UUID, display_name TEXT, role TEXT, completed TEXT[])
LANGUAGE sql STABLE AS $$
    SELECT u.id, u.display_name, u.role,
           coalesce(array_agg(t.module_id ORDER BY t.completed_at) FILTER (WHERE t.module_id IS NOT NULL), '{}')
    FROM app.users u
    LEFT JOIN app.training_progress t ON t.user_id = u.id
    WHERE u.role IN ('worker', 'admin')
    GROUP BY u.id, u.display_name, u.role
    ORDER BY u.display_name
$$;
