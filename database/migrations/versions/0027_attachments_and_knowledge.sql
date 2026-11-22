-- =============================================================================
-- Case attachments and knowledge search (see 0027_attachments_and_knowledge.py).
--
-- Attachments: a photo or PDF on a case (an ID card, an eviction notice, a
-- shelter letter). The file goes straight from the phone to the private
-- object store (the bucket voice debriefs use, under attachments/) with a
-- one-time signed URL; this table holds what it is. `pending` until the API
-- has seen the upload arrive, then `ready`.
--
-- Knowledge search: plain Postgres full-text search, no AI needed, over what
-- the team already knows: the resource directory, resolved and closed cases,
-- the internal notes on them, and attachment notes. Staff only (the API).
-- =============================================================================

CREATE TABLE app.case_attachments (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id       UUID NOT NULL REFERENCES app.cases (id) ON DELETE CASCADE,
    uploaded_by   UUID REFERENCES app.users (id) ON DELETE SET NULL,
    file_name     TEXT NOT NULL CONSTRAINT case_attachments_file_name_check CHECK (length(file_name) BETWEEN 1 AND 200),
    content_type  TEXT NOT NULL,
    size_bytes    INT NOT NULL CONSTRAINT case_attachments_size_check CHECK (size_bytes > 0),
    note          TEXT NOT NULL DEFAULT '' CONSTRAINT case_attachments_note_check CHECK (length(note) <= 1000),
    status        TEXT NOT NULL DEFAULT 'pending' CONSTRAINT case_attachments_status_check CHECK (status IN ('pending', 'ready')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX case_attachments_case_idx ON app.case_attachments (case_id, created_at DESC);

CREATE VIEW app.case_attachment_view AS
SELECT a.id, a.case_id, a.uploaded_by, u.display_name AS uploaded_by_name, a.file_name, a.content_type,
       a.size_bytes, a.note, a.status, a.created_at
FROM app.case_attachments a
LEFT JOIN app.users u ON u.id = a.uploaded_by;

CREATE FUNCTION app.attachment_create(
    p_case_id UUID, p_uploaded_by UUID, p_file_name TEXT, p_content_type TEXT, p_size_bytes INT, p_note TEXT)
RETURNS SETOF app.case_attachment_view
LANGUAGE sql AS $$
    -- Built from RETURNING: the view can't see rows this statement writes.
    WITH created AS (
        INSERT INTO app.case_attachments (case_id, uploaded_by, file_name, content_type, size_bytes, note)
        SELECT p_case_id, p_uploaded_by, p_file_name, p_content_type, p_size_bytes, coalesce(p_note, '')
        WHERE EXISTS (SELECT 1 FROM app.cases c WHERE c.id = p_case_id)
        RETURNING *
    )
    SELECT c.id, c.case_id, c.uploaded_by, u.display_name, c.file_name, c.content_type, c.size_bytes, c.note,
           c.status, c.created_at
    FROM created c LEFT JOIN app.users u ON u.id = c.uploaded_by
$$;

CREATE FUNCTION app.attachment_get(p_attachment_id UUID)
RETURNS SETOF app.case_attachment_view
LANGUAGE sql STABLE AS $$
    SELECT v.* FROM app.case_attachment_view v WHERE v.id = p_attachment_id
$$;

-- A case's attachments, newest first; pending uploads are left out.
CREATE FUNCTION app.attachment_list(p_case_id UUID)
RETURNS SETOF app.case_attachment_view
LANGUAGE sql STABLE AS $$
    SELECT v.* FROM app.case_attachment_view v
    WHERE v.case_id = p_case_id AND v.status = 'ready'
    ORDER BY v.created_at DESC
$$;

-- The upload arrived (the API checked the object store). No row: not pending.
CREATE FUNCTION app.attachment_mark_ready(p_attachment_id UUID, p_size_bytes INT)
RETURNS SETOF app.case_attachment_view
LANGUAGE sql AS $$
    WITH changed AS (
        UPDATE app.case_attachments a SET status = 'ready', size_bytes = p_size_bytes
        WHERE a.id = p_attachment_id AND a.status = 'pending'
        RETURNING a.*
    )
    SELECT c.id, c.case_id, c.uploaded_by, u.display_name, c.file_name, c.content_type, c.size_bytes, c.note,
           c.status, c.created_at
    FROM changed c LEFT JOIN app.users u ON u.id = c.uploaded_by
$$;

CREATE FUNCTION app.attachment_delete(p_attachment_id UUID)
RETURNS SETOF app.case_attachments
LANGUAGE sql AS $$
    DELETE FROM app.case_attachments a WHERE a.id = p_attachment_id RETURNING a.*
$$;

-- What the team knows about p_query, best matches first. `kind`: resource,
-- case (resolved or closed), note (an internal note on one of those), or
-- attachment (its note). `case_id` is set for the last three.
CREATE FUNCTION app.knowledge_search(p_query TEXT, p_limit INT)
RETURNS TABLE (kind TEXT, id UUID, case_id UUID, title TEXT, snippet TEXT, rank REAL, at TIMESTAMPTZ)
LANGUAGE sql STABLE AS $$
    WITH q AS (SELECT websearch_to_tsquery('english', p_query) AS tsq),
    hits AS (
        SELECT 'resource'::TEXT AS kind, r.id, NULL::UUID AS case_id, r.name AS title,
               ts_headline('english', coalesce(nullif(r.description, ''), r.name), q.tsq,
                           'MaxWords=24, MinWords=8, StartSel=«, StopSel=»') AS snippet,
               ts_rank(to_tsvector('english', r.name || ' ' || r.description || ' ' || coalesce(r.neighborhood, '')
                                   || ' ' || coalesce(r.hours, '')), q.tsq) AS rank,
               r.updated_at AS at
        FROM app.resources r, q
        WHERE r.active
          AND to_tsvector('english', r.name || ' ' || r.description || ' ' || coalesce(r.neighborhood, '')
                          || ' ' || coalesce(r.hours, '')) @@ q.tsq
        UNION ALL
        SELECT 'case', c.id, c.id, '#' || c.number || ' ' || c.title,
               ts_headline('english', coalesce(nullif(c.description, ''), c.title), q.tsq,
                           'MaxWords=24, MinWords=8, StartSel=«, StopSel=»'),
               ts_rank(to_tsvector('english', c.title || ' ' || c.description), q.tsq),
               coalesce(c.resolved_at, c.updated_at)
        FROM app.cases c, q
        WHERE c.status IN ('resolved', 'closed') AND to_tsvector('english', c.title || ' ' || c.description) @@ q.tsq
        UNION ALL
        SELECT 'note', u.id, c.id, '#' || c.number || ' ' || c.title,
               ts_headline('english', u.content, q.tsq, 'MaxWords=24, MinWords=8, StartSel=«, StopSel=»'),
               ts_rank(to_tsvector('english', u.content), q.tsq),
               u.created_at
        FROM app.case_updates u JOIN app.cases c ON c.id = u.case_id, q
        WHERE u.update_type = 'note' AND c.status IN ('resolved', 'closed')
          AND to_tsvector('english', u.content) @@ q.tsq
        UNION ALL
        SELECT 'attachment', a.id, a.case_id, a.file_name,
               ts_headline('english', coalesce(nullif(a.note, ''), a.file_name), q.tsq,
                           'MaxWords=24, MinWords=8, StartSel=«, StopSel=»'),
               ts_rank(to_tsvector('english', a.file_name || ' ' || a.note), q.tsq),
               a.created_at
        FROM app.case_attachments a, q
        WHERE a.status = 'ready' AND to_tsvector('english', a.file_name || ' ' || a.note) @@ q.tsq
    )
    SELECT h.kind, h.id, h.case_id, h.title, h.snippet, h.rank, h.at FROM hits h
    ORDER BY h.rank DESC, h.at DESC
    LIMIT p_limit
$$;
