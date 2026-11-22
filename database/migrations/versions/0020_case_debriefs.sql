-- =============================================================================
-- Debriefs for an existing case (see 0020_case_debriefs.py).
--
-- A record normally becomes a new case when it is confirmed (0011). A worker
-- responding to an urgent alert already has a case, though: a debrief taken
-- from the Responding screen names that case when it's captured, and
-- confirming it adds to the case (a note, tasks) instead of opening another.
-- records.case_id already exists; before confirm it now means "the case this
-- debrief is about".
-- =============================================================================

-- Ties a record that is still being processed or reviewed to its case. No
-- row: the record is confirmed, discarded or gone.
CREATE FUNCTION app.record_set_case(p_record_id UUID, p_case_id UUID)
RETURNS SETOF app.records
LANGUAGE sql AS $$
    UPDATE app.records AS r
    SET case_id = p_case_id, updated_at = now()
    WHERE r.id = p_record_id AND r.status IN ('processing', 'ready', 'failed')
    RETURNING r.*
$$;
