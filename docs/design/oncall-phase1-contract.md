# Phase 1 contract: on-call + in-app inbox (no push)

The agreed interface between the backend and the app for phase 1 of
`docs/design/on-call-and-push.md` (read D1, D2 and D6 there for the why).
Backend and app are built in parallel against this file. If you must
deviate, keep the deviation small and say so in your report.

Phase 1 has **no push, no urgent alerts, no devices**. It works in Expo Go.

## Conventions (from the repo)

- Layering router → service → databridge → `app.<domain>_<verb>` SQL
  functions (ADR 0007, `api/README.md` "Adding a resource").
- Migrations: Alembic revision `.py` + `.sql` pair like
  `database/migrations/versions/0012_voice_referral_history.*`
  (`revision = "0015"`, `down_revision = "0014"`; downgrade drops the
  functions listed in `FUNCTIONS` and the tables). Grants follow the earlier
  revisions (the app role may only EXECUTE functions; check 0011/0012 for
  the exact pattern, incl. `SECURITY DEFINER` and `search_path`).
- Times are `timestamptz`, sent as ISO 8601 with offset. The org time zone
  is `America/Chicago` (setting `APP__ONCALL__TIMEZONE`, default that).
- Staff = role `worker` or `admin`. Members are residents.

## Migrations

- **0015_oncall_shifts** (owner: oncall backend agent)
- **0016_notifications** (owner: notification backend agent;
  `down_revision = "0015"`)

### 0015: `app.oncall_shifts`

```
id uuid pk default gen_random_uuid()
user_id uuid not null references app.users(id) on delete cascade
starts_at timestamptz not null
ends_at timestamptz not null, check (ends_at > starts_at)
rank smallint not null default 1 check (rank in (1, 2))
source text not null check (source in ('schedule', 'toggle'))
created_by uuid references app.users(id) on delete set null
created_at, updated_at timestamptz not null default now()
index (starts_at, ends_at), index (user_id, ends_at)
```

Rules (in SQL): no overlapping shifts for the same user (save → returns
nothing / raises a recognisable error the service maps to 409
`shift_overlap`); the user must be staff (422 `not_a_worker`).

Functions (names fixed; signatures up to the agent):
`oncall_now(p_at)`, `oncall_shift_list(p_from, p_to)`,
`oncall_shift_save(p_id NULL=create, p_user_id, p_starts_at, p_ends_at, p_rank, p_source, p_actor_id)`,
`oncall_shift_delete(p_id)`, `oncall_toggle(p_user_id, p_on, p_until, p_default_until)`.

### 0016: `app.notifications`, `app.notification_preferences`

```
app.notifications
id uuid pk
user_id uuid not null references app.users(id) on delete cascade
kind text not null check (kind in ('assignment','reply','request_update','task_due','referral_update'))
   -- phase 3 adds urgent_offer, urgent_unanswered: write the check so a later
   -- migration can replace it (named constraint notifications_kind_check)
case_id uuid references app.cases(id) on delete cascade
case_update_id uuid references app.case_updates(id) on delete cascade
task_id uuid references app.tasks(id) on delete cascade
actor_id uuid references app.users(id) on delete set null
dedupe_key text not null
created_at timestamptz not null default now()
read_at timestamptz
unique (user_id, dedupe_key)
index (user_id, created_at desc); partial index (user_id) where read_at is null

app.notification_preferences
user_id uuid pk references app.users(id) on delete cascade
push_enabled bool not null default true
muted_kinds text[] not null default '{}'
quiet_start time, quiet_end time
urgent_when_off_call bool not null default false
updated_at timestamptz not null default now()
```

No message text is stored in `notifications`: rows hold references; the
list function joins to build what the reader may see (D6).

Functions: `notification_create` (ON CONFLICT (user_id, dedupe_key) DO
NOTHING), `notification_list(p_user_id, p_before, p_limit)`,
`notification_get`, `notification_unread_count`, `notification_read`,
`notification_read_all(p_user_id, p_case_id NULL=all)`,
`notification_preferences_get`, `notification_preferences_save`,
`notification_prune(p_days)`.

## API

All under `/v1`, Auth0 bearer token, the usual error body.

### On call (`routers/oncall.py`, staff only → 403 for members)

**`GET /oncall/now`** → `OncallNow`
```json
{
  "on_call": [ OncallShift, ... ],          // shifts covering now, rank 1 first
  "next": OncallShift | null,                // first shift starting after now within 12 h, not held by someone on now
  "me": { "on_call": true, "shift": OncallShift | null }
}
```

**`OncallShift`**
```json
{ "id": "uuid", "user_id": "uuid", "display_name": "Maria Santos" | null,
  "starts_at": "…", "ends_at": "…", "rank": 1, "source": "schedule" | "toggle" }
```

**`POST /oncall/me`** body `{ "on": bool, "until": datetime | null }` → `OncallNow`
- `on: true`, no current shift of mine → create a `toggle` shift from now
  to `until`, or by default to the next boundary among 07:00, 17:00, 23:00
  org time (the A3 shift blocks). `until` must be in the future and within
  24 h (422 `invalid_until`).
- `on: true`, I already have a current shift → if `until` given, set its
  `ends_at`; otherwise no change.
- `on: false` → end my current shift(s) now (`ends_at = now()`). No-op if none.

**`GET /oncall/shifts?from=&to=`** → `OncallShift[]` overlapping the range,
ordered by `starts_at`, rank. Range at most 31 days (422 otherwise).

**Admin only:** `POST /oncall/shifts` `{user_id, starts_at, ends_at, rank?=1}`
→ 201 `OncallShift` (source `schedule`); `PATCH /oncall/shifts/{id}`
(any of those fields) → `OncallShift`; `DELETE /oncall/shifts/{id}` → 204.
Errors: 404 `shift`, 409 `shift_overlap`, 422 `not_a_worker`.

### Inbox (`routers/notification.py`, any signed-in user)

**`GET /notifications?before=<iso created_at>&limit=<1..100, default 50>`** →
`NotificationItem[]`, newest first, only the caller's.

**`NotificationItem`**
```json
{ "id": "uuid", "kind": "assignment", "title": "Devon assigned you #1044",
  "body": "Ride to dialysis tomorrow", "case_id": "uuid" | null,
  "case_number": 1044 | null, "task_id": "uuid" | null,
  "route": "/staff/cases/<case_id>",          // where the app navigates
  "created_at": "…", "read_at": null | "…" }
```

Rendering (service, from the facts the list function returns):

| kind | for | title | body | route |
|---|---|---|---|---|
| `assignment` | staff | `{actor} assigned you #{n}` (actor name or "Someone") | case title | `/staff/cases/{case_id}` |
| `reply` | staff | `{contact_name or "The requester"} replied on #{n}` | reply text, first 120 chars, in quotes | `/staff/cases/{case_id}` |
| `task_due` | staff | `Task due soon` | `{task title} · #{n}` | `/staff/cases/{case_id}` |
| `referral_update` | staff | `Referral {status}` (e.g. "Referral accepted") | `{resource name} · #{n}` | `/staff/cases/{case_id}` |
| `request_update` | resident | `ComForce replied` for a message, `Your request was updated` for a status change | message text (120 chars) or `Status: In progress` | `/help/request/{case_id}` |

A resident's item must never include internal notes or staff names.

**`GET /notifications/unread-count`** → `{ "count": 3 }`
**`GET /notifications/{id}`** → `NotificationItem`, marks it read. 404 if not mine.
**`POST /notifications/{id}/read`** → 204.
**`POST /notifications/read-all`** body `{ "case_id": uuid | null }` → `{ "updated": n }`
(the app calls it with `case_id` when a case or request screen opens).

**`GET /me/notification-preferences`** → `NotificationPreferences`
**`PATCH /me/notification-preferences`** (any field) → `NotificationPreferences`
```json
{ "push_enabled": true, "muted_kinds": [], "quiet_start": "21:00" | null,
  "quiet_end": "07:00" | null, "urgent_when_off_call": false }
```

## What creates notifications (notification backend agent)

`NotificationService.notify(...)`, called inside the same transaction as the
change (`executor.transaction()` + `databridge.within(tx)`). Never notify the
person who acted.

| Event | Where today | Recipient | dedupe_key |
|---|---|---|---|
| Case assigned (PATCH sets `assigned_worker_id`) | `CaseService.update` | new assignee, if not the actor | `assignment:{case_update_id}` |
| Resident reply (signed in or by code) | `CaseService._add_reply` | case assignee (none → no row) | `reply:{case_update_id}` |
| Staff public message, or status change on a case with a `requester_id` | `CaseService.add_update` / `update` | requester (accounts only) | `update:{case_update_id}` |
| Referral status changed | `CaseService.update_referral` | case assignee, if not the actor | `referral:{case_update_id}` (or the referral id + status if there is no update row) |
| Task due in 30 min | job `task.remind` | task assignee, else case assignee | `task_due:{task_id}:{due_at}` |

`task.remind`: queued whenever a task is created or its due time or assignee
changes, `run_at = due_at − 30 min` (now if that's past and the task isn't
overdue by more than 30 min), dedupe key `task:{id}:remind:{due_at}`. When
it runs: no-op if the task is done, its `due_at` changed, or it has no owner.
Planned tasks for new cases get one too.

## Worker (notification backend agent)

- The worker must start **without** `APP__OPENAI__API_KEY`: Phantom's stages
  register only when the key is set (log a warning); `task.remind` always.
- Upkeep prunes notifications older than 90 days.

## App screens (mobile agent)

Figma "Hacksgiving 2027", page "App shell v2"; style "C · Light".

- **Today** (`/staff`, Figma 26:122): "You're on call" card with a switch,
  "Until 11 PM · Devon is next in line" (or "Nobody is on call" / "You're
  off call · Maria is on until 11 PM"). A bell with the unread count in the
  header → `/staff/notifications`.
- **Me** (`/staff/me`, 26:221): section **Shift**: "On call" switch with
  "Until 11 PM"; "Urgent alerts" switch = `urgent_when_off_call`, footnote
  "Also alert me about urgent cases when I'm off call". Manage → "On-call
  schedule" row → `/staff/oncall`.
- **On-call schedule** (`/staff/oncall`, A3 33:2614): a 7-day strip, the
  day's shifts (time range, avatar initials, name, "On call now" on the
  current one). Admins see "Edit": add / change / delete a shift (person,
  start, end, primary or backup). Leave out A3's "If nobody accepts" card
  until phase 3.
- **Notifications** (`/staff/notifications`, S7 33:2390): "Mark read" in the
  header, groups "Today" and "Earlier", rows with an icon per kind, title,
  body and time; unread rows marked; tap → `route`. No urgent card yet.
- **Resident**: an unread dot on a request in Requests (from unread items
  with that `case_id`), and opening a request calls `read-all` with its
  `case_id`. No resident inbox screen.
- Services: `src/services/oncall.ts`, `src/services/notifications.ts`
  (ADR 0008 / `apps/mobile/AGENTS.md`). Opening a case calls `read-all` with
  its `case_id`.
