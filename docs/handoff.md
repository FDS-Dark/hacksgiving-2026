# Handoff: where things stand

Last updated 2026-11-22. Update this file when you finish a piece of work or
change what's deployed, so the next person (or agent) starts from the truth.

## What the app is

ComForce MKE (Milwaukee's Community Task Force) gets requests for help from
residents and runs outreach. Two apps in one Expo project, chosen by role:

- **Resident app** (`apps/mobile/src/app/(main)`, `help/`, `place/`): Home,
  Get help (works signed out, with an access code), Requests, Nearby (map of
  places), Me; Quick exit on every screen; 911 dials only in a production
  build (`lib/phone.ts`).
- **Staff app** (`apps/mobile/src/app/staff`): Today, Queue, Record, Map, Me
  (Team & roles, Insights). Cases with tasks, history, referrals, the service
  playbook, an Update sheet and a message thread with the resident.
- **Phantom debriefs**: a worker records (or types) what happened after a call
  or visit; a background pipeline transcribes it, removes names it can spot,
  and has an AI suggest a case (title, summary, service, priority, risk flags,
  tasks). The worker reviews and confirms it into a real case.
- **Voice agent "Ava"** (teammates' work, `api/routers/voice.py`,
  `docs/voice/`): phone calls via ElevenLabs, handed off to the app with a code.
- **Opportunities** (teammates' work, migration 0010): volunteer and job
  listings for residents and staff.

The design source of truth is the Figma file "Hacksgiving 2027"
(page "App shell v2"). Plan and screen status: `docs/app-flow.md`.

## How it's built

- Backend: FastAPI, router -> service -> databridge -> SQL in stored functions
  (`api/README.md`, ADR 0007). Background work runs in a separate process
  (`python -m worker`) from a job queue in Postgres (ADR 0009).
- App: Expo Router; one service module per API domain under
  `apps/mobile/src/services` (TanStack Query); visual style "C · Light" (white
  cards, hairline borders, green only for primary actions).
- Database: Alembic revisions through **0011** (`0010_opportunities`,
  `0011_jobs_and_records`).
- Storage for voice audio: S3-compatible locally (SeaweedFS container),
  Supabase Storage's API in production; audio is deleted once transcribed.

## Running it

`AGENTS.md`, section "Run it locally": `scripts/dev-setup.sh`, then
`scripts/dev.sh`. Main's CI is green (tests, lint, audits, secret scan).

## Production: half deployed

Production runs on the homelab k8s cluster (`terraform/`) with Supabase
Postgres; CI applies everything (`.gitlab-ci.yml`), production steps are
manual buttons on `main`.

| Piece | State |
|---|---|
| Migrations 0010 + 0011 | **Applied** to production |
| API image and the new worker (`tf-apply`) | **Not deployed**: production still runs the API from before Phantom |
| Supabase storage keys (`db-apply`) | **Blocked**: CI's Vault role may not write secret metadata, which the Vault provider does on every update |
| OpenAI key for the worker | In Vault (`secret/deployments/hacksgiving/app`, `openai_api_key`) |
| Staging branch | Behind `main` |

To finish:

1. In the homelab repo `infra/vault-config`, let the hacksgiving CI role
   `create`/`update` `secret/metadata/deployments/hacksgiving/*` (it can
   already write the data paths).
2. On the newest `main` pipeline: `db-plan` -> `db-apply` (writes the
   `storage_*` fields into `<prefix>/db`), then `tf-plan` -> `tf-apply`
   (API, worker, secrets), then `smoke-production`.
3. Smoke test by hand: sign in as a staff account, record one debrief, see it
   reach "Check before saving".

Until step 1, `tf-apply` alone is safe: voice answers "type it instead" and
typed debriefs work.

## Not verified yet

- A real `.m4a` from an iPhone through the whole voice path (each part is
  tested separately; transcription of real speech works).
- The Supabase Storage adapter against a real project (unit tests pin its
  requests; it sends the secret key as both `apikey` and `Authorization:
  Bearer`, like supabase-js).
- Name removal is rules-based and misses bare names with no cue; the app's
  wording says "names we can spot".

## Next work

Easier:
- Staff Notifications screen (Figma S7) and the resident notification ask (R6),
  once push exists.
- Offline: queue a resident's request while offline (Figma E3).
- Restyle Get help's form to the latest Figma (Peter owns the resident flow;
  check with him).

Needs focus:
- **On-call and push notifications** (step 2 of `docs/app-flow.md`): on-call
  shifts or a toggle, push tokens, routing urgent cases to whoever is on call
  with Accept / Pass.
- **Insights from debriefs** (step 3): patterns across records (repeat
  addresses, neighborhoods, times).
- **Training and sharing with partners** (step 4).

## Working agreements

- Commit and push only when asked; never force-push.
- Never print or commit secrets; real ones live in gitignored `.env` files or
  Vault.
- Teammates push to `main` too: rebase before pushing, and take the next free
  migration number on `origin/main`.
