# Handoff: where things stand

Last updated 2026-11-21 (resident lane: weather, offline, beds, community alerts, signed-out push). Update this file when you finish a piece of work or
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
- **Phone agent** (teammates' work, `api/routers/voice.py`,
  `docs/voice/`): phone calls via ElevenLabs, handed off to the app with a code.
  Branch `extra-implement-ava` adds safe callback plans, 24-hour structured
  dropped-call recovery, district-level Awareness summaries, referral check-in
  scheduling, source-verification labels and a connection funnel. It still
  stores no recording, transcript, raw caller number or exact address.
- **Opportunities** (teammates' work, migration 0010): volunteer and job
  listings for residents and staff.
- **On call + inbox** (phase 1 of `docs/design/on-call-and-push.md`,
  migrations 0015-0016): shifts and an "On call" switch (Today card, Me,
  schedule at `/staff/oncall`, admins edit), and an in-app notifications inbox
  (`/staff/notifications`, the bell on Today; unread dots on a resident's
  Requests). Assignments, replies, messages, referral changes and tasks due in
  30 min (job `task.remind`) create inbox rows.
- **Push + urgent escalation** (phases 2-3, migrations 0017-0018): pushes go
  straight to APNs from the worker (`adapters/push.py`, job
  `notification.push`; generic lock-screen text only). An open, unassigned
  high/critical case opens an alert: offered to the primary on call, then the
  backup or next shift, then every admin (5 min per step), with Accept / Pass
  on `/staff/alerts/[id]`, red banners on Today and 3 reminders when nobody
  accepts. Response times show in Insights.
- **Resident lane** (migration 0020):
  - Weather: Home shows the most severe NWS alert in effect (cold or heat
    links to shelter on Nearby); Safety alerts lists them. The worker acts on
    each alert once: cold or heat at Moderate+ gives every open
    homelessness case a "Check in" task due in 3 h (`services/weather_jobs.py`).
  - Community alerts (Figma R5): opt-in, off by default (resident Me,
    `/v1/me/community-alerts`); a serious alert pushes "Weather alert ·
    Open the app for details", silent, respecting quiet hours.
  - Offline queue (Figma E3): a request that can't reach the API is kept in
    SecureStore and resent on launch, foreground and every 30 s.
  - Bed counts (Figma R3): staff set tonight's open beds on a place's page;
    residents see them for 24 h. Home's Shelter tile shows the total, Jobs
    shows postings new this week.
  - Push for requests sent without an account (design question 7, decided
    yes): "Notify me on this phone" on Request received subscribes with the
    number and code (max 3 phones). Generic silent text; payload `r` opens
    the request.

- **Case places and patterns** (branch `feat/ava-pages-oncall`, migration
  0020): the worker's upkeep places each case (`services/place.py`): its own
  coordinates, else a street or intersection in its location text through
  the City of Milwaukee's locator (only the block is sent), else a named
  neighborhood. `app.case_places` holds the rounded point, police district,
  tract and neighborhood; `app.cases` is never changed. `GET /v1/insights`
  filters by period and district and words the patterns.
- **Phone agent pages on call** (same branch): `POST /v1/voice/requests` takes
  `urgency: "urgent"` (needs someone today, nobody in danger now), which
  makes the case high priority and opens an on-call alert. This reverses
  D3's "voice never pages" (agreed 2026-11-21; routine requests still never page);
  `APP__VOICE__URGENT_PAGES_ON_CALL=false` turns it off. The ElevenLabs
  `submit_comforce_request` tool needs the new `urgency` parameter
  (`docs/voice/agent-prompt.md`).
- **Partners, sharing, texts, need vs coverage** (branch `feat/lane-c-rest`,
  stacked on `feat/ava-pages-oncall`, migration 0021):
  - Partners (`/staff/partners`, `/v1/partners`, Figma P1): staff add and
    edit them; `accepts_shares` marks those with a data-sharing agreement.
  - Sharing a case (Referrals tab, `/v1/cases/{id}/shares`, Figma P2): only
    with a partner that accepts shares, only once the person agreed (how is
    recorded), the summary plus only what they agreed to. Logged in
    `app.case_shares` and the case history; revocable. The API doesn't
    send anything: it returns the message, and the app opens the worker's
    email (or the share sheet).
  - Texts to requesters (`services/text.py`, in the worker's upkeep): for
    cases where the requester chose text and said it's safe, on the request
    coming in, a staff message or a status change. Always generic ("there's
    an update on request #1048"), at most one per 30 minutes per case.
    Off unless `APP__SMS__PROVIDER=twilio` (with `APP__SMS__TWILIO_*` and
    `APP__SMS__FROM_NUMBER` in Vault) or `fake` (logs). There's no email:
    Get help has no "email me" choice yet.
  - Need vs coverage (`/staff/areas`, `GET /v1/insights/coverage`): CDC
    PLACES need by tract, ComForce cases of the matching service placed
    there, and reviewed incidents (under 5 left out); gaps listed.
  - Resident `/alerts` points to Me > Phone calls for phone-agent follow-ups
    instead of listing them a second time.
  - `database/seeds/local/20_demo_story.sql`: three weekend-night requests
    at N 27th St & W Center St, for "Pattern spotted" in the demo.

The design source of truth is the Figma file "Hacksgiving 2027"
(page "App shell v2"). Plan and screen status: `docs/app-flow.md`.

## How it's built

- Backend: FastAPI, router -> service -> databridge -> SQL in stored functions
  (`api/README.md`, ADR 0007). Background work runs in a separate process
  (`python -m worker`) from a job queue in Postgres (ADR 0009).
- App: Expo Router; one service module per API domain under
  `apps/mobile/src/services` (TanStack Query); visual style "C · Light" (white
  cards, hairline borders, green only for primary actions).
- Database: Alembic revisions through **0029** (`0015_oncall_shifts`,
  `0016_notifications`, `0017_push`, `0018_urgent_alerts`,
  `0019_resident_lane`, `0020_case_places`, `0021_partners_and_outreach`,
  `0022_case_debriefs` through `0028_training_progress`, and
  `0029_voice_safety_and_follow_up`).
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
  in `secret/deployments/hacksgiving/app` and `.../staging/app`. The worker
  reads it through its own optional ExternalSecret (`terraform/worker.tf`);
  without it push is off, the worker still runs.
- Xcode on the Mac mini is signed in to the team; automatic signing created
  push + time-sensitive profiles for `com.austinkoske.hacksgiving` and
  `.staging`. Signing
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

- Migration 0015 on a real Postgres instance. This branch's environment had
  no Docker/Postgres command, so API unit tests cover its service contracts but
  `test_migrations.py` was skipped. Run the full integration suite before merge.
- The existing ElevenLabs agent has redacted DTMF enabled for keypad follow-up.
  The new Awareness/checkpoint tools must remain unattached until migration
  0015 and this branch's API endpoints are deployed.

- A real `.m4a` from an iPhone through the whole voice path, locally or in
  production (each part is tested separately; transcription of real speech
  works). The first production debrief is the test: record one as staff and
  check it reaches "Check before saving".
- The Supabase Storage adapter against a real project (unit tests pin its
  requests; it sends the secret key as both `apikey` and `Authorization:
  Bearer`, like supabase-js).
- The resident lane on a real phone: community alert and signed-out
  request pushes need the signed build; the weather sweep needs an active
  NWS alert (seed one in `app.weather_alerts` to demo).
- Name removal is rules-based and misses bare names with no cue; the app's
  wording says "names we can spot".

## Next work

Easier:
- Get help's form already matches Figma A2 (checked 2026-11-21); nothing to
  restyle unless the design changes.

Needs focus:
- **Verify push on a real phone**: deploy, install a signed build
  (`ios-device-production`), then Me -> "Send a test notification". Escalation
  defaults (high+critical page, 5 min steps, admins as fallback, 3 reminders)
  are in `docs/design/push-escalation-contract.md`; change them there and in
  `APP__ONCALL__*` if the team decides otherwise.
- **Insights from debriefs** (step 3): patterns across records (repeat
  addresses, neighborhoods, times).
- **Training and sharing with partners** (step 4).

## Working agreements

- Commit and push only when asked; never force-push.
- Never print or commit secrets; real ones live in gitignored `.env` files or
  Vault.
- Teammates push to `main` too: rebase before pushing, and take the next free
  migration number on `origin/main`.
