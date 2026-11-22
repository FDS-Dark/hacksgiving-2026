# Handoff: where things stand

Last updated 2026-11-22 (after the production deploy). Update this file when you finish a piece of work or
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
  Branch `extra-implement-ava` adds safe callback plans, 24-hour structured
  dropped-call recovery, district-level Awareness summaries, referral check-in
  scheduling, source-verification labels and a connection funnel. It still
  stores no recording, transcript, raw caller number or exact address.
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

## Production

Production runs on the homelab k8s cluster (`terraform/`) with Supabase
Postgres; CI applies everything (`.gitlab-ci.yml`), production steps are
manual buttons on `main` (`migrate-production`, `db-apply`, `tf-apply`; a
pipeline's `tf-apply` needs that same pipeline's `migrate-production` run
first, which is a no-op when migrations are current).

Deployed 2026-11-22: migrations through 0011, the API with Phantom, the
worker Deployment, and the storage and OpenAI secrets (smoke test passed).
The storage key lives in the runtime secret `<prefix>/db` as `storage_*`
(database/terraform writes it; CI's database Vault role may update its
metadata since vault-config MR !18). Staging's branch is behind `main`:
merge `main` into `staging` to deploy it.

CI runners sometimes drop connections (a `tf-apply` once failed fetching
`curl`/`jq` from Alpine's mirror); retry the job.

## Not verified yet

- Migration 0015 on a real Postgres instance. This branch's environment had
  no Docker/Postgres command, so API unit tests cover its service contracts but
  `test_migrations.py` was skipped. Run the full integration suite before merge.

- A real `.m4a` from an iPhone through the whole voice path, locally or in
  production (each part is tested separately; transcription of real speech
  works). The first production debrief is the test: record one as staff and
  check it reaches "Check before saving".
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
