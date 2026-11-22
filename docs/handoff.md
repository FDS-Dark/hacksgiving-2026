# Handoff: where things stand

Last updated 2026-11-22 (on-call + inbox, phase 1). Update this file when you finish a piece of work or
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
- **On call + inbox** (phase 1 of `docs/design/on-call-and-push.md`,
  migrations 0015-0016): shifts and an "On call" switch (Today card, Me,
  schedule at `/staff/oncall`, admins edit), and an in-app notifications inbox
  (`/staff/notifications`, the bell on Today; unread dots on a resident's
  Requests). Assignments, replies, messages, referral changes and tasks due in
  30 min (job `task.remind`) create inbox rows. No push yet.

The design source of truth is the Figma file "Hacksgiving 2027"
(page "App shell v2"). Plan and screen status: `docs/app-flow.md`.

## How it's built

- Backend: FastAPI, router -> service -> databridge -> SQL in stored functions
  (`api/README.md`, ADR 0007). Background work runs in a separate process
  (`python -m worker`) from a job queue in Postgres (ADR 0009).
- App: Expo Router; one service module per API domain under
  `apps/mobile/src/services` (TanStack Query); visual style "C · Light" (white
  cards, hairline borders, green only for primary actions).
- Database: Alembic revisions through **0016** (`0015_oncall_shifts`,
  `0016_notifications`; check `database/migrations/versions` for the rest).
- The worker starts without the OpenAI key: task reminders always run,
  Phantom's stages only with the key.
- Storage for voice audio: S3-compatible locally (SeaweedFS container),
  Supabase Storage's API in production; audio is deleted once transcribed.

## Running it

`AGENTS.md`, section "Run it locally": `scripts/dev-setup.sh`, then
`scripts/dev.sh`. Main's CI is green (tests, lint, audits, secret scan).

The app includes `expo-dev-client` and `expo-notifications` (for push, which
Expo Go can't receive), so `scripts/dev.sh` and `npm start` pass `--go` to
keep Expo Go as the target. Push testing needs a development build signed
for team D36AR26A38 on the Mac mini (`apps/mobile/README.md`).

## iOS push setup (done 2026-11-21)

- APNs auth key `F4DVTY4Q2B` (team D36AR26A38, sandbox + production,
  team-scoped) is in Vault as `apns_key_p8`, `apns_key_id`, `apns_team_id`
  in `secret/deployments/hacksgiving/app` and `.../staging/app`. Nothing reads
  it until phase 2.
- Xcode on the Mac mini is signed in to the team; automatic signing created a
  push + time-sensitive profile for `com.austinkoske.hacksgiving`. Signing
  works in Terminal and in the CI runner (the login session), not over SSH.

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
- Offline: queue a resident's request while offline (Figma E3).
- Restyle Get help's form to the latest Figma (Peter owns the resident flow;
  check with him).

Needs focus:
- **Push and urgent escalation** (phases 2-3 of
  `docs/design/on-call-and-push.md`): APNs sending (direct, no Expo push
  service), device tokens and the resident notification ask (R6), then urgent
  cases offered to whoever is on call with Accept / Pass. Phase 3 needs the
  team's answers to the design doc's questions 1-3 and 5.
- **Insights from debriefs** (step 3): patterns across records (repeat
  addresses, neighborhoods, times).
- **Training and sharing with partners** (step 4).

## Working agreements

- Commit and push only when asked; never force-push.
- Never print or commit secrets; real ones live in gitignored `.env` files or
  Vault.
- Teammates push to `main` too: rebase before pushing, and take the next free
  migration number on `origin/main`.
