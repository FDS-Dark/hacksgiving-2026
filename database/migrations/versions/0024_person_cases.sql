-- =============================================================================
-- The person behind a case (see 0024_person_cases.py).
--
-- There is no separate person record: a resident is whoever a case is about.
-- Their other cases are found by the same resident account (requester_id),
-- the same phone number (the last 10 digits, ignoring formatting) or the
-- same email (case-insensitive). Staff only; the API checks.
-- =============================================================================

-- Digits only, the last 10 (so +1 (414) 555-0182 and 414.555.0182 match).
-- NULL when fewer than 7 digits are left.
CREATE FUNCTION app.phone_key(p_phone TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN length(d) >= 7 THEN right(d, 10) END
    FROM (SELECT regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') AS d) s
$$;

-- The case itself and every case that looks like the same person, newest first.
CREATE FUNCTION app.person_cases(p_case_id UUID, p_limit INT)
RETURNS SETOF app.case_view
LANGUAGE sql STABLE AS $$
    WITH anchor AS (
        SELECT c.requester_id,
               app.phone_key(c.contact_phone) AS phone,
               NULLIF(lower(trim(coalesce(c.contact_email, ''))), '') AS email
        FROM app.cases c
        WHERE c.id = p_case_id
    )
    SELECT v.* FROM app.case_view v, anchor a
    WHERE v.id = p_case_id
       OR (a.requester_id IS NOT NULL AND v.requester_id = a.requester_id)
       OR (a.phone IS NOT NULL AND app.phone_key(v.contact_phone) = a.phone)
       OR (a.email IS NOT NULL AND lower(trim(v.contact_email)) = a.email)
    ORDER BY v.created_at DESC
    LIMIT p_limit
$$;
