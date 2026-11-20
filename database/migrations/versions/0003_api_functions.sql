-- =============================================================================
-- The API's stored functions (ADR 0007). See 0003_api_functions.py.
--
-- The API holds no SQL: each databridge method calls exactly one of these,
-- by name, with named arguments. Conventions:
--
--   * app.<domain>_<verb>, parameters prefixed p_.
--   * Functions that read or write a user's data take the verified caller's
--     id (p_user_id) and filter by it, never a client-supplied one.
--   * "Not found" and "not yours" both return no rows; the service decides
--     which error that is.
--   * SECURITY INVOKER (the default): they run with the API role's own
--     grants (revision 0002).
--
-- Reads are LANGUAGE sql. Writes that need a check between statements are
-- plpgsql; every table column there is qualified, because an unqualified
-- name could mean a variable.

-- =============================================================================
-- USER
-- =============================================================================

CREATE FUNCTION app.user_get_by_sub(p_sub TEXT)
RETURNS TABLE (id UUID, auth0_sub TEXT, display_name TEXT, timezone TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql STABLE AS $$
    SELECT u.id, u.auth0_sub, u.display_name, u.timezone, u.created_at
    FROM app.users u
    WHERE u.auth0_sub = p_sub
$$;

-- First sign-in. Returns no row when the user already exists (the losing
-- side of a first-login race), and then creates nothing.
CREATE FUNCTION app.user_provision(p_sub TEXT, p_display_name TEXT)
RETURNS TABLE (id UUID, auth0_sub TEXT, display_name TEXT, timezone TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql AS $$
    INSERT INTO app.users AS u (auth0_sub, display_name)
    VALUES (p_sub, p_display_name)
    ON CONFLICT ON CONSTRAINT users_auth0_sub_key DO NOTHING
    RETURNING u.id, u.auth0_sub, u.display_name, u.timezone, u.created_at
$$;

-- NULL leaves a field as it is.
CREATE FUNCTION app.user_update(p_user_id UUID, p_display_name TEXT, p_timezone TEXT)
RETURNS TABLE (id UUID, auth0_sub TEXT, display_name TEXT, timezone TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql AS $$
    UPDATE app.users AS u
    SET display_name = COALESCE(p_display_name, u.display_name),
        timezone = COALESCE(p_timezone, u.timezone),
        updated_at = now()
    WHERE u.id = p_user_id
    RETURNING u.id, u.auth0_sub, u.display_name, u.timezone, u.created_at
$$;
