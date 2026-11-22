# App flow and mockups

Where the app is going after the Nov 21 reset (the old prototype is on the
`archive/full-prototype` branch). The app shell follows the Figma page
**App shell v2**: a resident app and a staff app, each with its own bottom
tabs. This page is the plan we build from, one
step at a time.

**Figma:** [Hacksgiving 2027](https://www.figma.com/design/5nncReT4jVQR4P83fm7Dpz/Hacksgiving-2027)

- Page **App flow**: the pipeline, a lane per person, build order, screens, data, open questions.
- Page **Mockups**: phone screens for the four main user flows (below).

The mockups are visual sketches with sample data, not a spec: names,
addresses, numbers and "Harbor House" are made up.

## What we're building, in one line

Information comes in (a resident's request or a worker's recorded debrief),
the AI turns it into a case with tasks, urgent work goes to whoever is on
call, and everything feeds insights for staff.

The four ideas from the proposals map onto it like this:

| Idea | Where it lives |
|---|---|
| Information goes into a database, tasks get generated automatically | Step 1: capture → store → generate tasks |
| Coordinate responses: AI routing + push notifications (on call vs not) | Step 2: route + notify |
| "Phantom" for DV + insights + metrics | Step 3: record → transcribe → extract, and insights |
| Training + org information, shared with authorities as needed | Step 4 |

"Phantom" is an internal app from Austin's job: record standups and AI
extracts insights (built for senior living). We borrow the pattern: a worker
talks through what happened instead of filling in a form.

## Mockups: the four user flows

### 1. A resident asks for help
Home → Get help form → Request received → My request.

- Home leads with **Get help now** and a "Call 911 first if you're in danger" card.
- The form asks what's going on, where, how to reach them, and whether it's
  safe to call or leave a voicemail (safe-contact matters for DV).
- After sending: a reference number and what happens next.
- My request shows only what staff chose to share (status, messages);
  internal notes stay private.
- A red **Quick exit** button is on every resident screen.

### 2. A worker records a debrief (the Phantom pattern)
My tasks → Recording → Review before saving → Case.

- My tasks: generated tasks by due time, an **On call** badge, and a big
  **Record a debrief** button.
- Recording: a timer and a waveform, and a note that the audio is deleted
  after transcription and names are removed before the AI reads it.
- Review: the AI's summary, category, urgency, risk flags and location, and
  the tasks it will create. The worker fixes anything wrong, then saves.
- Case: tasks, history and referrals in one place.

### 3. An urgent request reaches whoever is on call
Lock-screen push → Respond → En route.

- Push: "Urgent", the AI's one-line summary, tap to respond.
- Respond: map, what we know, distance, a countdown before it moves to the
  next on-call worker, **Accept** or **Pass**.
- En route: ETA, an arrival checklist, **Call 911** and **I've arrived**.

### 4. Staff run the operation
Today → Insights (under Me → Manage).

- Today: active, new, urgent and unassigned counts; who's on call now;
  what needs attention.
- Insights: average response time, cases resolved, requests by need, and
  spotted patterns (e.g. repeat calls at one intersection on weekend nights).

## The pipeline

The whole app as one pipeline. Build it left to right, one slice at a time;
each slice is usable on its own. Status: **have** = exists in the API or app
today, **new** = to build.

```
capture  →  extract  →  store  →  generate tasks  →  route + notify  →  work  →  close  →  insights
```

## People

| Who | Uses the app to |
|---|---|
| **Resident** | Ask for help, follow their request |
| **Field worker** | Record what happened, work their tasks |
| **On-call responder** | Get pushed urgent tasks, accept or hand off |
| **Staff admin** | Run the queue, manage people, on-call and training |
| **Partner / authority** | Receive what's shared with them (referrals, reports) |

## The main flow (one lane per person)

```mermaid
flowchart LR
  subgraph Resident
    R1[Get help form] --> R2[My requests: status + messages]
  end
  subgraph Worker
    W1[Record voice note / debrief] --> W2[Review extraction]
    W5[My tasks] --> W6[Do task, add note] --> W7[Close task]
  end
  subgraph System
    S1[Transcribe audio] --> S2[Extract: summary, category, urgency, risk flags, people, places]
    S2 --> S3[(Case + record)]
    S3 --> S4[Generate tasks]
    S4 --> S5{Urgent?}
    S5 -- yes --> S6[Route to on-call + push]
    S5 -- no --> S7[Route to team queue]
    S3 --> S8[Insights + metrics]
  end
  subgraph OnCall[On-call responder]
    O1[Push notification] --> O2{Accept?}
    O2 -- yes --> W5
    O2 -- no / timeout --> S6
  end
  subgraph Admin
    A1[Queue + dashboard] --> A2[Reassign, set priority]
    A3[On-call schedule]
    A4[Insights]
  end
  R1 --> S2
  W1 --> S1
  W2 --> S3
  S6 --> O1
  S7 --> W5
  W7 --> S3
  S8 --> A4
  S3 --> R2
```

## Steps, in build order

### 1. Capture → store → tasks (the spine)
- **Capture** (new screens): resident "Get help" form; worker "New record" with text first, voice next.
- **Extract** (have: AI routing to a service + urgency; new: tasks and risk flags).
- **Store** (have: `cases`, `case_updates`; new: `tasks` table: case, title, status, assignee, due).
- **Generate tasks** (new): one function, `generate_tasks(case)`. Rules per category first, AI later.
- **Done when:** a resident submits, tasks appear for staff, a worker closes them, the resident sees the update.

### 2. Coordinate responses
- On-call status per worker (new: `on_call` shifts or a toggle).
- Push notifications (new: Expo push tokens per device, a sender in the API).
- Routing rule: urgent → current on-call, with escalation if not accepted in N minutes; else → team queue.
- Info sharing: tasks and notes visible to whoever is assigned; a handoff note when reassigned.

### 3. Phantom-style capture + insights (domestic violence focus)
- Record a debrief → transcribe → extract (the Phantom pattern), feeding step 1's spine.
- Built: typed and voice debriefs go through a background pipeline (transcribe, redact, extract) into a
  reviewed case (ADR 0009, `api/worker`). Voice uploads to a private bucket and is deleted once transcribed.
- Domestic-violence safeguards: no audio kept after transcription, names we can spot (cues like "named",
  "her son", titles) plus phones and emails removed before the extraction model reads the text (best effort:
  a bare name can slip through; for voice, the audio itself goes to the transcription service),
  DV cases staff-only, a quick-exit button on resident screens.
- Insights: trends across records (by category, neighborhood, time; repeat addresses; response time).

### 4. Training + org information, shared with authorities
- Training modules and completion per worker (old prototype on `archive/full-prototype`).
- Org info: partners, contacts, policies.
- Sharing: an explicit "share with" action on a case (partner or authority), with what's shared logged.

## Screens

| Screen | Who | Step | Status |
|---|---|---|---|
| Launch / Welcome | everyone | 0 | **built** (splash in `_layout.tsx`, `/sign-in`) |
| Resident tabs: Home, Requests, Nearby, Me | resident | 0 / 1 | **built** (`/`, `/requests`, `/nearby`, `/me`) |
| Nearby map + Place details | resident | 1 | **built** (`/nearby`, `/place/[id]`); resources have coordinates since 0009; open bed counts (staff set them on the place) since 0019 |
| Get help (form) | resident | 1 | have (`/help`, works signed out); offline queue (E3) built: sent on reconnect |
| Request received | resident | 1 | have (`/help/received`); "Notify me on this phone" for signed-out requests |
| My request (thread) | resident | 1 | **built** to Figma R2 (`/help/request/[id]`); signed out, saved requests are at `/help/requests` |
| Safety map, Safety alerts | resident | 1 | have (`/safety`, `/alerts`), from Nearby and Me; weather alerts, and a Home banner |
| Notifications ask, notification settings | resident | 2 | **built** (`/help/notifications` (R6), Me → Notifications, Community alerts opt-in) |
| New record (voice or typed) | worker | 1 / 3 | **built** (`/staff/records/new`, the Record tab) |
| Review extraction | worker | 3 | **built** (`/staff/records/[id]`), with "Your debriefs" on Today |
| My tasks | worker | 1 | new |
| Staff tabs: Today, Queue, Record, Map, Me | staff | 1 | **built** (`/staff`, `/staff/cases`, `/staff/map`, `/staff/me`); Record opens New case for now |
| Case (tasks, history, referrals, guide), Update sheet, Message resident | staff | 1 | **built** to Figma S3–S5 (`/staff/cases/[id]`, `/staff/cases/[id]/messages`) |
| New case | staff | 1 | **built** to Figma S6 (`/staff/cases/new`), with suggested service and urgency from `/v1/route` |
| On-call toggle / schedule | worker, admin | 2 | **built** (Today card, Me → Shift, `/staff/oncall`) |
| Notifications inbox (S7) | staff | 2 | **built** (`/staff/notifications`, in-app; push in phase 2) |
| Push → accept / hand off | on-call | 2 | **built** (`/staff/alerts/[id]`, Today banners, S7 urgent card) |
| Insights | admin | 3 | **built** from case stats (`/staff/insights`); patterns wait on step 3 |
| Team + roles | admin | 1 | **built** (`/staff/team`) |
| Training | worker | 4 | archived prototype |
| Share with partner / authority | staff | 4 | new |

## Data

| Table | Holds | Status |
|---|---|---|
| `users` | people, role (member / worker / admin) | have |
| `cases` | one request or incident | have |
| `case_updates` | history, notes, public messages | have |
| `resources`, `case_referrals` | partner directory, referrals | have |
| `tasks` | generated work items per case | have (API, and the case's Tasks tab; workers can add tasks) |
| `records` | captured text / transcript + extraction (no audio kept) | have (0011), with `jobs`, the background queue |
| `oncall_shifts`, `notifications`, `notification_preferences` | who's on call, the in-app inbox | have (0015, 0016) |
| `push_devices`, `notification_deliveries`, `oncall_alerts`, `oncall_offers` | where to push, what was sent, urgent offers | have (0017, 0018) |
| `shares` | what was shared with whom, when | new |
| `training_*` | modules, completion | new |

## Open questions

- What counts as "information" in step 1: resident requests only, or also worker records, partner data?
- Who is "authorities" in step 4 (police, county, funders?) and what may be shared with each?
- Escalation timing for on-call (minutes before it moves to the next person).
