-- =============================================================================
-- On call (see 0015_oncall_shifts.py and docs/design/on-call-and-push.md D1).
--
-- One table: shifts. Admins enter the rota (source 'schedule'); a worker's
-- "On call" switch makes or ends a shift of their own (source 'toggle'), so
-- the switch has no state of its own. rank 1 is primary, 2 is backup.
--
-- Rules kept here: a user's shifts never overlap, and only staff (role
-- worker or admin) hold shifts. Writes lock the user's app.users row first,
-- so two saves for the same person can't both pass the overlap check.
-- Broken rules come back as an `outcome` column, not an exception, so the
-- service can answer with the right error.
--
-- Same conventions as 0003 and 0005: app.<domain>_<verb>, p_ parameters, no
-- row means not found, SECURITY INVOKER (0002's default privileges grant the
-- app role the table and EXECUTE on these functions). Shifts are half-open:
-- a shift covers starts_at <= t < ends_at.
-- =============================================================================

CREATE TABLE app.oncall_shifts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    starts_at   TIMESTAMPTZ NOT NULL,
    ends_at     TIMESTAMPTZ NOT NULL,
    rank        SMALLINT NOT NULL DEFAULT 1 CONSTRAINT oncall_shifts_rank_check CHECK (rank IN (1, 2)),
    source      TEXT NOT NULL CONSTRAINT oncall_shifts_source_check CHECK (source IN ('schedule', 'toggle')),
    created_by  UUID REFERENCES app.users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT oncall_shifts_range_check CHECK (ends_at > starts_at)
);

CREATE INDEX oncall_shifts_time_idx ON app.oncall_shifts (starts_at, ends_at);
CREATE INDEX oncall_shifts_user_idx ON app.oncall_shifts (user_id, ends_at);

-- Who is on call at p_at (NULL: now), and who is next. slot 'current': the
-- shifts covering p_at, primary first. slot 'next': at most one, the first
-- shift starting within 12 hours whose holder isn't on now. Only staff count:
-- someone demoted to member drops out.
CREATE FUNCTION app.oncall_now(p_at TIMESTAMPTZ DEFAULT NULL)
RETURNS TABLE (
    slot TEXT, id UUID, user_id UUID, display_name TEXT,
    starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, rank SMALLINT, source TEXT
)
LANGUAGE sql STABLE AS $$
    WITH at AS (SELECT COALESCE(p_at, now()) AS t),
    staff_shifts AS (
        SELECT s.*, u.display_name
        FROM app.oncall_shifts s
        JOIN app.users u ON u.id = s.user_id AND u.role IN ('worker', 'admin')
    ),
    current_shifts AS (
        SELECT s.* FROM staff_shifts s, at
        WHERE s.starts_at <= at.t AND s.ends_at > at.t
    ),
    next_shift AS (
        SELECT s.* FROM staff_shifts s, at
        WHERE s.starts_at > at.t AND s.starts_at <= at.t + interval '12 hours'
          AND s.user_id NOT IN (SELECT c.user_id FROM current_shifts c)
        ORDER BY s.starts_at, s.rank
        LIMIT 1
    )
    SELECT * FROM (
        SELECT 'current'::TEXT, c.id, c.user_id, c.display_name, c.starts_at, c.ends_at, c.rank, c.source
        FROM current_shifts c
        ORDER BY c.rank, c.starts_at
    ) cur
    UNION ALL
    SELECT 'next'::TEXT, n.id, n.user_id, n.display_name, n.starts_at, n.ends_at, n.rank, n.source
    FROM next_shift n
$$;

-- Shifts overlapping [p_from, p_to), by start then rank.
CREATE FUNCTION app.oncall_shift_list(p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TABLE (
    id UUID, user_id UUID, display_name TEXT,
    starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, rank SMALLINT, source TEXT
)
LANGUAGE sql STABLE AS $$
    SELECT s.id, s.user_id, u.display_name, s.starts_at, s.ends_at, s.rank, s.source
    FROM app.oncall_shifts s
    JOIN app.users u ON u.id = s.user_id
    WHERE s.starts_at < p_to AND s.ends_at > p_from
    ORDER BY s.starts_at, s.rank, s.id
$$;

-- Create (p_id NULL) or change a shift. On a change, a NULL argument keeps
-- the stored value (p_source and p_actor_id only apply on create). Always
-- one row: outcome 'saved' with the shift, or 'not_found', 'not_a_worker',
-- 'invalid_range' (ends_at <= starts_at) or 'overlap' with nothing else.
CREATE FUNCTION app.oncall_shift_save(
    p_id UUID,
    p_user_id UUID,
    p_starts_at TIMESTAMPTZ,
    p_ends_at TIMESTAMPTZ,
    p_rank SMALLINT,
    p_source TEXT,
    p_actor_id UUID
)
RETURNS TABLE (
    outcome TEXT, id UUID, user_id UUID, display_name TEXT,
    starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, rank SMALLINT, source TEXT
)
LANGUAGE plpgsql AS $$
DECLARE
    v_old app.oncall_shifts;
    v_user UUID;
    v_starts TIMESTAMPTZ;
    v_ends TIMESTAMPTZ;
    v_rank SMALLINT;
    v_role TEXT;
    v_id UUID;
    v_prev_user UUID;
BEGIN
    IF p_id IS NOT NULL THEN
        SELECT s.user_id INTO v_prev_user FROM app.oncall_shifts s WHERE s.id = p_id;
        IF NOT FOUND THEN
            RETURN QUERY SELECT 'not_found'::TEXT, NULL::UUID, NULL::UUID, NULL::TEXT,
                NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, NULL::SMALLINT, NULL::TEXT;
            RETURN;
        END IF;
    END IF;
    v_user := COALESCE(p_user_id, v_prev_user);

    -- Lock order, the same as oncall_toggle: the holders' user rows first (in
    -- id order), then the shift. Saves and toggles for one person run one at
    -- a time and can't deadlock. NO KEY UPDATE leaves foreign-key checks on
    -- the user (new notifications, assignments) unblocked.
    PERFORM 1 FROM app.users u WHERE u.id IN (v_user, v_prev_user) ORDER BY u.id FOR NO KEY UPDATE;
    SELECT u.role INTO v_role FROM app.users u WHERE u.id = v_user;

    IF p_id IS NOT NULL THEN
        SELECT * INTO v_old FROM app.oncall_shifts s WHERE s.id = p_id FOR UPDATE;
        IF NOT FOUND THEN
            RETURN QUERY SELECT 'not_found'::TEXT, NULL::UUID, NULL::UUID, NULL::TEXT,
                NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, NULL::SMALLINT, NULL::TEXT;
            RETURN;
        END IF;
    END IF;

    v_starts := COALESCE(p_starts_at, v_old.starts_at);
    v_ends := COALESCE(p_ends_at, v_old.ends_at);
    v_rank := COALESCE(p_rank, v_old.rank, 1);

    IF v_role IS NULL OR v_role NOT IN ('worker', 'admin') THEN
        RETURN QUERY SELECT 'not_a_worker'::TEXT, NULL::UUID, NULL::UUID, NULL::TEXT,
            NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, NULL::SMALLINT, NULL::TEXT;
        RETURN;
    END IF;

    IF v_starts IS NULL OR v_ends IS NULL OR v_ends <= v_starts THEN
        RETURN QUERY SELECT 'invalid_range'::TEXT, NULL::UUID, NULL::UUID, NULL::TEXT,
            NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, NULL::SMALLINT, NULL::TEXT;
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM app.oncall_shifts s
        WHERE s.user_id = v_user AND s.id IS DISTINCT FROM p_id
          AND s.starts_at < v_ends AND s.ends_at > v_starts
    ) THEN
        RETURN QUERY SELECT 'overlap'::TEXT, NULL::UUID, NULL::UUID, NULL::TEXT,
            NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, NULL::SMALLINT, NULL::TEXT;
        RETURN;
    END IF;

    IF p_id IS NULL THEN
        INSERT INTO app.oncall_shifts AS s (user_id, starts_at, ends_at, rank, source, created_by)
        VALUES (v_user, v_starts, v_ends, v_rank, p_source, p_actor_id)
        RETURNING s.id INTO v_id;
    ELSE
        UPDATE app.oncall_shifts AS s
        SET user_id = v_user, starts_at = v_starts, ends_at = v_ends, rank = v_rank, updated_at = now()
        WHERE s.id = p_id;
        v_id := p_id;
    END IF;

    RETURN QUERY
        SELECT 'saved'::TEXT, s.id, s.user_id, u.display_name, s.starts_at, s.ends_at, s.rank, s.source
        FROM app.oncall_shifts s JOIN app.users u ON u.id = s.user_id
        WHERE s.id = v_id;
END;
$$;

-- Deletes a shift; no row means it didn't exist.
CREATE FUNCTION app.oncall_shift_delete(p_id UUID)
RETURNS TABLE (id UUID)
LANGUAGE sql AS $$
    DELETE FROM app.oncall_shifts AS s WHERE s.id = p_id RETURNING s.id
$$;

-- The "On call" switch, for p_user_id at now():
--   on, no shift of mine now: a 'toggle' shift from now to COALESCE(p_until,
--       p_default_until), cut short at the start of my next shift (so it
--       never overlaps one; I stay on through that shift anyway).
--   on, a shift of mine now: with p_until, it ends then instead (again cut
--       short at my next shift); without, nothing changes.
--   off: my shifts covering now end now (one that started this very instant
--       is removed). Nothing if I'm not on.
-- Returns my shift covering now afterwards, if any. Staff only: a non-staff
-- user gets no row and no change.
CREATE FUNCTION app.oncall_toggle(
    p_user_id UUID,
    p_on BOOLEAN,
    p_until TIMESTAMPTZ,
    p_default_until TIMESTAMPTZ
)
RETURNS TABLE (
    id UUID, user_id UUID, display_name TEXT,
    starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, rank SMALLINT, source TEXT
)
LANGUAGE plpgsql AS $$
DECLARE
    v_role TEXT;
    v_current app.oncall_shifts;
    v_next_start TIMESTAMPTZ;
    v_end TIMESTAMPTZ;
BEGIN
    SELECT u.role INTO v_role FROM app.users u WHERE u.id = p_user_id FOR NO KEY UPDATE;
    IF v_role IS NULL OR v_role NOT IN ('worker', 'admin') THEN
        RETURN;
    END IF;

    IF NOT p_on THEN
        DELETE FROM app.oncall_shifts s
        WHERE s.user_id = p_user_id AND s.starts_at = now();
        UPDATE app.oncall_shifts AS s SET ends_at = now(), updated_at = now()
        WHERE s.user_id = p_user_id AND s.starts_at < now() AND s.ends_at > now();
        RETURN;
    END IF;

    SELECT * INTO v_current FROM app.oncall_shifts s
    WHERE s.user_id = p_user_id AND s.starts_at <= now() AND s.ends_at > now()
    ORDER BY s.rank LIMIT 1;

    SELECT min(s.starts_at) INTO v_next_start FROM app.oncall_shifts s
    WHERE s.user_id = p_user_id AND s.starts_at > now();

    IF v_current.id IS NULL THEN
        v_end := LEAST(COALESCE(p_until, p_default_until), v_next_start);
        IF v_end > now() THEN
            INSERT INTO app.oncall_shifts (user_id, starts_at, ends_at, rank, source, created_by)
            VALUES (p_user_id, now(), v_end, 1, 'toggle', p_user_id);
        END IF;
    ELSIF p_until IS NOT NULL THEN
        v_end := LEAST(p_until, v_next_start);
        IF v_end > now() THEN
            UPDATE app.oncall_shifts AS s SET ends_at = v_end, updated_at = now()
            WHERE s.id = v_current.id;
        END IF;
    END IF;

    RETURN QUERY
        SELECT s.id, s.user_id, u.display_name, s.starts_at, s.ends_at, s.rank, s.source
        FROM app.oncall_shifts s JOIN app.users u ON u.id = s.user_id
        WHERE s.user_id = p_user_id AND s.starts_at <= now() AND s.ends_at > now()
        ORDER BY s.rank LIMIT 1;
END;
$$;
