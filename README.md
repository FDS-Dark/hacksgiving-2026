# Hacksgiving

An iPhone app (Expo) with a FastAPI backend on Postgres, built on the same
stack as Cooli: Auth0 sign-in, Supabase Postgres, k3s behind a Cloudflare
Tunnel, Vault secrets, and a staging → main GitLab pipeline. Right now it's
a working skeleton: sign-in, `GET/PATCH /v1/me`, health checks, and a Home
screen. Features go on top.

## Community Response Navigator

The `calls-ava` work adds a privacy-first voice intake and responder workflow:

- ElevenLabs handles the live AI conversation and approved warm transfers;
  Twilio supplies the local phone number.
- FastAPI exposes signed post-call ingestion plus allowlisted resource and
  referral tools. It never stores audio, transcripts, caller phone numbers, or
  exact addresses.
- Postgres tracks structured call outcomes, referrals, verified resources,
  and aggregate impact measures.
- The mobile **Response** tab gives authenticated responders a minimum-data
  queue and clearly labeled synthetic fallback for demos.
- Immediate-danger calls are instructed to hang up and dial 911 directly;
  ordinary Twilio Programmable Voice is never treated as emergency dispatch.

Provider provisioning, the agent prompt, safety simulations, and the live demo
runbook are in [`docs/voice/`](docs/voice/README.md).

- **Security, data handling, known gaps:** [`SECURITY.md`](SECURITY.md)
- **Decisions** (inherited from Cooli): [`docs/decisions/`](docs/decisions/)

## Layout

```
apps/mobile/     Expo SDK 58 + React Native + TypeScript (Expo Router):
                 screens -> domain services -> TanStack Query
api/             FastAPI: routers -> services -> databridge -> stored functions
database/        PostgreSQL + pgvector: Alembic migrations, seeds,
                 and Supabase projects (database/terraform)
auth0/terraform/ the Auth0 tenant: API, mobile app, E2E app, Action
terraform/       production deploy: k3s namespace hacksgiving, secrets, DNS
docs/            decisions
```

## Environments

| | API | Database | Auth |
|---|---|---|---|
| **Production** | `https://hacksgiving-api.austinkoske.com/v1` (k3s via Cloudflare Tunnel) | Supabase project `hacksgiving` | Auth0, Cooli's tenant `dev-3wpn13zh30l6orpi` |
| **Staging** | `https://hacksgiving-api-staging.austinkoske.com/v1` | Supabase project `hacksgiving staging` | same tenant |
| **Local** | `uvicorn` on your machine | `database/compose.yaml` Postgres | HS256 dev tokens |

The iPhone build talks to production (`apps/mobile/.env.production`);
Expo Go talks to whatever `apps/mobile/.env.local` says.

## Local development

Needs Docker, `uv` and Node 22.

1. **Database**
   ```bash
   cd database
   cp .env.example .env
   docker compose up -d postgres
   ./migrate.sh --local   # Alembic upgrade + the dev user
   ```
2. **API**
   ```bash
   cd api
   cp example.env .env
   uv sync
   uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000
   uv run python scripts/dev_token.py   # a token for the seeded dev user
   ```
3. **Mobile**
   ```bash
   cd apps/mobile
   cp .env.example .env.local    # API URL (LAN/Tailscale IP on a phone) + dev token
   npm ci
   npx expo start                # Expo Go
   ```
   To install a standalone build on an iPhone, see
   [`apps/mobile/README.md`](apps/mobile/README.md#installing-on-an-iphone-no-testflight).

## Tests

```bash
cd api
uv run flake8 . ../database/migrations ../database/seeds
uv run mypy .
uv run pytest      # unit tests; integration and smoke tests skip
HACKSGIVING_TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/postgres uv run pytest
cd ../apps/mobile && npx tsc --noEmit && npx eslint . --max-warnings=0 && npm test
```

- **Unit (API):** user provisioning and updates against an in-memory
  stand-in for the stored functions, auth, the error contract, settings.
- **Unit (app):** the query retry policy, what a failed token refresh does
  to the session.
- **Integration:** the API over HTTP against a fresh Postgres per session,
  built by `alembic upgrade head`, as the least-privileged app role; plus a
  migration round trip.
- **Smoke** (`api/tests/smoke`): the deployed API end to end with a real
  Auth0 token. CI runs it after every staging and production apply.

## CI/CD (`.gitlab-ci.yml`)

| Stage | Jobs |
|---|---|
| test | `api-test` (flake8, mypy, OpenAPI contract, pytest), `mobile-test` (generated types, tsc, ESLint, Jest), `secret-scan` (gitleaks), `api-audit` (pip-audit), `mobile-audit` (npm audit) |
| a-build | `build-api` (image to the GitLab registry) |
| b-tf-plan | `validate`, `tf-plan` (main and MRs into it), `tf-plan-staging` (everything else), `auth0-plan`, `db-plan` |
| c-migrate | `migrate-staging` (automatic, `staging` branch), `migrate-production` (manual, `main`); both after `api-test` |
| d-tf-apply | `tf-apply-staging` (automatic, `staging`), `tf-apply`, `auth0-apply`, `db-apply` (manual, `main`) |
| e-smoke | `smoke-staging` (after `tf-apply-staging`), `smoke-production` (after `tf-apply`) |
| f-device | `ios-device-staging`, `ios-device-production` (Mac mini runner, installs on the paired iPhone) |

Changes go feature branch → `staging` → `main`, both protected. Merging
into `staging` migrates and deploys staging and smoke-tests it; an MR from
`staging` into `main` then plans production, and merging it makes the
production jobs available. Both environments run in the `hacksgiving`
namespace from one Terraform root with two states (`hacksgiving-k8s-staging`,
`hacksgiving-k8s-prod`; `terraform/environments/*.tfvars`). One Auth0 tenant
serves both. Terraform runs only in CI. Secrets come from Vault through
GitLab OIDC; see [`SECURITY.md`](SECURITY.md#secrets).

## Before the first deploy

Then, on `main`: `db-plan` → `db-apply` → `migrate-production` →
`tf-apply` (manual jobs, in that order); `staging` deploys on its own.

1. ~~Register~~ (vault-config MR !17, applied 2026-11-19) `austinkoske/personal/hacksgiving-2026` in
   `infra/vault-config/vault-app-projects.tf` (creates the `hacksgiving`
   namespace, its ci-deployer, and the `gitlab-hacksgiving-ci`,
   `gitlab-hacksgiving-database-ci` and `eso-hacksgiving` roles).
2. ~~Supabase projects and admin passwords~~ (done 2026-11-19). Still
   needed: a Supabase access token at
   `secret/deployments/hacksgiving/supabase-terraform`
   ([`database/README.md`](database/README.md#supabase-access-token)).
3. ~~Seed `secret/deployments/hacksgiving/app` and `.../staging/app` with
   `jwt_secret`.~~ (done 2026-11-19)
4. ~~Auth0~~ (done 2026-11-19): **Hacksgiving Terraform** in Cooli's
   tenant, `auth0-apply` run, `auth0_domain` and the app's Auth0 values set,
   `secret/deployments/hacksgiving/e2e` seeded.
5. ~~Create a protected `staging` branch, and a `gitlab-deploy-token`
   (read_registry) on the project.~~ (done 2026-11-19)

## Rules worth knowing before you add code

- **API:** router → service → databridge → stored function, one domain
  per file in each layer, Pydantic models between them. No SQL in the API
  ([ADR 0007](docs/decisions/0007-sql-in-stored-functions.md)); see
  [`api/README.md`](api/README.md#adding-a-resource).
- **App:** screens call domain service hooks (`src/services`), which own
  the API calls and the TanStack Query cache. API types are generated,
  never written by hand
  ([ADR 0008](docs/decisions/0008-mobile-services-and-query-cache.md)).
- Scope every query by the caller's verified id; never accept a user id
  from a request body.
- Never commit credentials. `EXPO_PUBLIC_*` values ship inside the app.
- Add Expo packages with `npx expo install` and read `apps/mobile/AGENTS.md`
  before touching Expo APIs.
