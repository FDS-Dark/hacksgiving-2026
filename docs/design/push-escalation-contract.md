# Phases 2 + 3 contract: push (direct APNs) and urgent escalation

The agreed interface for building phases 2 and 3 of
`docs/design/on-call-and-push.md` in parallel. Read that doc's D3, D4, D5
and section 2 for the why; this file fixes the names and shapes. Phase 1
(`docs/design/oncall-phase1-contract.md`, migrations 0015/0016) is merged.

**Team defaults** (the design doc's section 9 questions, decided for now):
pages on priority `high` or `critical`; 5 minutes per step; fallback =
every admin + workers with `urgent_when_off_call`; when nobody accepts,
3 reminders 10 minutes apart; fixed shift blocks with backups (rank 2).

## Migrations

- **0017_push** (push backend agent): `push_devices`,
  `notification_deliveries`, `notifications.expires_at`, kind `test`.
- **0018_urgent_alerts** (escalation backend agent, `down_revision = "0017"`):
  `oncall_alerts`, `oncall_offers`, `notifications.alert_id`, the final kind
  list, `case_updates` type `alert`.

Final `notifications_kind_check` list (0018 replaces 0017's): `assignment`,
`reply`, `request_update`, `task_due`, `referral_update`, `test`,
`urgent_offer`, `urgent_unanswered`. Urgent kinds = the last two.

### 0017

```
app.push_devices
  id uuid pk, token text not null unique, user_id uuid not null → users on delete cascade,
  platform text not null check (platform in ('ios')),           -- android later
  environment text not null check (environment in ('sandbox','production')),
  app_version text, created_at, last_seen_at, disabled_at, disabled_reason text
app.notification_deliveries
  id uuid pk, notification_id → notifications on delete cascade, device_id → push_devices on delete cascade,
  status text check (status in ('pending','sending','sent','failed','skipped')),
  apns_id text, reason text,          -- APNs reason only, never content
  attempts smallint not null default 0, updated_at
  unique (notification_id, device_id)
alter table app.notifications add column expires_at timestamptz   -- apns-expiration for urgent offers
```

Functions (names fixed): `push_device_register(p_user_id, p_token, p_platform,
p_environment, p_app_version)` (upsert by token, moves it to this user, max 10
active per user: oldest disabled), `push_device_remove(p_user_id, p_token)`,
`push_device_disable(p_device_id, p_reason)`, `push_device_list_active(p_user_id)`,
`push_device_prune(p_days)`, `notification_delivery_claim(p_notification_id)`
(rows pending→sending per active device, committed before sending; also
returns rows stuck in `sending`), `notification_delivery_record(...)`,
`notification_delivery_prune(p_days)`, `notification_push_facts(p_notification_id)`
(kind, user, read_at, expires_at, prefs, recent push count, last push on the
same case), `notification_stats(p_since)`.

### 0018

```
app.oncall_alerts
  id uuid pk, case_id → cases on delete cascade,
  status text check (status in ('offering','unanswered','accepted','resolved','cancelled')),
  step smallint not null default 1, step_expires_at timestamptz,
  accepted_by → users, accepted_at, arrived_at, reminders_sent smallint default 0,
  created_at, closed_at
  unique (case_id) where status in ('offering','unanswered')
app.oncall_offers
  id uuid pk, alert_id → oncall_alerts on delete cascade, user_id → users, step smallint,
  offered_at, expires_at,
  outcome text check (outcome in ('pending','accepted','passed','timed_out','superseded')),
  pass_reason text check (pass_reason in ('busy','too_far','not_safe_alone')), responded_at
  unique (alert_id, user_id, step)
alter table app.notifications add column alert_id uuid references app.oncall_alerts(id) on delete cascade
case_updates.update_type gains 'alert' (internal history entries)
```

Functions: `oncall_ladder(p_step, p_alert_id)`, `oncall_alert_open(p_case_id)`,
`oncall_offer_step(p_alert_id, p_step, p_offer_seconds)`,
`oncall_escalate(p_alert_id, p_step)`, `oncall_accept(p_alert_id, p_user_id)`,
`oncall_pass(p_alert_id, p_user_id, p_reason)`, `oncall_arrived(p_alert_id, p_user_id)`,
`oncall_alert_get`, `oncall_alert_list`, `oncall_resolve_for_case(p_case_id, p_status)`,
`oncall_alert_sweep()`, `oncall_stats(p_from, p_to)`, `oncall_remind(...)`.
Accept is one guarded statement on `status IN ('offering','unanswered')`;
first one wins.

## Shared Python interface

`NotificationService.notify(...)` (services/notification.py) gains two
keyword arguments, `alert_id: UUID | None = None` and
`expires_at: datetime | None = None`, and **queues the `notification.push`
job** (dedupe key `notification:{id}`) in the same transaction whenever it
creates a row. The push backend agent adds the job queueing and
`expires_at`; the escalation agent adds `alert_id` (small, targeted edits;
re-read before editing).

Rendering in the inbox (escalation agent adds these two kinds to the
renderer; route for both is `/staff/alerts/{alert_id}`):

| kind | title | body |
|---|---|---|
| `urgent_offer` | `Urgent: {case title}` | `You're on call. Open it to accept or pass.` (the app shows the live countdown) |
| `urgent_unanswered` | `Nobody has accepted #{n}` | `{case title}` |
| `test` (push agent) | `Test notification` | `Push works on this phone.` route `null` |

`NotificationItem` gains `alert_id: uuid | null`.

## Phase 2: push (push backend + push mobile agents)

**Settings** (`settings.py`, `APP__PUSH__*`): `provider` = `off` (default:
inbox only) | `fake` | `apns`; `apns_key` (the .p8 contents) or
`apns_key_path`; `apns_key_id`; `apns_team_id`; `apns_topic` (default
`com.austinkoske.hacksgiving`). The worker logs a warning and treats push as
`off` when `apns` is chosen but the key is missing.

**Adapter** `adapters/push.py`: `PushProvider` protocol
`send(device, message) -> PushResult(status_code, reason, apns_id)`;
`ApnsPushProvider` (httpx HTTP/2 — add the `h2` dependency via
`httpx[http2]`; hosts `api.push.apple.com` / `api.sandbox.push.apple.com` by
the device's environment; ES256 JWT with `kid`/`iss`/`iat`, cached and
renewed at 50 minutes; headers per D4); `FakePushProvider` (records
messages; scriptable results).

**Payload** (D5; `data` keys outside `aps`): `n` = notification id; `u` = 1
for urgent kinds. Titles/bodies exactly:

| kinds | title | body | priority | extras |
|---|---|---|---|---|
| urgent_offer | Urgent request | You're on call. Open the app to respond. | 10 | interruption-level time-sensitive, sound default, apns-expiration = notification.expires_at |
| urgent_unanswered | Urgent request waiting | Nobody has accepted yet. | 10 | time-sensitive, sound |
| assignment / reply / task_due / referral_update | New assignment / New reply / Task due soon / Referral update | Open the app to see it. | 5 | badge = unread count |
| request_update (resident) | — (no title) | You have a new update. | 5 | no sound, no badge |
| test | Test notification | Push works on this phone. | 10 | sound |

`apns-collapse-id` = notification id; `thread-id` = `urgent` or `updates`.

**Job `notification.push`** (D4 steps): skip when read, muted, push off, no
devices; non-urgent only: quiet hours (prefs + `users.timezone`, falling
back to `APP__ONCALL__TIMEZONE` when it's `UTC`) defer via a job keyed
`notification:{id}:after-quiet`, coalesce (same user + case pushed < 2 min
ago), cap 20/hour. Claim deliveries, send, record. 410 / `BadDeviceToken` /
`DeviceTokenNotForTopic` → disable the device; 429/5xx/network → raise to
retry (rows back to pending); 403 token errors → renew the JWT once, then
fail and log ERROR. No receipts job.

**API** (`routers/notification.py` or a `push` router, agent's choice):
- `PUT /v1/me/devices` `{token, platform: "ios", environment: "sandbox"|"production", app_version?}` → 204
- `DELETE /v1/me/devices/{token}` → 204
- `POST /v1/notifications/test` → 202 (a `test` notification for the caller;
  3 per 10 minutes per user → 429 `rate_limited`)
- `GET /v1/notifications/stats` (admin) → deliveries by status in the last
  24 h, disabled devices, top APNs reasons.

**Upkeep**: prune devices unseen 60 days, deliveries older than 30 days.

**Terraform** (`terraform/worker.tf`): the worker's ExternalSecret maps
`apns_key_p8` → `APP__PUSH__APNS_KEY`, `apns_key_id` → `APP__PUSH__APNS_KEY_ID`,
`apns_team_id` → `APP__PUSH__APNS_TEAM_ID`, and sets `APP__PUSH__PROVIDER=apns`
and the topic per environment (staging: `com.austinkoske.hacksgiving.staging`).
Both Vault paths already hold these fields. `tofu fmt -check` and `validate`.

**Mobile (push mobile agent)**:
- `src/lib/push.ts`: does nothing in Expo Go
  (`Constants.executionEnvironment === 'storeClient'`) or on web/simulator
  without push; asks permission at the right moments; `getDevicePushTokenAsync()`
  for the raw APNs token; environment from
  `Application.getIosPushNotificationServiceEnvironmentAsync()` (expo-application;
  `development` → `sandbox`); registers on sign-in and every launch, re-registers
  on `addPushTokenListener`; removes the device on sign-out **before** the
  session is cleared (`lib/auth.tsx`).
- Foreground handler: show a banner only when `data.u == 1`; always invalidate
  the `notifications` and `oncall` queries. Tap → `GET /v1/notifications/{id}`
  → `router.push(route)` (no route → `/staff/notifications` for staff).
- Permission moments: staff when they switch on call (and a Me row
  "Notifications: On/Off/Not allowed" that opens settings); residents via the
  **R6 screen** (`/help/notifications`) shown once after their first request
  is sent while signed in.
- Resident Me (R5): "Replies and updates" switch = `request_update` not in
  `muted_kinds`. No "hide message text" switch (always hidden). No community alerts.
- Staff Me: "Send a test notification" row (`POST /notifications/test`).
- Service functions go in `src/services/notifications.ts` (devices, test).

## Phase 3: urgent escalation (escalation backend + escalation mobile agents)

**What pages**: `pages_on_call(case)` in `models/case_enums.py` = open
(`new`/`in_progress`/`awaiting_resources`), unassigned, priority `high` or
`critical`. Entry points open the alert in the **same transaction** as the
case write (`OncallService.open_for_case(tx, case)`): resident requests
(signed in and by code: make `submit_*` one transaction), `POST /cases`,
`PATCH /cases/{id}` raising priority or unassigning. Record confirm assigns
its author, so it doesn't page. Voice never pages. A sweeper in upkeep opens
alerts for matching cases from the last 24 h that have none.

**Ladder**: step 1 = rank-1 shifts now; step 2 = rank-2 shifts now, else whoever's
shift starts next within 12 h; step 3 = admins + workers with
`urgent_when_off_call`. Skip people already offered on this alert and steps
with nobody new. Settings `APP__ONCALL__OFFER_SECONDS=300`,
`APP__ONCALL__REMIND_SECONDS=600`, `APP__ONCALL__MAX_REMINDERS=3`.

**Jobs**: `oncall.offer` (`alert:{id}:offer:{step}`): offers + `urgent_offer`
notifications (`expires_at` = offer expiry, dedupe `offer:{offer_id}`) +
queue `oncall.escalate` (`alert:{id}:escalate:{step}`, run_at = step expiry).
Escalate: no-op unless still `offering` at that step; time out pending
offers, next step, or → `unanswered` and queue `oncall.remind`
(`alert:{id}:remind:{n}`): new `urgent_unanswered` rows for admins
(dedupe `unanswered:{alert}:{n}`), n ≤ 3, no-op once accepted/closed.

**Accept**: alert `accepted` (by, at); offer accepted, others superseded;
case assigned to the acceptor, `new` → `in_progress`; history: `assignment`
plus an internal `alert` entry ("Accepted on call after 2:10, step 1"). Any
staff may accept while `offering` or `unanswered`. Second accept → 409
`already_accepted` with `{accepted_by_name}` in the message.
**Pass** (`{reason?}`): outcome passed; all pending offers in the step passed →
escalate now (same transaction, step + 1, new offer job).
**Arrived**: `arrived_at`, history entry "On scene". Only the acceptor.
**Resolve**: assigning by hand → `resolved`; case resolved/closed → `cancelled`
(`CaseService.update` calls `OncallService.resolve_for_case`).

**API** (`routers/oncall.py`, staff only):
- `GET /v1/oncall/alerts?open_only=true` → `OncallAlert[]`
- `GET /v1/oncall/alerts/{id}` → `OncallAlertDetail`
- `POST /v1/oncall/alerts/{id}/accept` → `OncallAlertDetail`; `/pass` `{reason?: "busy"|"too_far"|"not_safe_alone"}` → `OncallAlertDetail`; `/arrived` → `OncallAlertDetail`
- `GET /v1/oncall/stats?from=&to=` (admin) → `OncallStats`

```json
OncallAlert {
  "id", "case_id", "case_number", "case_title", "category", "priority",
  "status": "offering"|"unanswered"|"accepted"|"resolved"|"cancelled",
  "step", "step_expires_at", "created_at", "accepted_by": uuid|null,
  "accepted_by_name": str|null, "accepted_at", "arrived_at",
  "my_offer": { "id", "step", "expires_at", "outcome" } | null,
  "next_name": str|null                     // who it goes to if this step runs out
}
OncallAlertDetail = OncallAlert + {
  "description", "location", "latitude", "longitude",
  "contact_method", "safe_to_contact"       // never contact details
}
OncallStats {
  "alerts", "accepted", "unanswered", "avg_seconds_to_accept": float|null,
  "avg_seconds_to_arrive": float|null, "passes_by_reason": {"busy": n, ...}
}
```

**Mobile (escalation mobile agent)**, Figma Mockups flow 3 and S7:
- `/staff/alerts/[id]`: **Respond** — red header "Urgent · {category}",
  title, map (`PinMap`), distance computed on the device from
  `services/deviceLocation.ts` and the case coordinates (never sent),
  "What we know" (description), countdown from `my_offer.expires_at`
  ("Moves to {next_name} in 4:32"), a 911 line + **Call 911** (`lib/phone.ts`),
  **Accept and head there**, **Pass to next on call** (optional reason).
  **Responding** (after accept, for the acceptor) — "Accepted" badge,
  location, the service playbook's first steps if one exists, **Call 911**,
  **I've arrived**. Someone else accepted → "Taken by {name}".
- Today: a red banner per open alert (offering/unanswered) → its screen;
  unanswered says "Nobody has accepted #n".
- S7 (`/staff/notifications`): open alerts with my pending offer on top,
  with inline **Accept** / **Pass**.
- Insights: "Average response" from `oncall/stats` (time to accept).
- Hooks in `src/services/oncall.ts` (alerts list/detail/accept/pass/arrived/stats);
  refetch open alerts every 15 s while Today is focused.
