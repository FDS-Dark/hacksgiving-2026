# Security

How Hacksgiving protects accounts and user data, what runs where, and what's
known to be missing. The stack (and most of this document) comes from Cooli;
keep it current as features land.

Report a vulnerability privately to the project maintainers (not in a
public issue).

## System at a glance

```
iPhone app (Expo)  --HTTPS-->  Cloudflare Tunnel  -->  k3s (namespace hacksgiving)
   |  Auth0 Universal Login                              hacksgiving-api (FastAPI)
   |  (PKCE, system browser)                              |  Postgres (Supabase, app role)
   v                                                      '  secrets: Vault -> External Secrets
 Auth0 tenant (auth0/terraform)
```

There are no inbound ports on the home network. The API is reachable only
through the Cloudflare Tunnel at `https://hacksgiving-api.austinkoske.com/v1`
(staging: `hacksgiving-api-staging.austinkoske.com`).

## Authentication

- **Users** sign in with Auth0 Universal Login in the system browser:
  authorization code + PKCE, no client secret in the app
  (`apps/mobile/src/lib/auth.tsx`). Tokens are kept in the iOS Keychain
  (`expo-secure-store`) and refreshed with rotating refresh tokens (30-day
  absolute, 15-day idle; `auth0/terraform/main.tf`).
- **The API** accepts only RS256 access tokens for the audience
  `https://api.hacksgiving.app` once `terraform/` var `auth0_domain` is set.
  It verifies signature (tenant JWKS), `exp`, issuer and audience, with
  30 s leeway, and requires `sub` (`api/dependencies.py:get_token_claims`).
  ID tokens are not accepted. A failed check returns 401 and the reason
  goes to the log only.
- **Production refuses to start** if it would accept forged tokens: without
  a JWKS URL it requires HS256 with a real secret of 32+ characters, never
  the dev secret (`api/settings.py:AppConfig._production_is_not_dev`).
- **Machine identity:** the post-deploy smoke test signs in as the
  `Hacksgiving E2E` Auth0 app (client credentials, Hacksgiving API audience
  only). To the API it is an ordinary user.
- The Auth0 tenant (apps, API, callbacks, refresh policy, the name Action,
  the tenant name) is Terraform in `auth0/terraform`, applied only from CI.

## Authorization

- **A user's data is scoped by their verified id**, which comes from the
  token (`get_current_user`), never from a request body. The API's queries
  are database functions that take that id as an argument
  ([ADR 0007](docs/decisions/0007-sql-in-stored-functions.md)). "Not
  found" and "not yours" both return 404.
- **Least privilege:** the API connects as a dedicated role with DML on
  the `app` schema only (migration 0002), never as the owner. On Supabase,
  migration 0004 revokes `anon`/`authenticated` default privileges in
  `public`, and `database/terraform` turns the Data API off.
- Integration tests run as that same role (`api/tests/integration/`).

## Data we hold

| Data | Where | Notes |
|---|---|---|
| Auth0 `sub`, display name, timezone | Postgres `app.users` | No email or password; Auth0 holds credentials. A name that is an email address is never stored (API, app and Auth0 Action) |

Third parties that receive data: **Auth0** (sign-in), **Supabase**
(database), **Cloudflare** (TLS termination for the tunnel).

## Input handling

- The API sends no SQL of its own: `api/databridge/executor.py` calls a
  stored function by name with every value bound; names come from code and
  are checked against an identifier pattern.
- Request bodies are Pydantic models; validation failures return a
  structured 422.
- CORS: production allows **no** browser origins (the clients are native).

## Secrets

Nothing secret is in git; `gitleaks` scans the whole history in CI
(`.gitleaksignore` lists reviewed false positives). `EXPO_PUBLIC_*` values
ship inside the app bundle and are public by design.

| Vault path (`secret/…`) | Holds | Read by |
|---|---|---|
| `deployments/hacksgiving/app` | `jwt_secret` | API pod (External Secrets) |
| `deployments/hacksgiving/db` | API database credentials | API pod |
| `deployments/hacksgiving/db-migration` | migration role | CI `migrate-production` |
| `deployments/hacksgiving/staging/*` | the same for staging | CI, local dev |
| `deployments/hacksgiving/supabase-terraform`, `supabase-admin` | Supabase management | CI `database/terraform` |
| `deployments/hacksgiving/auth0-terraform` | Auth0 Terraform M2M app | CI `auth0-*` |
| `deployments/hacksgiving/e2e` | Hacksgiving E2E M2M app | CI `smoke-staging`, `smoke-production` |
| `platform/cloudflare/ci` | DNS token | CI `tf-*` |

CI authenticates to Vault with GitLab OIDC (no stored tokens); each role
is scoped to its paths in `infra/vault-config`. The cluster is reached
with a short-lived, namespace-scoped token minted per job. HTTP client
loggers stay at WARNING and database errors hide their parameters.
Terraform's binary plans, which hold secret values, are downloadable by
maintainers only.

## Deploys and verification

- Terraform runs only in CI. Applies and production migrations are manual
  jobs on the default branch only, serialized by `resource_group`;
  migrations need the API tests and run before the deploy.
- Each pipeline runs flake8, mypy, unit tests, integration tests on a fresh
  Postgres (with a migration round trip), the API/app contract check,
  mobile typecheck, ESLint and Jest, `gitleaks`, `pip-audit` and
  `npm audit`.
- The API pod runs as a non-root user with a read-only root filesystem, no
  added capabilities, seccomp `RuntimeDefault` and no service account
  token.
- The production Auth0 app accepts only the `hacksgiving://` and
  `hacksgiving-staging://` callbacks; Expo Go's developer callbacks belong
  to a separate dev app.
- After every apply, `smoke-*` exercises the real stack end to end
  (`api/tests/smoke`).

## Dependencies

Locked: `api/uv.lock`, `apps/mobile/package-lock.json`, and the three
`.terraform.lock.hcl` files. CI and container images are pinned to exact
versions. CI fails `npm audit` on high or critical findings; list any
accepted moderate findings here.

## Known gaps

- **No account deletion or data export.** Required before App Store
  release (App Store Review Guideline 5.1.1(v)).
- **No API rate limiting** beyond Cloudflare's defaults.
- Supabase backup/PITR settings have not been reviewed.
- Check that `gitlab-hacksgiving-ci` and `gitlab-hacksgiving-database-ci`
  (in `infra/vault-config`) accept protected refs only, so only `staging`
  and `main` pipelines can read deploy credentials.
