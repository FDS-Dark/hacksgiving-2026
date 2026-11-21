# Case management: API contract

ComForce MKE workers handle community requests for help and incidents as
**cases**: triage (priority, category), assign, keep notes, refer the person
to community resources, and resolve. This page is the contract for any
screen that uses it.

> **Frontend status:** the staff app is at `/staff` (`apps/mobile/src/app/staff`).
> The tab bar, Today and Me follow the Figma "App shell v2" frames; Queue,
> case detail and New case keep their earlier layouts for now. Workers and admins land
> there after signing in. It has its own tab bar: Today, Queue, Record (a
> new case for now), Map and Me, with Team & roles and Insights under
> Me → Manage. The service playbooks (`lib/playbooks.ts`) show on a case and
> when the queue is filtered to one service. The resident app (Home, Requests,
> Nearby, Me) is under `(main)`; asking for help and a request's thread are
> under `/help`, which also works signed out.

All paths are under `/v1`, need a signed-in Auth0 access token
(`Authorization: Bearer …`), and return the usual error body
`{"code", "message", "request_id"}`. The full schemas are in
`apps/mobile/openapi.json` and the generated `apps/mobile/src/api/schema.ts`.
Types by name: `apps/mobile/src/api/types.ts`. Ready-made TanStack hooks,
one module per domain: `apps/mobile/src/services/` (`cases.ts`, `staff.ts`,
`resources.ts`, `tasks.ts`, `requests.ts`).

## Who can do what

| Role (`app.users.role`) | Can |
|---|---|
| `member` (everyone who signs in) | Submit requests, read **their own** requests and the updates staff shared, browse resources |
| `worker` | Everything under `/v1/cases`, add resources, see the team |
| `admin` | A worker who also manages roles (`/v1/staff/users`) |

**Setting up staff:** on a fresh deployment, the first person to press
"Claim staff admin" on `/staff` (`POST /v1/staff/bootstrap`) becomes an
admin. It returns 409 once anyone is staff. From then on admins promote
people under Me → Team & roles. Someone has to sign in once before they
show up there.

## For the community app: requests for help

### `POST /v1/requests` → 201 `PublicRequest`

```json
{
  "description": "My family was evicted today and we have nowhere to sleep. Two kids.",
  "title": "optional, made from the description when left out",
  "category": "optional: homelessness | meal_programs | transportation | violence_prevention | incident_deescalation | missing_persons | burial_assistance | bridge_to_employment | other",
  "location": "optional free text, e.g. N 35th St & W Center St",
  "latitude": 43.07, "longitude": -87.95,
  "contact_name": "optional", "contact_phone": "optional", "contact_email": "optional",
  "contact_method": "optional: call | text | none (call and text need contact_phone)",
  "safe_to_contact": "optional: true when it's safe to call or leave a voicemail (or to text)"
}
```

- `contact_method: "none"` ("Don't contact me") drops any phone or email sent with it.
- Each new request gets its first **tasks** (see below).

- Who asked comes from the token, never from the body.
- `priority`, `status`, `assigned_worker_id` or any other unknown field → **422**.
  Workers set those.
- Leave `category` out to let the API sort the request with the AI router
  (`/v1/route`), when an OpenAI key is configured. An urgent request then
  gets high priority. Without a key, or if the router fails or takes more
  than 8 s, the request still goes in, as `other`.
- Contact details are stored for staff only and never come back to the
  requester.

Response (also each item of `GET /v1/requests`):

```json
{ "id": "uuid", "number": 1042, "title": "…", "description": "…", "category": "homelessness",
  "status": "new", "location": "…", "created_at": "…", "updated_at": "…", "resolved_at": null }
```

### `GET /v1/requests` → `PublicRequest[]`
The caller's own requests, newest first.

### `GET /v1/requests/{id}` → `PublicRequestDetail`
`{ "request": PublicRequest, "updates": [{ "id", "update_type", "content", "created_at" }] }`.
The only updates included are public ones: "Request received.", status changes and
messages a worker chose to send. Internal notes, assignees, referrals and who wrote
something are never included. Another person's request → 404.

### `POST /v1/requests/{id}/replies` → 201 `PublicRequestUpdate`
`{"content"}`: the requester answers on their own request (`update_type: "reply"`,
seen by them and in the worker's case history). Another person's request → 404.

### Without an account: `/v1/public/requests` (no token)
An emergency shouldn't wait on a sign-in, so a resident can ask for help signed out.

| Method and path | What it does |
|---|---|
| `POST /public/requests` | Same body as `POST /requests`. 201 `{"request": PublicRequest, "access_code": "K7QM-4XPA"}`. The code is shown once; only its SHA-256 is stored |
| `GET /public/requests/{number}` + header `X-Access-Code` | `PublicRequestDetail`. A wrong number or code is the same 404 |
| `POST /public/requests/{number}/replies` + `X-Access-Code` | `{"content"}`, as above |

The phone navigator uses the same anonymous workflow through
`POST /v1/voice/requests`, protected by the server-side voice tool secret. It
submits only fields the caller reviewed and explicitly approved. The resulting
request appears in the normal staff case queue; the structured call review
links to it without storing audio or a transcript.

Rate limited per client address (`services/rate_limit.py`, in memory per API
replica): 5 submissions an hour, 60 code lookups or replies per 10 minutes;
over that → 429 `rate_limited`. The app keeps the code on the device
(`lib/savedRequests.ts`), so "My requests" opens it without typing it.

### `GET /v1/resources?q=&category=` → `Resource[]`
The resource directory, for any signed-in user. Rows with `"is_sample": true` are
demonstration data (fictional 555 numbers), not real services; show them as such
or leave them out.

## For workers: the case API (staff only, 403 otherwise)

| Method and path | What it does |
|---|---|
| `GET /cases?status=&priority=&category=&kind=&assigned_worker_id=&unassigned=&open_only=&q=&limit=&offset=` | The queue. Open cases first, then critical → low, then newest. `q` matches `#number`, title, description, location |
| `POST /cases` | Open a case (`CreateCaseRequest`: title, description, kind `request`/`incident`, category, priority, location, contact, assigned_worker_id) |
| `GET /cases/{id}` | `CaseDetail`: the case, its full history, its referrals |
| `PATCH /cases/{id}` | Any of title, description, kind, category, priority, status, location, `assigned_worker_id` (send `null` to unassign). Each change is written to the history |
| `POST /cases/{id}/updates` | `{"content", "visibility": "internal" \| "public"}`. Internal is a note; public is a message the requester sees |
| `POST /cases/{id}/referrals` | `{"resource_id", "status"?}`. 409 if the resource is already on the case |
| `PATCH /cases/{id}/referrals/{referral_id}` | `{"status"?: suggested \| shared \| accepted \| completed \| declined, "outcome"?}` |
| `GET /tasks?mine=&case_id=&open_only=&limit=` | Tasks by due time. `mine`: tasks assigned to the caller, and unassigned tasks on cases they hold |
| `PATCH /tasks/{id}` | `{"status"?: open \| done, "assigned_worker_id"?}` (`null` hands it back to whoever holds the case). Done/reopened is noted in the case history |
| `GET /cases/insights` | Dashboard numbers: `stats` (active, new, high_priority_active, awaiting_resources, unassigned_active, resolved, opened/resolved in the last 7 days, avg_resolution_hours), `by_category`, `by_status`, `recent_activity` |
| `GET /cases/activity?limit=` | The latest updates across all cases |
| `POST /cases/{id}/assist/summary` | AI summary and next steps. 503 `ai_unavailable` without an OpenAI key |
| `POST /cases/{id}/assist/resources` | Suggested resources with reasons, only from the directory. Without AI, `method: "rules"` (the case's category) |
| `POST /cases/{id}/assist/draft-message` | A draft message to the requester. Never sent: the worker edits it and posts it as a public update. 503 without AI |
| `POST /resources` | Add a resource to the directory |
| `GET /staff/me` | `{role, is_worker, is_admin}` |
| `GET /staff/workers` | Who cases can be assigned to, with open case counts |
| `GET /staff/users`, `PATCH /staff/users/{id}/role` | Admins: everyone who has signed in; set `{"role": "member" \| "worker" \| "admin"}` (not your own) |

Statuses: `new` → `in_progress` → `awaiting_resources` → `resolved` / `closed`
(any order is allowed; reopening clears `resolved_at`). Priorities: `low`,
`medium`, `high`, `critical`.

## Tasks (services/task.py)

Every new case (a resident's request or one a worker opens) gets tasks from
`plan_tasks(case)`: first reach the person the way they asked (call, text,
or "review only" for don't-contact, with a no-voicemail warning when it isn't
safe), then the category's follow-ups (e.g. housing: find a bed, offer a
ride). Due in 1 h and 24 h, or 15 min and 2 h when the case is high priority
or an incident / missing person. A task with no assignee follows the case's.
`CaseDetail` includes `tasks`. Rules first; AI can replace `plan_tasks` later.

Workers add their own with `POST /v1/cases/{case_id}/tasks` (`title`,
optional `due_at` and `assigned_worker_id`); it logs an internal note on
the case. `PATCH /v1/tasks/{id}` finishes or reopens one.

## AI rules (services/case_assist.py)

- Suggestions only: the AI never changes a case, sends a message or closes anything.
- It never sees a requester's name, phone or email. Drafts are written without the
  internal notes.
- Resource suggestions are chosen by id from the real directory; anything the model
  invents is dropped.
- The case tools all work without it (`APP__OPENAI__API_KEY` unset).

## Data

Migration `0008_get_help` adds safe-contact columns, access codes, replies
and `tasks`. Migration `0005_case_management` holds the tables (`cases`, `case_updates`,
`resources`, `case_referrals`), the views and every stored function, with the
public/internal split done in SQL (`request_*` functions return only public
columns and public updates). `0006_sample_resources` adds the sample
directory; remove it with the SQL in that file once real partners are in.

## Demo script (staff side at `/staff`)

1. Sign in. Staff land on `/staff` (Today); on a fresh deployment, open
   `/staff` and claim staff admin (first person only).
2. As a community member (another account, or `curl`), `POST /v1/requests`.
3. The request is on **Today** under **Needs attention**. Open it, then
   **Assign to me** (which moves it to in progress) and set the priority and
   category.
4. Add an internal note, then send a message to the requester.
5. **Resources & referrals → Add**: pick a suggested resource. Set the
   status to *Awaiting resources*, then move the referral to *Shared*, then
   *Completed*, and record the outcome.
6. **Mark resolved**. Today's numbers and the Insights charts and activity feed
   update, and the requester's `GET /v1/requests/{id}` shows the status and
   the message, but none of the notes.

## Not built yet

- SMS and email notifications to requesters (there's no messaging service in
  the stack yet). Public messages are visible through `GET /v1/requests/{id}`.
- Knowledge-base search and training material for workers.
- Attachments on cases.
