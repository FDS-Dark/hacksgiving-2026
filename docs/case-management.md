# Case management: worker portal and API contract

ComForce MKE workers handle community requests for help and incidents as
**cases**: triage (priority, category), assign, keep notes, refer the person
to community resources, and resolve. The worker portal is the `/worker`
section of the Expo app (web and iPhone). This page is the contract for the
community app and anyone else integrating.

All paths are under `/v1`, need a signed-in Auth0 access token
(`Authorization: Bearer …`), and return the usual error body
`{"code", "message", "request_id"}`. The full schemas are in
`apps/mobile/openapi.json` and the generated `apps/mobile/src/api/schema.ts`.
Types by name: `apps/mobile/src/api/types.ts`. Ready-made TanStack hooks:
`apps/mobile/src/services/cases.ts`.

## Who can do what

| Role (`app.users.role`) | Can |
|---|---|
| `member` (everyone who signs in) | Submit requests, read **their own** requests and the updates staff shared, browse resources |
| `worker` | Everything under `/v1/cases`, add resources, see the team |
| `admin` | A worker who also manages roles (`/v1/staff/users`) |

**Setting up staff:** on a fresh deployment, the first person to press
"Claim staff admin" in the portal (`POST /v1/staff/bootstrap`) becomes an
admin. It returns 409 once anyone is staff. From then on admins promote
people on the portal's Team page. Someone has to sign in once before they
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
  "contact_name": "optional", "contact_phone": "optional", "contact_email": "optional"
}
```

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

## AI rules (services/case_assist.py)

- Suggestions only: the AI never changes a case, sends a message or closes anything.
- It never sees a requester's name, phone or email. Drafts are written without the
  internal notes.
- Resource suggestions are chosen by id from the real directory; anything the model
  invents is dropped.
- The case tools all work without it (`APP__OPENAI__API_KEY` unset).

## Data

Migration `0005_case_management` holds the tables (`cases`, `case_updates`,
`resources`, `case_referrals`), the views and every stored function, with the
public/internal split done in SQL (`request_*` functions return only public
columns and public updates). `0006_sample_resources` adds the sample
directory; remove it with the SQL in that file once real partners are in.

## Demo script

1. Sign in, open **Account → ComForce staff portal**, and claim staff admin
   (first person only).
2. As a community member (another account, or `curl`), `POST /v1/requests`.
3. The request is on the dashboard under **New requests**. Open it, then
   **Assign to me** (which moves it to in progress) and set the priority and
   category.
4. Add an internal note, then send a message to the requester.
5. **Resources & referrals → Add**: pick a suggested resource. Set the
   status to *Awaiting resources*, then move the referral to *Shared*, then
   *Completed*, and record the outcome.
6. **Mark resolved**. The dashboard numbers, status chart and activity feed
   update, and the requester's `GET /v1/requests/{id}` shows the status and
   the message, but none of the notes.

## Not built yet

- SMS and email notifications to requesters (there's no messaging service in
  the stack yet). Public messages are visible through `GET /v1/requests/{id}`.
- Knowledge-base search and training material for workers.
- Attachments on cases.
