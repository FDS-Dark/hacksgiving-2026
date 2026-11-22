-- The data loader's rate gate (dataloader/utils/rate_gate.py): before asking a
-- server, a source checks its earlier attempts here, so every loader that
-- shares the database agrees on when it may ask again.
--
-- * loader_runs.rate_limited marks an attempt the server refused for asking
--   too often (MPD's calls page allows 10 requests per 30 minutes per IP).
-- * loader_run_record takes it as p_rate_limited. It defaults to false, so a
--   loader that doesn't know it yet still records its runs.
-- * loader_run_gate says when a source last asked, and when it was last
--   refused. Skipped runs never asked, so they don't count.

ALTER TABLE app.loader_runs ADD COLUMN IF NOT EXISTS rate_limited BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS loader_runs_source_started_idx ON app.loader_runs (source, started_at DESC);

-- Idempotent: a database that ran this as revision 0030 already has the new
-- signature, so drop either one.
DROP FUNCTION IF EXISTS app.loader_run_record(TEXT, TEXT, TEXT, TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, TEXT);
DROP FUNCTION IF EXISTS app.loader_run_record(TEXT, TEXT, TEXT, TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, TEXT, BOOLEAN);

-- Records one source's run and prunes runs older than 30 days.
CREATE FUNCTION app.loader_run_record(
    p_source TEXT, p_target TEXT, p_status TEXT, p_started_at TIMESTAMPTZ, p_fetched INTEGER,
    p_written INTEGER, p_retired INTEGER, p_detail TEXT, p_rate_limited BOOLEAN DEFAULT false)
RETURNS SETOF app.loader_runs
LANGUAGE sql AS $$
    DELETE FROM app.loader_runs r WHERE r.finished_at < now() - INTERVAL '30 days';
    INSERT INTO app.loader_runs AS r (source, target, status, started_at, fetched, written, retired, detail,
                                      rate_limited)
    VALUES (p_source, p_target, p_status, p_started_at, p_fetched, p_written, p_retired,
            left(coalesce(p_detail, ''), 500), coalesce(p_rate_limited, false))
    RETURNING r.*;
$$;

-- When the source last asked its server (its latest attempt that wasn't
-- skipped, by when it started), and when the server last refused it. One
-- row, with nulls for a source that never asked.
DROP FUNCTION IF EXISTS app.loader_run_gate(TEXT);
CREATE FUNCTION app.loader_run_gate(p_source TEXT)
RETURNS TABLE (last_attempt_at TIMESTAMPTZ, last_rate_limited_at TIMESTAMPTZ)
LANGUAGE sql STABLE AS $$
    SELECT max(r.started_at) FILTER (WHERE r.status <> 'skipped'),
           max(r.started_at) FILTER (WHERE r.rate_limited)
    FROM app.loader_runs r
    WHERE r.source = p_source
$$;
