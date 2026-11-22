-- =============================================================================
-- The language a resident writes in, per case (see 0025_case_language.py).
--
-- Staff reply in it: the AI draft is written in it (with an English version
-- for the worker) and a reply typed in English can be translated into it.
-- Set by a worker, or detected by the AI from the resident's own messages
-- when nobody has set it. Kept in its own table so app.case_view (and every
-- function returning it) is untouched.
-- =============================================================================

CREATE TABLE app.case_languages (
    case_id     UUID PRIMARY KEY REFERENCES app.cases (id) ON DELETE CASCADE,
    -- An ISO 639 code the API knows ('es', 'hmn', 'so'); the API checks the list.
    language    TEXT NOT NULL CONSTRAINT case_languages_language_check CHECK (language ~ '^[a-z]{2,3}$'),
    source      TEXT NOT NULL CONSTRAINT case_languages_source_check CHECK (source IN ('staff', 'detected')),
    set_by      UUID REFERENCES app.users (id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE FUNCTION app.case_language_get(p_case_id UUID)
RETURNS SETOF app.case_languages
LANGUAGE sql STABLE AS $$
    SELECT l.* FROM app.case_languages l WHERE l.case_id = p_case_id
$$;

-- Sets the case's language (NULL clears it). A detected language never
-- replaces one a worker chose. No row: cleared, or a detection that lost.
CREATE FUNCTION app.case_language_set(p_case_id UUID, p_language TEXT, p_source TEXT, p_actor_id UUID)
RETURNS SETOF app.case_languages
LANGUAGE sql AS $$
    WITH cleared AS (
        DELETE FROM app.case_languages l WHERE l.case_id = p_case_id AND p_language IS NULL
    )
    INSERT INTO app.case_languages AS l (case_id, language, source, set_by)
    SELECT p_case_id, p_language, p_source, p_actor_id
    WHERE p_language IS NOT NULL
    ON CONFLICT (case_id) DO UPDATE
        SET language = EXCLUDED.language, source = EXCLUDED.source, set_by = EXCLUDED.set_by, updated_at = now()
        WHERE EXCLUDED.source = 'staff' OR l.source = 'detected'
    RETURNING l.*
$$;
