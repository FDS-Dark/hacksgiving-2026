-- =============================================================================
-- How referrals to each resource have turned out (see 0026_referral_outcomes.py).
--
-- Suggestions learn from outcomes: a resource whose referrals are accepted
-- or completed ranks above one whose referrals are declined. Counted from
-- app.case_referrals (0005) as they stand now; nothing new is stored.
-- =============================================================================

CREATE FUNCTION app.resource_outcome_stats()
RETURNS TABLE (resource_id UUID, referred INT, helped INT, declined INT, pending INT)
LANGUAGE sql STABLE AS $$
    SELECT f.resource_id,
           count(*)::INT,
           count(*) FILTER (WHERE f.status IN ('accepted', 'completed'))::INT,
           count(*) FILTER (WHERE f.status = 'declined')::INT,
           count(*) FILTER (WHERE f.status IN ('suggested', 'shared'))::INT
    FROM app.case_referrals f
    GROUP BY f.resource_id
$$;
