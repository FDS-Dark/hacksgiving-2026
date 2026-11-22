-- =============================================================================
-- Shift handoff briefs (see 0020_shift_handoffs.py).
--
-- When someone switches off call, the API snapshots what they're leaving
-- (their open cases, open tasks, urgent alerts they accepted) into a brief
-- addressed to whoever is on call next. The brief is a JSON snapshot taken
-- at that moment, so it reads the same later even as the cases move on; the
-- links in it open the live cases. `summary` is a short plain-text read of
-- it, written by rules at once and optionally rewritten by the AI.
--
-- Staff only (the API checks); nothing in a brief is shown to residents.
-- =============================================================================

CREATE TABLE app.shift_handoffs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id       UUID NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
    -- Whoever was on call (or next) when the author went off; NULL when nobody was.
    recipient_id    UUID REFERENCES app.users (id) ON DELETE SET NULL,
    brief           JSONB NOT NULL,
    summary         TEXT NOT NULL DEFAULT '' CONSTRAINT shift_handoffs_summary_check CHECK (length(summary) <= 4000),
    summary_source  TEXT NOT NULL DEFAULT 'rules'
                    CONSTRAINT shift_handoffs_summary_source_check CHECK (summary_source IN ('rules', 'ai')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX shift_handoffs_recipient_idx ON app.shift_handoffs (recipient_id, created_at DESC);
CREATE INDEX shift_handoffs_author_idx ON app.shift_handoffs (author_id, created_at DESC);

CREATE VIEW app.shift_handoff_view AS
SELECT h.id, h.author_id, a.display_name AS author_name, h.recipient_id, r.display_name AS recipient_name,
       h.brief, h.summary, h.summary_source, h.created_at
FROM app.shift_handoffs h
JOIN app.users a ON a.id = h.author_id
LEFT JOIN app.users r ON r.id = h.recipient_id;

CREATE FUNCTION app.shift_handoff_create(p_author_id UUID, p_recipient_id UUID, p_brief TEXT, p_summary TEXT)
RETURNS SETOF app.shift_handoff_view
LANGUAGE sql AS $$
    -- Built from RETURNING: the view can't see rows this statement writes.
    WITH created AS (
        INSERT INTO app.shift_handoffs (author_id, recipient_id, brief, summary)
        VALUES (p_author_id, p_recipient_id, CAST(p_brief AS JSONB), left(p_summary, 4000))
        RETURNING *
    )
    SELECT c.id, c.author_id, a.display_name, c.recipient_id, r.display_name, c.brief, c.summary,
           c.summary_source, c.created_at
    FROM created c
    JOIN app.users a ON a.id = c.author_id
    LEFT JOIN app.users r ON r.id = c.recipient_id
$$;

CREATE FUNCTION app.shift_handoff_get(p_handoff_id UUID)
RETURNS SETOF app.shift_handoff_view
LANGUAGE sql STABLE AS $$
    SELECT v.* FROM app.shift_handoff_view v WHERE v.id = p_handoff_id
$$;

-- The briefs a person wrote or was handed, newest first, from the last
-- p_days days.
CREATE FUNCTION app.shift_handoff_list(p_user_id UUID, p_days INT, p_limit INT)
RETURNS SETOF app.shift_handoff_view
LANGUAGE sql STABLE AS $$
    SELECT v.* FROM app.shift_handoff_view v
    WHERE (v.author_id = p_user_id OR v.recipient_id = p_user_id)
      AND v.created_at > now() - make_interval(days => p_days)
    ORDER BY v.created_at DESC
    LIMIT p_limit
$$;

CREATE FUNCTION app.shift_handoff_set_summary(p_handoff_id UUID, p_summary TEXT, p_source TEXT)
RETURNS SETOF app.shift_handoff_view
LANGUAGE sql AS $$
    WITH changed AS (
        UPDATE app.shift_handoffs h SET summary = left(p_summary, 4000), summary_source = p_source
        WHERE h.id = p_handoff_id
        RETURNING h.*
    )
    SELECT c.id, c.author_id, a.display_name, c.recipient_id, r.display_name, c.brief, c.summary,
           c.summary_source, c.created_at
    FROM changed c
    JOIN app.users a ON a.id = c.author_id
    LEFT JOIN app.users r ON r.id = c.recipient_id
$$;
