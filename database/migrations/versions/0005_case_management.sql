-- =============================================================================
-- Case management for ComForce MKE workers (see 0005_case_management.py).
--
-- A community member's request for help, or an incident a worker logs, is a
-- case. Workers triage it (priority, category, assignee, status), keep notes
-- and an activity history, and refer the person to community resources.
--
-- Two audiences, kept apart in SQL, not in the API:
--   * Workers (app.users.role 'worker' or 'admin') read everything through
--     case_*, referral_*, resource_* and stats functions.
--   * The requester reads their own requests through request_*, which return
--     only the public columns and only updates marked visibility 'public'.
--     Internal notes, contact details and assignees never leave through them.
--
-- Same conventions as 0003: app.<domain>_<verb>, p_ parameters, no row means
-- not found, SECURITY INVOKER.
-- =============================================================================

-- =============================================================================
-- STAFF
-- =============================================================================

-- member: anyone who signs in. worker: ComForce staff. admin: staff who also
-- manage who is staff.
ALTER TABLE app.users
    ADD COLUMN role TEXT NOT NULL DEFAULT 'member'
    CONSTRAINT users_role_check CHECK (role IN ('member', 'worker', 'admin'));

-- =============================================================================
-- TABLES
-- =============================================================================

-- The categories are ComForce MKE's services (api/models/routing.py Service,
-- without 'unclear'), plus 'other'.
CREATE TABLE app.cases (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- A short number people can read out on the phone: case #1001.
    number             BIGINT GENERATED ALWAYS AS IDENTITY (START WITH 1001) UNIQUE,
    kind               TEXT NOT NULL DEFAULT 'request'
                       CONSTRAINT cases_kind_check CHECK (kind IN ('request', 'incident')),
    title              TEXT NOT NULL CONSTRAINT cases_title_check CHECK (length(title) BETWEEN 1 AND 160),
    description        TEXT NOT NULL DEFAULT '',
    category           TEXT NOT NULL DEFAULT 'other'
                       CONSTRAINT cases_category_check CHECK (category IN (
                           'homelessness', 'missing_persons', 'meal_programs', 'violence_prevention',
                           'transportation', 'incident_deescalation', 'burial_assistance',
                           'bridge_to_employment', 'other')),
    priority           TEXT NOT NULL DEFAULT 'medium'
                       CONSTRAINT cases_priority_check CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    status             TEXT NOT NULL DEFAULT 'new'
                       CONSTRAINT cases_status_check CHECK (status IN (
                           'new', 'in_progress', 'awaiting_resources', 'resolved', 'closed')),
    -- public: submitted by a community member. worker: opened by staff.
    source             TEXT NOT NULL CONSTRAINT cases_source_check CHECK (source IN ('public', 'worker')),
    location           TEXT,
    latitude           DOUBLE PRECISION CONSTRAINT cases_latitude_check CHECK (latitude BETWEEN -90 AND 90),
    longitude          DOUBLE PRECISION CONSTRAINT cases_longitude_check CHECK (longitude BETWEEN -180 AND 180),
    -- How to reach the person. Workers only; never in a request_* result.
    contact_name       TEXT,
    contact_phone      TEXT,
    contact_email      TEXT,
    requester_id       UUID REFERENCES app.users (id) ON DELETE SET NULL,
    assigned_worker_id UUID REFERENCES app.users (id) ON DELETE SET NULL,
    created_by         UUID REFERENCES app.users (id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Set when the case first reaches resolved or closed; cleared on reopen.
    resolved_at        TIMESTAMPTZ
);

CREATE INDEX cases_status_idx ON app.cases (status);
CREATE INDEX cases_assigned_worker_idx ON app.cases (assigned_worker_id);
CREATE INDEX cases_requester_idx ON app.cases (requester_id);
CREATE INDEX cases_created_at_idx ON app.cases (created_at DESC);

-- The activity history. Status, priority, category and assignment changes
-- are written by case_update itself, so the history can't miss one.
CREATE TABLE app.case_updates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id     UUID NOT NULL REFERENCES app.cases (id) ON DELETE CASCADE,
    author_id   UUID REFERENCES app.users (id) ON DELETE SET NULL,
    update_type TEXT NOT NULL CONSTRAINT case_updates_type_check CHECK (update_type IN (
                    'created', 'note', 'message', 'status_change', 'priority_change',
                    'category_change', 'assignment', 'referral')),
    -- internal: workers only. public: also shown to the requester.
    visibility  TEXT NOT NULL DEFAULT 'internal'
                CONSTRAINT case_updates_visibility_check CHECK (visibility IN ('internal', 'public')),
    content     TEXT NOT NULL CONSTRAINT case_updates_content_check CHECK (length(content) BETWEEN 1 AND 4000),
    -- clock_timestamp, not now(): several entries written in one
    -- transaction keep the order they happened in.
    created_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX case_updates_case_idx ON app.case_updates (case_id, created_at);
CREATE INDEX case_updates_created_at_idx ON app.case_updates (created_at DESC);

-- Community resources workers refer people to. is_sample marks
-- demonstration rows (0006) so nobody mistakes them for real services.
CREATE TABLE app.resources (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT NOT NULL CONSTRAINT resources_name_check CHECK (length(name) BETWEEN 1 AND 160),
    category     TEXT NOT NULL
                 CONSTRAINT resources_category_check CHECK (category IN (
                     'homelessness', 'missing_persons', 'meal_programs', 'violence_prevention',
                     'transportation', 'incident_deescalation', 'burial_assistance',
                     'bridge_to_employment', 'other')),
    description  TEXT NOT NULL DEFAULT '',
    address      TEXT,
    neighborhood TEXT,
    phone        TEXT,
    website      TEXT,
    hours        TEXT,
    is_sample    BOOLEAN NOT NULL DEFAULT false,
    active       BOOLEAN NOT NULL DEFAULT true,
    created_by   UUID REFERENCES app.users (id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX resources_category_idx ON app.resources (category);

-- A resource suggested for a case, and how far that referral got.
CREATE TABLE app.case_referrals (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id     UUID NOT NULL REFERENCES app.cases (id) ON DELETE CASCADE,
    resource_id UUID NOT NULL REFERENCES app.resources (id) ON DELETE RESTRICT,
    status      TEXT NOT NULL DEFAULT 'suggested'
                CONSTRAINT case_referrals_status_check CHECK (status IN (
                    'suggested', 'shared', 'accepted', 'completed', 'declined')),
    outcome     TEXT CONSTRAINT case_referrals_outcome_check CHECK (length(outcome) <= 2000),
    created_by  UUID REFERENCES app.users (id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT case_referrals_case_resource_key UNIQUE (case_id, resource_id)
);

-- =============================================================================
-- VIEWS (row shapes the functions return)
-- =============================================================================

-- A case as workers see it.
CREATE VIEW app.case_view AS
SELECT c.id, c.number, c.kind, c.title, c.description, c.category, c.priority, c.status, c.source,
       c.location, c.latitude, c.longitude, c.contact_name, c.contact_phone, c.contact_email,
       c.requester_id, c.assigned_worker_id, w.display_name AS assigned_worker_name,
       c.created_by, c.created_at, c.updated_at, c.resolved_at,
       (SELECT count(*) FROM app.case_referrals r WHERE r.case_id = c.id) AS referral_count,
       COALESCE((SELECT max(u.created_at) FROM app.case_updates u WHERE u.case_id = c.id), c.created_at)
           AS last_activity_at
FROM app.cases c
LEFT JOIN app.users w ON w.id = c.assigned_worker_id;

CREATE VIEW app.case_update_view AS
SELECT u.id, u.case_id, c.number AS case_number, c.title AS case_title, u.author_id,
       a.display_name AS author_name, u.update_type, u.visibility, u.content, u.created_at
FROM app.case_updates u
JOIN app.cases c ON c.id = u.case_id
LEFT JOIN app.users a ON a.id = u.author_id;

CREATE VIEW app.referral_view AS
SELECT f.id, f.case_id, f.resource_id, r.name AS resource_name, r.category AS resource_category,
       r.phone AS resource_phone, r.website AS resource_website, r.is_sample AS resource_is_sample,
       f.status, f.outcome, f.created_by, f.created_at, f.updated_at
FROM app.case_referrals f
JOIN app.resources r ON r.id = f.resource_id;

-- =============================================================================
-- STAFF FUNCTIONS
-- =============================================================================

CREATE FUNCTION app.staff_get(p_user_id UUID)
RETURNS TABLE (id UUID, display_name TEXT, role TEXT)
LANGUAGE sql STABLE AS $$
    SELECT u.id, u.display_name, u.role FROM app.users u WHERE u.id = p_user_id
$$;

-- Workers and admins, with how many open cases each holds.
CREATE FUNCTION app.staff_list_workers()
RETURNS TABLE (id UUID, display_name TEXT, role TEXT, open_cases BIGINT)
LANGUAGE sql STABLE AS $$
    SELECT u.id, u.display_name, u.role,
           (SELECT count(*) FROM app.cases c
            WHERE c.assigned_worker_id = u.id AND c.status NOT IN ('resolved', 'closed'))
    FROM app.users u
    WHERE u.role IN ('worker', 'admin')
    ORDER BY u.display_name NULLS LAST, u.created_at
$$;

-- Everyone who has signed in, for admins deciding who is staff.
CREATE FUNCTION app.staff_list_users()
RETURNS TABLE (id UUID, display_name TEXT, role TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql STABLE AS $$
    SELECT u.id, u.display_name, u.role, u.created_at
    FROM app.users u
    ORDER BY (u.role = 'member'), u.display_name NULLS LAST, u.created_at
$$;

CREATE FUNCTION app.staff_set_role(p_user_id UUID, p_role TEXT)
RETURNS TABLE (id UUID, display_name TEXT, role TEXT)
LANGUAGE sql AS $$
    UPDATE app.users AS u SET role = p_role, updated_at = now()
    WHERE u.id = p_user_id
    RETURNING u.id, u.display_name, u.role
$$;

-- The first staff member: makes the caller an admin, but only while nobody
-- is staff yet. Returns no row once someone is.
CREATE FUNCTION app.staff_bootstrap(p_user_id UUID)
RETURNS TABLE (id UUID, display_name TEXT, role TEXT)
LANGUAGE plpgsql AS $$
BEGIN
    -- Two people claiming at once: the second waits, then sees the first.
    PERFORM pg_advisory_xact_lock(hashtext('app.staff_bootstrap'));
    IF EXISTS (SELECT 1 FROM app.users x WHERE x.role IN ('worker', 'admin')) THEN
        RETURN;
    END IF;
    RETURN QUERY
        UPDATE app.users AS u SET role = 'admin', updated_at = now()
        WHERE u.id = p_user_id
        RETURNING u.id, u.display_name, u.role;
END
$$;

-- =============================================================================
-- CASE FUNCTIONS (workers)
-- =============================================================================

CREATE FUNCTION app.case_create(
    p_kind TEXT, p_title TEXT, p_description TEXT, p_category TEXT, p_priority TEXT, p_source TEXT,
    p_location TEXT, p_latitude DOUBLE PRECISION, p_longitude DOUBLE PRECISION,
    p_contact_name TEXT, p_contact_phone TEXT, p_contact_email TEXT,
    p_requester_id UUID, p_assigned_worker_id UUID, p_created_by UUID)
RETURNS SETOF app.case_view
LANGUAGE plpgsql AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO app.cases AS c (kind, title, description, category, priority, status, source, location,
                                latitude, longitude, contact_name, contact_phone, contact_email,
                                requester_id, assigned_worker_id, created_by)
    VALUES (p_kind, p_title, p_description, p_category, p_priority,
            CASE WHEN p_assigned_worker_id IS NULL THEN 'new' ELSE 'in_progress' END,
            p_source, p_location, p_latitude, p_longitude, p_contact_name, p_contact_phone,
            p_contact_email, p_requester_id, p_assigned_worker_id, p_created_by)
    RETURNING c.id INTO v_id;

    INSERT INTO app.case_updates (case_id, author_id, update_type, visibility, content)
    VALUES (v_id, p_created_by, 'created', 'public',
            CASE WHEN p_source = 'public' THEN 'Request received.' ELSE 'Case opened.' END);

    IF p_assigned_worker_id IS NOT NULL THEN
        INSERT INTO app.case_updates (case_id, author_id, update_type, content)
        SELECT v_id, p_created_by, 'assignment', 'Assigned to ' || COALESCE(w.display_name, 'a worker') || '.'
        FROM app.users w WHERE w.id = p_assigned_worker_id;
    END IF;

    RETURN QUERY SELECT * FROM app.case_view v WHERE v.id = v_id;
END
$$;

-- Filters are ANDed; NULL means "any". p_open_only leaves out resolved and
-- closed cases; p_unassigned keeps only cases nobody holds. p_query matches
-- the number, title, description or location. Most urgent first, then
-- newest.
CREATE FUNCTION app.case_list(
    p_status TEXT, p_priority TEXT, p_category TEXT, p_kind TEXT, p_assigned_worker_id UUID,
    p_unassigned BOOLEAN, p_open_only BOOLEAN, p_query TEXT, p_limit INTEGER, p_offset INTEGER)
RETURNS SETOF app.case_view
LANGUAGE sql STABLE AS $$
    SELECT v.*
    FROM app.case_view v
    WHERE (p_status IS NULL OR v.status = p_status)
      AND (p_priority IS NULL OR v.priority = p_priority)
      AND (p_category IS NULL OR v.category = p_category)
      AND (p_kind IS NULL OR v.kind = p_kind)
      AND (p_assigned_worker_id IS NULL OR v.assigned_worker_id = p_assigned_worker_id)
      AND (NOT COALESCE(p_unassigned, false) OR v.assigned_worker_id IS NULL)
      AND (NOT COALESCE(p_open_only, false) OR v.status NOT IN ('resolved', 'closed'))
      AND (p_query IS NULL OR p_query = ''
           OR v.number::text = ltrim(p_query, '#')
           OR v.title ILIKE '%' || p_query || '%'
           OR v.description ILIKE '%' || p_query || '%'
           OR v.location ILIKE '%' || p_query || '%')
    ORDER BY (v.status IN ('resolved', 'closed')),
             CASE v.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
             v.created_at DESC
    LIMIT COALESCE(p_limit, 100) OFFSET COALESCE(p_offset, 0)
$$;

CREATE FUNCTION app.case_get(p_case_id UUID)
RETURNS SETOF app.case_view
LANGUAGE sql STABLE AS $$
    SELECT v.* FROM app.case_view v WHERE v.id = p_case_id
$$;

-- NULL leaves a field as it is; p_unassign clears the assignee. Each change
-- of status, priority, category or assignee is written to the history in
-- the same transaction, by p_actor_id.
CREATE FUNCTION app.case_update(
    p_case_id UUID, p_actor_id UUID, p_kind TEXT, p_title TEXT, p_description TEXT, p_category TEXT,
    p_priority TEXT, p_status TEXT, p_location TEXT, p_assigned_worker_id UUID, p_unassign BOOLEAN)
RETURNS SETOF app.case_view
LANGUAGE plpgsql AS $$
DECLARE
    v_old app.cases%ROWTYPE;
    v_new app.cases%ROWTYPE;
BEGIN
    SELECT * INTO v_old FROM app.cases c WHERE c.id = p_case_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    UPDATE app.cases AS c
    SET kind = COALESCE(p_kind, c.kind),
        title = COALESCE(p_title, c.title),
        description = COALESCE(p_description, c.description),
        category = COALESCE(p_category, c.category),
        priority = COALESCE(p_priority, c.priority),
        status = COALESCE(p_status, c.status),
        location = COALESCE(p_location, c.location),
        assigned_worker_id = CASE WHEN COALESCE(p_unassign, false) THEN NULL
                                  ELSE COALESCE(p_assigned_worker_id, c.assigned_worker_id) END,
        resolved_at = CASE
            WHEN COALESCE(p_status, c.status) IN ('resolved', 'closed') THEN COALESCE(c.resolved_at, now())
            ELSE NULL END,
        updated_at = now()
    WHERE c.id = p_case_id
    RETURNING c.* INTO v_new;

    IF v_new.status IS DISTINCT FROM v_old.status THEN
        INSERT INTO app.case_updates (case_id, author_id, update_type, visibility, content)
        VALUES (p_case_id, p_actor_id, 'status_change', 'public',
                'Status changed from ' || replace(v_old.status, '_', ' ') || ' to '
                || replace(v_new.status, '_', ' ') || '.');
    END IF;
    IF v_new.priority IS DISTINCT FROM v_old.priority THEN
        INSERT INTO app.case_updates (case_id, author_id, update_type, content)
        VALUES (p_case_id, p_actor_id, 'priority_change',
                'Priority changed from ' || v_old.priority || ' to ' || v_new.priority || '.');
    END IF;
    IF v_new.category IS DISTINCT FROM v_old.category THEN
        INSERT INTO app.case_updates (case_id, author_id, update_type, content)
        VALUES (p_case_id, p_actor_id, 'category_change',
                'Category changed from ' || replace(v_old.category, '_', ' ') || ' to '
                || replace(v_new.category, '_', ' ') || '.');
    END IF;
    IF v_new.assigned_worker_id IS DISTINCT FROM v_old.assigned_worker_id THEN
        INSERT INTO app.case_updates (case_id, author_id, update_type, content)
        SELECT p_case_id, p_actor_id, 'assignment',
               CASE WHEN v_new.assigned_worker_id IS NULL THEN 'Unassigned.'
                    ELSE 'Assigned to ' || COALESCE(
                        (SELECT w.display_name FROM app.users w WHERE w.id = v_new.assigned_worker_id),
                        'a worker') || '.' END;
    END IF;

    RETURN QUERY SELECT * FROM app.case_view v WHERE v.id = p_case_id;
END
$$;

-- A note (internal) or a message to the requester (public). No row when the
-- case doesn't exist.
CREATE FUNCTION app.case_add_update(
    p_case_id UUID, p_author_id UUID, p_update_type TEXT, p_visibility TEXT, p_content TEXT)
RETURNS SETOF app.case_update_view
LANGUAGE plpgsql AS $$
DECLARE
    v_id UUID;
BEGIN
    UPDATE app.cases AS c SET updated_at = now() WHERE c.id = p_case_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    INSERT INTO app.case_updates AS u (case_id, author_id, update_type, visibility, content)
    VALUES (p_case_id, p_author_id, p_update_type, p_visibility, p_content)
    RETURNING u.id INTO v_id;
    RETURN QUERY SELECT * FROM app.case_update_view v WHERE v.id = v_id;
END
$$;

-- The whole history of one case, oldest first.
CREATE FUNCTION app.case_list_updates(p_case_id UUID)
RETURNS SETOF app.case_update_view
LANGUAGE sql STABLE AS $$
    SELECT v.* FROM app.case_update_view v WHERE v.case_id = p_case_id ORDER BY v.created_at, v.id
$$;

-- The latest activity across all cases, newest first.
CREATE FUNCTION app.case_recent_activity(p_limit INTEGER)
RETURNS SETOF app.case_update_view
LANGUAGE sql STABLE AS $$
    SELECT v.* FROM app.case_update_view v ORDER BY v.created_at DESC, v.id LIMIT COALESCE(p_limit, 20)
$$;

-- =============================================================================
-- INSIGHTS (computed from the case tables; nothing is stored)
-- =============================================================================

-- "Active" is every status but resolved and closed.
CREATE FUNCTION app.case_stats()
RETURNS TABLE (
    total BIGINT, active BIGINT, new BIGINT, high_priority_active BIGINT, awaiting_resources BIGINT,
    unassigned_active BIGINT, resolved BIGINT, opened_last_7_days BIGINT, resolved_last_7_days BIGINT,
    avg_resolution_hours DOUBLE PRECISION)
LANGUAGE sql STABLE AS $$
    SELECT count(*),
           count(*) FILTER (WHERE c.status NOT IN ('resolved', 'closed')),
           count(*) FILTER (WHERE c.status = 'new'),
           count(*) FILTER (WHERE c.status NOT IN ('resolved', 'closed') AND c.priority IN ('high', 'critical')),
           count(*) FILTER (WHERE c.status = 'awaiting_resources'),
           count(*) FILTER (WHERE c.status NOT IN ('resolved', 'closed') AND c.assigned_worker_id IS NULL),
           count(*) FILTER (WHERE c.status IN ('resolved', 'closed')),
           count(*) FILTER (WHERE c.created_at >= now() - interval '7 days'),
           count(*) FILTER (WHERE c.resolved_at >= now() - interval '7 days'),
           (avg(extract(epoch FROM c.resolved_at - c.created_at)) FILTER (WHERE c.resolved_at IS NOT NULL)) / 3600.0
    FROM app.cases c
$$;

CREATE FUNCTION app.case_counts_by_category()
RETURNS TABLE (category TEXT, total BIGINT, active BIGINT)
LANGUAGE sql STABLE AS $$
    SELECT c.category, count(*), count(*) FILTER (WHERE c.status NOT IN ('resolved', 'closed'))
    FROM app.cases c GROUP BY c.category ORDER BY count(*) DESC, c.category
$$;

CREATE FUNCTION app.case_counts_by_status()
RETURNS TABLE (status TEXT, total BIGINT)
LANGUAGE sql STABLE AS $$
    SELECT c.status, count(*) FROM app.cases c GROUP BY c.status
$$;

-- =============================================================================
-- REQUESTS (the requester's own view: public columns and public updates only)
-- =============================================================================

CREATE FUNCTION app.request_list_for_user(p_user_id UUID)
RETURNS TABLE (id UUID, number BIGINT, title TEXT, description TEXT, category TEXT, status TEXT,
               location TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, resolved_at TIMESTAMPTZ)
LANGUAGE sql STABLE AS $$
    SELECT c.id, c.number, c.title, c.description, c.category, c.status, c.location,
           c.created_at, c.updated_at, c.resolved_at
    FROM app.cases c
    WHERE c.requester_id = p_user_id
    ORDER BY c.created_at DESC
$$;

CREATE FUNCTION app.request_get_for_user(p_user_id UUID, p_case_id UUID)
RETURNS TABLE (id UUID, number BIGINT, title TEXT, description TEXT, category TEXT, status TEXT,
               location TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, resolved_at TIMESTAMPTZ)
LANGUAGE sql STABLE AS $$
    SELECT c.id, c.number, c.title, c.description, c.category, c.status, c.location,
           c.created_at, c.updated_at, c.resolved_at
    FROM app.cases c
    WHERE c.requester_id = p_user_id AND c.id = p_case_id
$$;

-- Public updates on the caller's own request. Who wrote them stays internal.
CREATE FUNCTION app.request_list_updates_for_user(p_user_id UUID, p_case_id UUID)
RETURNS TABLE (id UUID, update_type TEXT, content TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql STABLE AS $$
    SELECT u.id, u.update_type, u.content, u.created_at
    FROM app.case_updates u
    JOIN app.cases c ON c.id = u.case_id
    WHERE c.requester_id = p_user_id AND c.id = p_case_id AND u.visibility = 'public'
    ORDER BY u.created_at, u.id
$$;

-- =============================================================================
-- RESOURCES
-- =============================================================================

CREATE FUNCTION app.resource_list(p_query TEXT, p_category TEXT)
RETURNS SETOF app.resources
LANGUAGE sql STABLE AS $$
    SELECT r.* FROM app.resources r
    WHERE r.active
      AND (p_category IS NULL OR r.category = p_category)
      AND (p_query IS NULL OR p_query = ''
           OR r.name ILIKE '%' || p_query || '%'
           OR r.description ILIKE '%' || p_query || '%'
           OR r.neighborhood ILIKE '%' || p_query || '%')
    ORDER BY r.is_sample, r.name
$$;

CREATE FUNCTION app.resource_get(p_resource_id UUID)
RETURNS SETOF app.resources
LANGUAGE sql STABLE AS $$
    SELECT r.* FROM app.resources r WHERE r.id = p_resource_id
$$;

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

-- =============================================================================
-- REFERRALS
-- =============================================================================

CREATE FUNCTION app.referral_list(p_case_id UUID)
RETURNS SETOF app.referral_view
LANGUAGE sql STABLE AS $$
    SELECT v.* FROM app.referral_view v WHERE v.case_id = p_case_id ORDER BY v.created_at
$$;

-- No row when the case or resource doesn't exist, or the resource is
-- already on the case.
CREATE FUNCTION app.referral_add(p_case_id UUID, p_resource_id UUID, p_status TEXT, p_actor_id UUID)
RETURNS SETOF app.referral_view
LANGUAGE plpgsql AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO app.case_referrals AS f (case_id, resource_id, status, created_by)
    SELECT c.id, r.id, p_status, p_actor_id
    FROM app.cases c, app.resources r
    WHERE c.id = p_case_id AND r.id = p_resource_id
    ON CONFLICT ON CONSTRAINT case_referrals_case_resource_key DO NOTHING
    RETURNING f.id INTO v_id;
    IF v_id IS NULL THEN
        RETURN;
    END IF;

    INSERT INTO app.case_updates (case_id, author_id, update_type, content)
    SELECT p_case_id, p_actor_id, 'referral', 'Referral to ' || r.name || ' ' || p_status || '.'
    FROM app.resources r WHERE r.id = p_resource_id;
    UPDATE app.cases AS c SET updated_at = now() WHERE c.id = p_case_id;

    RETURN QUERY SELECT * FROM app.referral_view v WHERE v.id = v_id;
END
$$;

-- NULL leaves a field as it is. A status change goes into the history.
CREATE FUNCTION app.referral_update(
    p_case_id UUID, p_referral_id UUID, p_status TEXT, p_outcome TEXT, p_actor_id UUID)
RETURNS SETOF app.referral_view
LANGUAGE plpgsql AS $$
DECLARE
    v_old TEXT;
    v_new TEXT;
BEGIN
    SELECT f.status INTO v_old FROM app.case_referrals f
    WHERE f.id = p_referral_id AND f.case_id = p_case_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    UPDATE app.case_referrals AS f
    SET status = COALESCE(p_status, f.status), outcome = COALESCE(p_outcome, f.outcome), updated_at = now()
    WHERE f.id = p_referral_id
    RETURNING f.status INTO v_new;

    IF v_new IS DISTINCT FROM v_old THEN
        INSERT INTO app.case_updates (case_id, author_id, update_type, content)
        SELECT p_case_id, p_actor_id, 'referral', 'Referral to ' || v.resource_name || ' marked ' || v_new || '.'
        FROM app.referral_view v WHERE v.id = p_referral_id;
    END IF;
    IF p_outcome IS NOT NULL THEN
        INSERT INTO app.case_updates (case_id, author_id, update_type, content)
        SELECT p_case_id, p_actor_id, 'referral', 'Outcome for ' || v.resource_name || ': ' || p_outcome
        FROM app.referral_view v WHERE v.id = p_referral_id;
    END IF;
    UPDATE app.cases AS c SET updated_at = now() WHERE c.id = p_case_id;

    RETURN QUERY SELECT * FROM app.referral_view v WHERE v.id = p_referral_id;
END
$$;
