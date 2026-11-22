# Hackathon feature pass

Written 2026-11-21 from `docs/handoff.md`, `docs/app-flow.md`,
`docs/design/on-call-and-push.md`, the Figma file "Hacksgiving 2027" (pages
App shell v2 and Mockups), and a skim of `apps/mobile/src/app` and
`api/routers`. Features and demo ideas only: no security, ops or test review.

Sizes: **S** under 2 hours, **M** half a day, **L** more.

## The 3 to demo

One incident, followed from a phone call to a pattern. About 3 minutes.

| Order | Show | Why it lands |
|---|---|---|
| 1 | **Ava pages the on-call worker** (idea 1). Play the last 30 seconds of a call to Ava (the caller agrees to a request and hears a reference number). The staff phone shows the urgent alert; tap Accept. | No app, no account, no typing, and a named person takes it. |
| 2 | **Debrief from the Responding screen** (idea 2). Tap "I've arrived", then record 20 seconds. The case fills in: summary, risk flags, tasks, names removed. | The worker never fills in a form. Privacy is visible on screen. |
| 3 | **Pattern spotted** (idea 3). Open Insights: "third debrief near this corner on a weekend night, 14 dispatch calls nearby". | One call became data that changes where ComForce puts people. |

What the demo needs to be honest:

- **A full Ava call does not fit.** `docs/voice/demo-script.md` times the call
  alone at two minutes. Play a recorded clip, or join a live call at the
  consent step.
- **A live Ava call cannot reach a laptop.** ElevenLabs calls our API over
  public HTTPS, and production has migrations through 0011 only (no on call,
  no alerts). Either deploy `main` through 0018 where Ava points, or tunnel
  to a local API.
- **Fallback for item 1 that works today on a local stack:** send an urgent
  request from the resident Get help form, signed out. It already pages on
  call.
- **The lock-screen push** needs the signed build from the Mac mini, and push
  on a real phone is still unverified (`docs/handoff.md`). In Expo Go, show
  the red banner on Today instead (it refreshes every 15 seconds).
- **The voice debrief** from a real iPhone is unverified end to end. The typed
  debrief is the fallback and goes through the same pipeline.
- **Pattern spotted** needs seeded cases near one corner, with coordinates
  (`database/seeds`). Debrief and Ava locations are free text, and nothing
  geocodes them.
- **Record a backup video** of all three, as `docs/voice/demo-script.md`
  already advises for Ava.

## Standout ideas, ranked by impact for effort

| # | Idea | Who it helps, and when | Why it's distinctive | Reuses | Size | Live in under a minute? |
|---|---|---|---|---|---|---|
| 1 | **Ava pages on call.** An urgent (not 911) phone request becomes a high-priority case and goes to the on-call worker. | A resident with no smartphone or data who needs help tonight; the worker on shift. | Other teams' voice bots end in a summary. Ours ends with a named person accepting. | `POST /v1/voice/requests`, `submit_anonymous_request`, `open_for_case`, the whole escalation ladder. | M | The alert and Accept, yes. The call itself takes two minutes; show a clip. |
| 2 | **Debrief from the Responding screen.** After "I've arrived", one button records a debrief that updates the accepted case. | The responder, standing on the sidewalk right after the visit. | Closes the loop: page, accept, arrive, talk, done. No form at any step. | Phantom pipeline, `/staff/alerts/[id]`. Missing piece: confirming a debrief always makes a new case. | S for the button, M to update the same case | Yes. |
| 3 | **Pattern spotted.** Insights groups debrief-made cases by place and time of week, and lines them up with MPD dispatch calls nearby. | An admin planning next week's on-call shifts. | Combines ComForce's own field notes with city data. Neither alone shows it. | Extraction's `location`, case coordinates, `external_signals`, `geo_areas`, `/public-data/incidents/by-tract`. Missing piece: free-text locations are not geocoded. | M | Yes, with seeded data that has coordinates. |
| 4 | **Reply in the resident's language.** The thread shows a resident's Spanish message in English for staff, and "AI draft" answers in Spanish. | A Spanish-speaking resident; a worker who only speaks English. | Milwaukee-specific and visible in seconds. Ava's prompt already matches the caller's language; the app has no translations. | `assist/draft-message`, the request thread. | S–M | Yes. Two phones side by side. |
| 5 | **Weather-triggered outreach.** A cold or heat alert creates check-in tasks for open homelessness cases and puts warming places first on Nearby. | People sleeping outside on the first freezing night; the worker who would otherwise remember them by hand. | The app acts before anyone asks. Uses data we already load and never show. | `weather_alerts` (loaded every 5 min, no screen uses it), tasks, `task.remind`, resources. | M (S for a Home banner only) | Yes, with a seeded alert. A real one may not be active. |
| 6 | **Shift handoff brief.** Going off call sends the next person a short AI summary: open urgent cases, tasks due tonight, what today's debriefs flagged. | The worker starting the overnight shift. | Borrowed from nursing handoffs. Only a team with shifts and debriefs can build it. | "Next in line" from `oncall/now`, records, `assist/summary`, the inbox. | M | Yes. Toggle off on one phone, the brief lands on the other. |
| 7 | **Referrals that learn.** "Suggest resources" ranks by how past referrals to each place turned out, and shows the nearest bus stop and route. | A worker choosing where to send a family at 9 PM. | The AI uses ComForce's own outcomes, not a generic directory. | `assist/resources`, `case_referrals` outcomes, `/public-data/transit/nearby` (no screen uses it). | M | Yes, with seeded outcomes. |
| 8 | **Share with consent.** Staff pick a partner and what to send. Contact details stay locked until the resident taps "Yes" in their own thread. Every share is logged. | A DV survivor who must control who gets their number; a partner shelter. | Consent is a button the resident presses, not a checkbox staff tick. | Figma P2, the request thread, resources, `assist/summary`. | M–L | Yes. A strong two-phone moment. |
| 9 | **Need versus coverage.** A map shades each census tract by CDC housing and food need next to ComForce's case counts, so gaps stand out. | An admin or funder deciding where outreach goes. | Shows where nobody is asking for help yet. | `/public-data/community-needs`, `incidents/by-tract`, `geo_areas`, case coordinates. | M | Yes. One screen. |

Notes on these:

- **Idea 1 changes a written decision.** `on-call-and-push.md` D3 says a voice
  call never pages, but that was written before Ava could create cases. Today
  Ava's cases are always medium priority (`submit_voice_request` passes no
  triage), and anything the router marks urgent is sent to 911. The change is
  a middle tier (urgent, but not an emergency) in the request model, in
  `CaseService._submit` and in Ava's prompt, which teammates own. Get the
  team's OK first.
- **Keep the rules we set.** No case text on a lock screen, no responder
  location sent to the server, no Ava transcript stored.
- **911 calls are 30 to 90 minutes delayed** and are dispatch calls, not
  confirmed incidents. Never call them live.
- **MPD's page allows 10 requests per 30 minutes per IP.** Run the loader on
  one laptop on demo day (`HACKSGIVING_NO_LOADER=1` on the rest).

## Designed or planned, not built

| What | Where it's specified | Size |
|---|---|---|
| **My tasks**: a worker's tasks by due time (Due soon, All open, Done) | `app-flow.md` screens table ("new"); Mockups flow 2. `GET /v1/tasks` and `useTasks` exist; no screen uses them | S |
| **Insights: "Pattern spotted" card, date and district filters** | Mockups flow 4; comment at the top of `staff/insights.tsx`; handoff "Needs focus" | M |
| **Home "Find support" tiles** with live counts (meals, rides, new jobs) | Mockups flow 1, first screen | S |
| **Offline request queue**: write offline, send on reconnect | Figma E3 (33:3184); handoff "Easier" | M |
| **Training list and lessons** with a quick check | Figma T1 (33:2721), T2 (33:2801); old screen on `archive/full-prototype` (`training.tsx`, `lib/training.ts`) | M on-device, L with completion saved |
| **Partners directory** | Figma P1 (33:2841) | M |
| **Share a case** with a partner or authority | Figma P2 (33:2930); `app-flow.md` step 4; `shares` table is "new" | L |
| **Person page**: role, can be on call, training, open cases | Figma A2 (33:2540). `/staff/team` only changes roles | M |
| **Handoff note when a case is reassigned** | `app-flow.md` step 2, "Info sharing" | S |
| **Quiet hours** for notifications | `on-call-and-push.md` section 7, phase 4. The API and the push job handle them; no screen sets them | S |
| **Ava follow-ups in the inbox** (drop the duplicate list on `/alerts`) | `on-call-and-push.md` D6, phase 4 | S |
| **Community alerts push** for residents | Figma R5 (32:1787); section 9, question 10 | M |
| **Push for signed-out residents** (subscribe with the access code) | section 9, question 7 | M |
| **Android push** | `on-call-and-push.md` D4 | L |
| **Open bed counts on Nearby** ("12 beds") | Figma R3 (32:1609). No public feed exists (`real-data-sources.md`); staff would enter it | M |
| **Loaded data with no screen**: weather alerts, nearby transit, CDC community needs, FBI crime trends, incidents by tract | `api/routers/public_data.py` | S each |
| **Ava's impact numbers and dashboard** | `GET /v1/voice/impact`, `/v1/voice/dashboard`; no screen uses them | S |
| **Text or email to requesters; attachments; knowledge search** | `case-management.md`, "Not built yet" | L, M, M |
| **Get help form restyle** | handoff "Easier" (Peter owns the resident flow) | S–M |

## Quick wins (under an hour each)

- **Shorten the ladder for the demo:** `APP__ONCALL__OFFER_SECONDS=30` in
  `api/.env`. At the default 300, nobody will see it move to the next person.
- **Seed one believable story:** a handful of cases and debriefs near one
  corner, a few resolved cases, two shifts, so no screen is empty and Insights
  has numbers.
- **Ava tiles on Insights:** calls answered, 911 redirects, connected to help,
  from `GET /v1/voice/impact`.
- **"Record a quick debrief" link** on the Responding screen's "On arrival"
  card (the cheap half of idea 2).
- **Weather banner** on resident Home when an alert is active.
- **Check every demo screen for sample names.** Figma marks made-up places
  "(sample)"; seeded data should do the same.
- **Decide what the lock screen says.** Pushes show the app name
  "Hacksgiving" (section 9, question 8); judges will see it.
