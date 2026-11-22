-- Local-only (./migrate.sh --local): the demo story. Three requests at
-- N 27th St & W Center St on recent Friday and Saturday nights, with
-- coordinates, so Insights shows "Pattern spotted" once the worker has
-- placed them (services/place.py) and the coverage map has cases there.
-- No personal names. Medium priority, so loading it never pages on call.
-- Fixed ids: running it again changes nothing.

WITH week AS (
    SELECT date_trunc('week', now() AT TIME ZONE 'America/Chicago') AS monday
)
INSERT INTO app.cases (id, title, description, category, priority, status, source, location, latitude, longitude,
                       contact_method, created_at, updated_at)
SELECT v.id, v.title, v.description, v.category, 'medium', 'new', 'public', 'N 27th St & W Center St',
       43.0679, -87.9474, 'none', v.at AT TIME ZONE 'America/Chicago', v.at AT TIME ZONE 'America/Chicago'
FROM week, LATERAL (VALUES
    ('00000000-0000-4000-a000-00000000d001'::uuid, 'Fight outside the corner store',
     'Group arguing outside the store at 27th and Center again. Nobody hurt yet; asking for someone to calm it down.',
     'incident_deescalation', week.monday - INTERVAL '3 days' + INTERVAL '23 hours'),
    ('00000000-0000-4000-a000-00000000d002'::uuid, 'Young people need somewhere to go at night',
     'Same corner, late. Teens hanging out with nowhere safe to be; neighbors worried it will turn violent.',
     'violence_prevention', week.monday - INTERVAL '2 days' + INTERVAL '1 hour'),
    ('00000000-0000-4000-a000-00000000d003'::uuid, 'Shouting match spilled into the street',
     'Third weekend in a row at 27th and Center. Would like a violence interrupter to come by on Friday.',
     'violence_prevention', week.monday - INTERVAL '9 days' + INTERVAL '23 hours 30 minutes')
) AS v (id, title, description, category, at)
ON CONFLICT (id) DO NOTHING;
