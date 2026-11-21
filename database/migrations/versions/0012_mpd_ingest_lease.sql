-- =============================================================================
-- One ingestion per interval, however many API processes run (see
-- 0012_mpd_ingest_lease.py).
--
-- Every API process runs the MPD ingest loop (services/mpd_scheduler.py).
-- Before scraping, a process claims the single lease row; the UPDATE's row
-- lock makes the claim atomic, so of several replicas waking together
-- exactly one gets `true` and the others skip that tick.
-- =============================================================================

CREATE TABLE app.mpd_ingest_lease (
    id         INTEGER PRIMARY KEY CONSTRAINT mpd_ingest_lease_single_row CHECK (id = 1),
    claimed_at TIMESTAMPTZ NOT NULL
);

INSERT INTO app.mpd_ingest_lease (id, claimed_at) VALUES (1, '-infinity');

-- True when this caller may ingest now: nobody claimed the lease in the last
-- p_every_seconds (less a few seconds' slack, so a loop on exactly that
-- interval isn't skipped for being a moment early).
CREATE FUNCTION app.mpd_ingest_claim(p_every_seconds INTEGER)
RETURNS TABLE (claimed BOOLEAN)
LANGUAGE sql AS $$
    WITH claim AS (
        UPDATE app.mpd_ingest_lease l SET claimed_at = now()
        WHERE l.id = 1 AND l.claimed_at <= now() - make_interval(secs => GREATEST(p_every_seconds - 5, 0))
        RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM claim)
$$;
