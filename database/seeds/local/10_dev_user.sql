-- Local-only (./migrate.sh --local): a dev user matching the HS256 dev
-- token's "sub" (see api/README.md). Idempotent.

INSERT INTO app.users (id, auth0_sub, display_name)
VALUES ('00000000-0000-4000-a000-000000000001', 'dev|local-user', 'Local Dev')
ON CONFLICT (auth0_sub) DO NOTHING;
