# api

FastAPI backend for hacksgiving.

## Architecture

Layered, one direction of dependency, and the same domains in every layer
(today just `user`; see [ADR 0007](../docs/decisions/0007-sql-in-stored-functions.md)).

```
routers/<domain>.py     HTTP: request/response models, status codes, auth dependencies
  -> services/<domain>.py    rules and errors; no SQL
    -> databridge/<domain>.py  one method per stored function; returns models
      -> app.<domain>_<verb>(...)  the SQL, a PostgreSQL function (database/migrations)
models/<domain>.py      Pydantic models passed between the layers (base: models/base.py)
adapters/               (add when needed) clients for external services, called from services
engine/                 owns the SQLAlchemy async engine + connection URL
```

- **There is no SQL in the API.** `databridge/executor.py` sends the one
  statement shape the API uses, `SELECT * FROM app.<fn>(p_a => :a, …)`,
  with every value bound.
- **Functions that touch a user's data take the caller's id** from the
  verified token (`get_current_user`), never from a request body.
- Work that must change several things at once is one function, or shares
  a transaction across databridges: `async with executor.transaction() as tx:`
  then `databridge.within(tx)`.
- `dependencies.py` wires the layers as cached FastAPI dependencies, so the
  engine, pool and services are built once per process.
- `errors.py` gives every failure the same body,
  `{"code", "message", "request_id"}`, and every response, failures
  included, carries `X-Request-ID`.
- `logging_setup.py` configures stdlib logging once: JSON in production
  (`APP__LOGGING__FORMAT=json`), and HTTP client loggers stay at WARNING so
  no request URL is ever logged. Database errors hide their parameters.

All routes are under `/v1` (plus an unversioned `/health` for the k8s probes).

## Auth

`dependencies.py:get_token_claims` verifies the bearer access token
(signature, `exp`, issuer, audience) using `settings.py:JWTConfig`:

- **Auth0** (staging/production): set `APP__JWT__JWKS_URL`, `ALGORITHM=RS256`,
  `ISSUER` and `AUDIENCE`. `tofu -chdir=auth0/terraform output -raw api_env`
  prints them. Keys come from the tenant's JWKS.
- **Local dev / tests**: leave `JWKS_URL` empty; tokens are HS256-signed with
  `APP__JWT__SECRET`. `uv run python scripts/dev_token.py [sub]` prints one.
  Production refuses to start with the dev secret and no JWKS
  (`settings.py:AppConfig._production_is_not_dev`).

`get_current_user` maps the token's `sub` to `app.users` via
`services/user.py`. On the first request `app.user_provision` creates the
user.

Auth0 access tokens carry no profile data. The post-login Action in
`auth0/terraform` adds the user's name as `https://hacksgiving.app/name` (what
`APP__JWT__NAME_CLAIM` defaults to), and the app sends it with
`PATCH /v1/me` after sign-in. A name that is an email address is never
stored.

## Resources

| Route | Service |
|---|---|
| `GET /v1/health` | — |
| `GET/PATCH /v1/me` (display name, IANA timezone) | `UserService` |

## Adding a resource

1. **The SQL:** a new Alembic revision in `database/migrations/versions/`
   with the functions it needs, named `app.<domain>_<verb>` (see
   `database/README.md`; never edit an applied revision).
2. **Models:** `models/<domain>.py`, on `ApiModel`: request bodies,
   responses, and any databridge result.
3. **Databridge:** `databridge/<domain>.py`, one method per function,
   returning models.
4. **Service:** `services/<domain>.py`, the rules; it raises `ApiError`
   (`errors.py`) and calls only databridges (and adapters, if any).
5. **Router:** `routers/<domain>.py`, registered in `main.py` under `/v1`,
   with a cached `get_<domain>_service()` in `dependencies.py`.
6. **Tests:** service rules in `tests/unit` against `tests/unit/fakes.py`;
   the HTTP flow, per-user isolation and the SQL in `tests/integration`.
   Add the new functions to the revision's downgrade list
   (`test_migrations.py` checks it).
7. **The app's types:** `uv run python scripts/export_openapi.py
   ../apps/mobile/openapi.json`, then `npm run gen:api` in `apps/mobile`.

## Local development

```bash
cp example.env .env   # fill in real values
uv sync
uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## Tests

```bash
uv run flake8 .
uv run mypy .
uv run pytest
```

Unit tests replace the database with an in-memory stand-in for the stored
functions and check what a caller sees. Integration tests
(`tests/integration/`) run only when `HACKSGIVING_TEST_DATABASE_URL` points at a
disposable Postgres server (superuser); they create a fresh database, run
the Alembic migrations to head, connect as the least-privileged app role,
and drop the database afterwards. `test_migrations.py` also checks every
downgrade.

## Deploying to the homelab

`../terraform/main.tf` runs this as a k8s `Deployment` behind a Traefik
`IngressRoute`: a non-root pod (uid 10001, from `Dockerfile`) with a
read-only root filesystem, no added capabilities, and readiness and
liveness probes on `/health`. `APP__DATABASE__*` and `APP__JWT__SECRET`
come from Vault through `ExternalSecret`s, not a `.env` file.
Production sets `APP__CORS_ORIGINS` to `[]`: the only client is the native
app, which doesn't need CORS. The container listens on 8443.
