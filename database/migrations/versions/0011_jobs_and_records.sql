-- =============================================================================
-- A durable job queue, and Phantom records (see 0011_jobs_and_records.py).
--
-- JOBS: background work (transcribe, redact, extract, sweep) that must
-- survive crashes and redeploys. A worker claims jobs with
-- FOR UPDATE SKIP LOCKED, so any number of workers can poll the same table
-- without taking the same job, and holds a lease (locked_until) while it
-- works. A worker that dies simply lets its lease run out; the job is
-- claimed again. Every claim counts as an attempt, so a job that keeps
-- crashing its worker still ends up dead instead of looping forever.
-- complete/fail check the lease owner, so a worker whose lease expired
-- can't overwrite the newer attempt's result.
--
-- Payloads carry ids only, never the text being processed: jobs are
-- operational data and last_error is shown to staff.
--
-- RECORDS: what a worker captured after a call or a visit (typed now, voice
-- next), and what the pipeline made of it. raw_text is staff-only, like a
-- case's contact details. redacted_text is what the AI reads.
--
-- Same conventions as 0003 and 0005: app.<domain>_<verb>, p_ parameters, no
-- row means not found, SECURITY INVOKER. Timestamps use clock_timestamp()
-- where a function writes several rows in one transaction and order matters.
-- =============================================================================

-- =============================================================================
-- JOBS
-- =============================================================================

CREATE TABLE app.jobs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind          TEXT NOT NULL CONSTRAINT jobs_kind_check CHECK (kind ~ '^[a-z][a-z0-9_.]{0,62}$'),
    payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
    status        TEXT NOT NULL DEFAULT 'queued'
                  CONSTRAINT jobs_status_check CHECK (status IN ('queued', 'running', 'done', 'dead')),
    attempts      INT NOT NULL DEFAULT 0,
    max_attempts  INT NOT NULL DEFAULT 5 CONSTRAINT jobs_max_attempts_check CHECK (max_attempts BETWEEN 1 AND 50),
    run_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_by     TEXT,
    locked_until  TIMESTAMPTZ,
    last_error    TEXT CONSTRAINT jobs_last_error_check CHECK (length(last_error) <= 500),
    -- At most one live (queued or running) job per key: enqueueing the same
    -- work twice is a no-op.
    dedupe_key    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at   TIMESTAMPTZ
);

CREATE UNIQUE INDEX jobs_live_dedupe_idx ON app.jobs (dedupe_key)
    WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running');
CREATE INDEX jobs_ready_idx ON app.jobs (kind, run_at) WHERE status = 'queued';
CREATE INDEX jobs_lease_idx ON app.jobs (locked_until) WHERE status = 'running';
CREATE INDEX jobs_finished_idx ON app.jobs (finished_at) WHERE status IN ('done', 'dead');
-- Record stages carry {"record_id": ...}; finds a record's live job.
CREATE INDEX jobs_live_record_idx ON app.jobs ((payload ->> 'record_id')) WHERE status IN ('queued', 'running');

-- Queue a job. With a dedupe key that already has a live job, returns that
-- job instead of a new one.
CREATE FUNCTION app.job_enqueue(
    p_kind TEXT, p_payload JSONB DEFAULT '{}'::jsonb, p_run_at TIMESTAMPTZ DEFAULT NULL,
    p_max_attempts INT DEFAULT 5, p_dedupe_key TEXT DEFAULT NULL)
RETURNS SETOF app.jobs
LANGUAGE plpgsql AS $$
DECLARE
    v_job app.jobs;
BEGIN
    INSERT INTO app.jobs AS j (kind, payload, run_at, max_attempts, dedupe_key)
    VALUES (p_kind, COALESCE(p_payload, '{}'::jsonb), COALESCE(p_run_at, now()), p_max_attempts, p_dedupe_key)
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running') DO NOTHING
    RETURNING j.* INTO v_job;
    IF v_job.id IS NULL THEN
        SELECT * INTO v_job FROM app.jobs j
        WHERE j.dedupe_key = p_dedupe_key AND j.status IN ('queued', 'running');
    END IF;
    RETURN NEXT v_job;
END;
$$;

-- Claim up to p_limit jobs of the given kinds for p_worker: queued jobs
-- that are due, and running jobs whose lease ran out (their worker died).
-- A job whose lease ran out on its last attempt is marked dead instead.
CREATE FUNCTION app.job_claim(p_worker TEXT, p_kinds TEXT[], p_lease_seconds INT, p_limit INT DEFAULT 1)
RETURNS SETOF app.jobs
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE app.jobs AS j
    SET status = 'dead', locked_by = NULL, locked_until = NULL, finished_at = now(), updated_at = now(),
        last_error = COALESCE(j.last_error, 'The worker stopped responding on the last attempt.')
    WHERE j.status = 'running' AND j.locked_until < now() AND j.attempts >= j.max_attempts
      AND j.kind = ANY (p_kinds);

    RETURN QUERY
    WITH picked AS (
        SELECT j.id FROM app.jobs j
        WHERE j.kind = ANY (p_kinds)
          AND ((j.status = 'queued' AND j.run_at <= now())
               OR (j.status = 'running' AND j.locked_until < now()))
        ORDER BY j.run_at
        FOR UPDATE SKIP LOCKED
        LIMIT GREATEST(p_limit, 0)
    )
    UPDATE app.jobs AS j
    SET status = 'running', attempts = j.attempts + 1, locked_by = p_worker,
        locked_until = now() + make_interval(secs => p_lease_seconds), updated_at = now()
    FROM picked
    WHERE j.id = picked.id
    RETURNING j.*;
END;
$$;

-- Keep a long job's lease. No row: the lease was lost (expired and taken).
CREATE FUNCTION app.job_heartbeat(p_job_id UUID, p_worker TEXT, p_lease_seconds INT)
RETURNS SETOF app.jobs
LANGUAGE sql AS $$
    UPDATE app.jobs AS j
    SET locked_until = now() + make_interval(secs => p_lease_seconds), updated_at = now()
    WHERE j.id = p_job_id AND j.status = 'running' AND j.locked_by = p_worker
    RETURNING j.*
$$;

-- Finish a job. No row: this worker no longer holds it.
CREATE FUNCTION app.job_complete(p_job_id UUID, p_worker TEXT)
RETURNS SETOF app.jobs
LANGUAGE sql AS $$
    UPDATE app.jobs AS j
    SET status = 'done', locked_by = NULL, locked_until = NULL, finished_at = now(), updated_at = now()
    WHERE j.id = p_job_id AND j.status = 'running' AND j.locked_by = p_worker
    RETURNING j.*
$$;

-- A failed attempt: queued again after p_retry_seconds, or dead once its
-- attempts are used up, or at once with p_give_up (an error retrying can't
-- fix, like audio that isn't audio). No row: this worker no longer holds it.
CREATE FUNCTION app.job_fail(
    p_job_id UUID, p_worker TEXT, p_error TEXT, p_retry_seconds INT, p_give_up BOOLEAN DEFAULT false)
RETURNS SETOF app.jobs
LANGUAGE sql AS $$
    UPDATE app.jobs AS j
    SET status = CASE WHEN p_give_up OR j.attempts >= j.max_attempts THEN 'dead' ELSE 'queued' END,
        run_at = CASE WHEN p_give_up OR j.attempts >= j.max_attempts THEN j.run_at
                      ELSE now() + make_interval(secs => GREATEST(p_retry_seconds, 0)) END,
        finished_at = CASE WHEN p_give_up OR j.attempts >= j.max_attempts THEN now() END,
        locked_by = NULL, locked_until = NULL, last_error = left(p_error, 500), updated_at = now()
    WHERE j.id = p_job_id AND j.status = 'running' AND j.locked_by = p_worker
    RETURNING j.*
$$;

-- How the queue is doing, for the staff ops view and alerts.
CREATE FUNCTION app.job_stats()
RETURNS TABLE (kind TEXT, status TEXT, total BIGINT, oldest_run_at TIMESTAMPTZ)
LANGUAGE sql STABLE AS $$
    SELECT j.kind, j.status, count(*), min(j.run_at)
    FROM app.jobs j
    WHERE j.status IN ('queued', 'running', 'dead') OR j.finished_at > now() - interval '1 day'
    GROUP BY j.kind, j.status
    ORDER BY j.kind, j.status
$$;

-- Delete finished jobs older than p_days (dead ones are kept 4x longer, to
-- look into). Returns how many went.
CREATE FUNCTION app.job_prune(p_days INT)
RETURNS TABLE (deleted BIGINT)
LANGUAGE sql AS $$
    WITH gone AS (
        DELETE FROM app.jobs j
        WHERE (j.status = 'done' AND j.finished_at < now() - make_interval(days => p_days))
           OR (j.status = 'dead' AND j.finished_at < now() - make_interval(days => p_days * 4))
        RETURNING 1
    )
    SELECT count(*) FROM gone
$$;

-- =============================================================================
-- RECORDS (Phantom: capture -> redact -> extract -> review -> case)
-- =============================================================================

CREATE TABLE app.records (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id      UUID NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
    source         TEXT NOT NULL CONSTRAINT records_source_check CHECK (source IN ('text', 'audio')),
    -- processing: in the pipeline (stage says where); ready: waiting for the
    -- author's review; confirming: a confirm is creating the case right now.
    status         TEXT NOT NULL DEFAULT 'processing' CONSTRAINT records_status_check
                   CHECK (status IN ('processing', 'ready', 'confirming', 'confirmed', 'failed', 'discarded')),
    stage          TEXT NOT NULL DEFAULT 'redact' CONSTRAINT records_stage_check
                   CHECK (stage IN ('upload', 'transcribe', 'redact', 'extract', 'done')),
    raw_text       TEXT CONSTRAINT records_raw_text_check CHECK (length(raw_text) <= 20000),
    redacted_text  TEXT CONSTRAINT records_redacted_text_check CHECK (length(redacted_text) <= 20000),
    extraction     JSONB,
    case_id        UUID REFERENCES app.cases (id) ON DELETE SET NULL,
    error          TEXT CONSTRAINT records_error_check CHECK (length(error) <= 500),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at   TIMESTAMPTZ
);

CREATE INDEX records_author_idx ON app.records (author_id, created_at DESC);

CREATE FUNCTION app.record_create(p_author_id UUID, p_source TEXT, p_raw_text TEXT, p_stage TEXT)
RETURNS SETOF app.records
LANGUAGE sql AS $$
    INSERT INTO app.records AS r (author_id, source, raw_text, stage)
    VALUES (p_author_id, p_source, p_raw_text, p_stage)
    RETURNING r.*
$$;

CREATE FUNCTION app.record_get(p_record_id UUID)
RETURNS SETOF app.records
LANGUAGE sql STABLE AS $$
    SELECT * FROM app.records r WHERE r.id = p_record_id
$$;

-- An author's records, newest first (discarded ones left out).
CREATE FUNCTION app.record_list(p_author_id UUID, p_limit INT)
RETURNS SETOF app.records
LANGUAGE sql STABLE AS $$
    SELECT * FROM app.records r
    WHERE r.author_id = p_author_id AND r.status <> 'discarded'
    ORDER BY r.created_at DESC
    LIMIT p_limit
$$;

-- A pipeline stage finished: store what it made and move on to p_next_stage.
-- Only while processing, so a discarded record stays discarded.
CREATE FUNCTION app.record_advance(
    p_record_id UUID, p_next_stage TEXT, p_raw_text TEXT DEFAULT NULL, p_redacted_text TEXT DEFAULT NULL,
    p_extraction JSONB DEFAULT NULL)
RETURNS SETOF app.records
LANGUAGE sql AS $$
    UPDATE app.records AS r
    SET stage = p_next_stage,
        status = CASE WHEN p_next_stage = 'done' THEN 'ready' ELSE 'processing' END,
        raw_text = COALESCE(p_raw_text, r.raw_text),
        redacted_text = COALESCE(p_redacted_text, r.redacted_text),
        extraction = COALESCE(p_extraction, r.extraction),
        error = NULL, updated_at = now()
    WHERE r.id = p_record_id AND r.status = 'processing'
    RETURNING r.*
$$;

CREATE FUNCTION app.record_fail(p_record_id UUID, p_error TEXT)
RETURNS SETOF app.records
LANGUAGE sql AS $$
    UPDATE app.records AS r
    SET status = 'failed', error = left(p_error, 500), updated_at = now()
    WHERE r.id = p_record_id AND r.status = 'processing'
    RETURNING r.*
$$;

-- Try a failed record again from the stage it stopped at.
CREATE FUNCTION app.record_retry(p_record_id UUID)
RETURNS SETOF app.records
LANGUAGE sql AS $$
    UPDATE app.records AS r
    SET status = 'processing', error = NULL, updated_at = now()
    WHERE r.id = p_record_id AND r.status = 'failed'
    RETURNING r.*
$$;

-- The first step of a confirm: only one caller can move a record from
-- ready to confirming, so a double tap creates one case. No row: someone
-- else is confirming it, or it isn't ready.
CREATE FUNCTION app.record_begin_confirm(p_record_id UUID)
RETURNS SETOF app.records
LANGUAGE sql AS $$
    UPDATE app.records AS r
    SET status = 'confirming', updated_at = now()
    WHERE r.id = p_record_id AND r.status = 'ready'
    RETURNING r.*
$$;

CREATE FUNCTION app.record_finish_confirm(p_record_id UUID, p_case_id UUID)
RETURNS SETOF app.records
LANGUAGE sql AS $$
    UPDATE app.records AS r
    SET status = 'confirmed', case_id = p_case_id, confirmed_at = now(), updated_at = now()
    WHERE r.id = p_record_id AND r.status = 'confirming'
    RETURNING r.*
$$;

-- Creating the case failed: back to ready so the author can try again.
CREATE FUNCTION app.record_abort_confirm(p_record_id UUID)
RETURNS SETOF app.records
LANGUAGE sql AS $$
    UPDATE app.records AS r
    SET status = 'ready', updated_at = now()
    WHERE r.id = p_record_id AND r.status = 'confirming'
    RETURNING r.*
$$;

-- A backstop for jobs that died without telling their record (the worker
-- crashed on the last attempt): records still processing, with no live job,
-- untouched for p_seconds, are marked failed so the author can retry.
CREATE FUNCTION app.record_fail_stalled(p_seconds INT)
RETURNS SETOF app.records
LANGUAGE sql AS $$
    UPDATE app.records AS r
    SET status = 'failed', error = 'Processing stopped. Try again.', updated_at = now()
    WHERE r.status = 'processing'
      AND r.updated_at < now() - make_interval(secs => p_seconds)
      AND NOT EXISTS (
          SELECT 1 FROM app.jobs j
          WHERE j.payload ->> 'record_id' = r.id::text AND j.status IN ('queued', 'running'))
    RETURNING r.*
$$;

-- Throw a record away: its text goes with it. A confirmed record keeps its
-- case; the text is still wiped.
CREATE FUNCTION app.record_discard(p_record_id UUID)
RETURNS SETOF app.records
LANGUAGE sql AS $$
    UPDATE app.records AS r
    SET status = CASE WHEN r.status = 'confirmed' THEN 'confirmed' ELSE 'discarded' END,
        raw_text = NULL, redacted_text = NULL, extraction = NULL, updated_at = now()
    WHERE r.id = p_record_id AND r.status <> 'confirming'
    RETURNING r.*
$$;
