-- =============================================================================
-- Recently worked (see 0033_recently_worked.py).
--
-- "When did I last work on this case?" is the newest history entry the
-- worker wrote on it (case_updates covers notes, messages, status and
-- assignment changes, referrals and finished tasks) or the moment they
-- opened it. Newest first, so an interrupted worker finds the case again.
-- =============================================================================

CREATE INDEX case_updates_author_idx ON app.case_updates (author_id, created_at DESC);

CREATE FUNCTION app.case_recently_worked(p_worker_id UUID, p_limit INT)
RETURNS TABLE (
    id UUID, number BIGINT, kind TEXT, title TEXT, description TEXT, category TEXT, priority TEXT,
    status TEXT, source TEXT, location TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION,
    contact_name TEXT, contact_phone TEXT, contact_email TEXT, requester_id UUID,
    assigned_worker_id UUID, assigned_worker_name TEXT, created_by UUID,
    created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, resolved_at TIMESTAMPTZ,
    referral_count BIGINT, last_activity_at TIMESTAMPTZ, contact_method TEXT, safe_to_contact BOOLEAN,
    worked_at TIMESTAMPTZ, worked_type TEXT
)
LANGUAGE sql STABLE AS $$
    WITH touched AS (
        SELECT u.case_id, u.created_at AS worked_at, u.update_type AS worked_type
        FROM app.case_updates u
        WHERE u.author_id = p_worker_id
        UNION ALL
        SELECT c.id, c.created_at, 'created'::TEXT
        FROM app.cases c
        WHERE c.created_by = p_worker_id
    ),
    latest AS (
        SELECT DISTINCT ON (t.case_id) t.case_id, t.worked_at, t.worked_type
        FROM touched t
        ORDER BY t.case_id, t.worked_at DESC
    )
    SELECT v.id, v.number, v.kind, v.title, v.description, v.category, v.priority, v.status, v.source,
           v.location, v.latitude, v.longitude, v.contact_name, v.contact_phone, v.contact_email,
           v.requester_id, v.assigned_worker_id, v.assigned_worker_name, v.created_by,
           v.created_at, v.updated_at, v.resolved_at, v.referral_count, v.last_activity_at,
           v.contact_method, v.safe_to_contact, l.worked_at, l.worked_type
    FROM latest l
    JOIN app.case_view v ON v.id = l.case_id
    ORDER BY l.worked_at DESC
    LIMIT p_limit
$$;
