-- Give the phone agent named community places from the same reviewed directory
-- as the app. A stable voice-resource slug lets the existing privacy-safe
-- referral history store the selected place without accepting a service key
-- such as "meal_programs" as though it were a resource.

CREATE FUNCTION app.voice_directory_resource_list(p_category TEXT, p_query TEXT)
RETURNS TABLE (
    id UUID, slug TEXT, name TEXT, category TEXT, description TEXT,
    phone_e164 TEXT, languages TEXT[], service_area TEXT, hours_label TEXT,
    transfer_approved BOOLEAN, is_emergency BOOLEAN,
    last_verified_at TIMESTAMPTZ
)
LANGUAGE sql AS $$
    WITH synced AS (
        INSERT INTO app.voice_resources AS v (
            slug, name, category, description, phone_e164, languages,
            service_area, hours_label, transfer_approved, is_emergency,
            active, priority, last_verified_at
        )
        SELECT
            'directory-' || replace(r.id::TEXT, '-', ''),
            r.name,
            r.category,
            r.description,
            CASE
                WHEN r.phone ~ '^\+[1-9][0-9]{7,14}$' THEN r.phone
                WHEN regexp_replace(COALESCE(r.phone, ''), '[^0-9]', '', 'g')
                     ~ '^[2-9][0-9]{9}$'
                    THEN '+1' || regexp_replace(r.phone, '[^0-9]', '', 'g')
                ELSE NULL
            END,
            ARRAY['en']::TEXT[],
            COALESCE(NULLIF(r.neighborhood, ''), 'Milwaukee'),
            r.hours,
            false,
            false,
            true,
            50,
            r.updated_at
        FROM app.resources r
        WHERE r.active
          AND NOT r.is_sample
          AND r.category = p_category
          AND (
              NULLIF(trim(p_query), '') IS NULL
              OR concat_ws(' ', r.name, r.description, r.address, r.neighborhood)
                 ILIKE '%' || trim(p_query) || '%'
          )
        ORDER BY r.name
        LIMIT 25
        ON CONFLICT (slug) DO UPDATE SET
            name = EXCLUDED.name,
            category = EXCLUDED.category,
            description = EXCLUDED.description,
            phone_e164 = EXCLUDED.phone_e164,
            service_area = EXCLUDED.service_area,
            hours_label = EXCLUDED.hours_label,
            active = true,
            last_verified_at = EXCLUDED.last_verified_at,
            updated_at = now()
        RETURNING v.id, v.slug, v.name, v.category, v.description,
                  v.phone_e164, v.languages, v.service_area, v.hours_label,
                  v.transfer_approved, v.is_emergency, v.last_verified_at
    )
    SELECT * FROM synced ORDER BY name
$$;
