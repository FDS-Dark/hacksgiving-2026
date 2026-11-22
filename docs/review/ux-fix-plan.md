# UX audit fix plan

Written 2026-11-21 from `docs/review/ux-audit.md` (54 findings: 28 high,
23 medium, 3 low, plus 7 scorecard-only issues). Sizes follow
`hackathon-features.md`: **S** under 2 hours, **M** half a day, **L** more.

Fixes are grouped by the change that resolves them, not one task per finding.
Many findings share a root cause: query state, navigation guards, the map
shell, or duplicated primitives. The order follows dependencies. Wave 1 has no
prerequisites, waves 2 and 3 build shared pieces, and wave 4 touches every
screen, so it goes last to avoid merge churn with teammates.

## Spot checks before planning

| Claim | Verified? |
|---|---|
| Referral routes sit outside `Stack.Protected` (`app/_layout.tsx:45-58`) | Yes |
| `CaseTasks` freezes `now` at mount (`CaseTasks.tsx:19`) | Yes |
| `RequestList` renders the error banner and "No requests yet" together | Yes |
| Seven characters pass as a phone number (`help/index.tsx:73`); the API checks only nonblank (`models/case.py`) | Yes |
| Unchecked "safe" sends `safe_to_contact: false`, which the API turns into a discreet-contact task (`services/task.py:81`) | Yes. "Don't contact me" already exists as `none`, so the consent fix is mostly UI copy and structure; **no API contract change or migration**. |
| Sample resources are `is_sample` rows from migration 0006, used in `case_assist` ranking and tests | Yes. Gate them by environment rather than deleting them; the demo needs seeded data. |

The remaining findings come from the audit as written and get re-verified as
each one is fixed.

## Decisions for Austin (with defaults)

1. **Safe-contact model.** Default: keep Call / Text / Don't contact me, and
   replace the checkbox with a required Yes/No question: "Can we leave a
   voicemail or say we're from ComForce?" No answer means no submit. The
   receipt repeats what was chosen.
2. **"24/7" and "usually within the hour".** Default: remove both, and say
   "A ComForce worker will reach out the way you asked."
3. **Phone-assistant name.** Default: "Ava" everywhere residents and staff see
   it, with one privacy line: "No recording or transcript is stored." The
   name comes from `hackathon-features.md`; `docs/voice` doesn't use it, so
   confirm it with the teammates who own Ava's prompt first.
4. **Resident Safety dashboard.** Default: keep a short delayed-call summary
   and a recent-calls list for residents. Move the hourly, type and district
   charts to Staff Insights, where they could sit alongside demo idea 3
   ("Pattern spotted").
5. **Community reporting.** Default: remove it until it persists and has
   moderation. Nothing in `hackathon-features.md` depends on it.
6. **Sample resources.** Default: hide `is_sample` rows from resident and
   referral queries unless `APP__DEMO__SHOW_SAMPLES=true` (on for local and
   demo, off for production). Keep the "(Sample)" badge when they show.
   Production still has real resources, because the data loader (migration
   0013) imports them.

**Ownership.** Peter owns the resident help flow (steps 1.2 and 1.3), and
teammates own Ava's prompt (decision 3). Agree those changes with them before
starting.

---

## Wave 1: trust and safety quick fixes (no dependencies)

Each one is independent and fits in a small MR. These come first because
they fix wrong or unsafe behavior a judge or resident could hit today.

| # | Fix | Findings | Size |
|---|---|---|---|
| 1.1 | Move `referrals` into `Stack.Protected guard={signedIn}` | Referral guard | S |
| 1.2 | Safe-contact redesign (decision 1) in `help/index.tsx` and `help/received.tsx` | Safe-contact consent | S |
| 1.3 | Phone validation: a shared `normalizeUsPhone()` on the client (10 digits, optional +1, field error, input kept). On the server, a matching validator **only on `SubmitRequest`** (the help form) that accepts E.164, plus a unit test. Don't put it on the shared `ContactField`: the voice path writes the caller ID (`models/voice.py:180`), and records and staff cases write the field too. | Unusable phone numbers | S |
| 1.4 | Alerts copy: "Recent dispatch calls (30-90 min delay)" everywhere; window copy from one `CALL_WINDOW_HOURS` constant; "Go to Me → Phone calls" | Called live; two vs six hours; Account vs Me | S |
| 1.5 | Remove local-only community reporting: action, sheet, filter, fake coordinates, state | Local-only reporting | S |
| 1.6 | Sample-resource environment gate (decision 6): filter in the resource and referral services when the flag is off. When samples show (demo and local), leave Refer enabled so the seeded referral flow still works; only resident Call/Directions get a "Sample, not a real place" notice. | Actionable samples | S-M |
| 1.7 | `CaseTasks`: a `useNow(60_000)` that also refreshes on foreground; label "Overdue" in text, not only color | Overdue freezes | S |
| 1.8 | Staff notifications: route-less rows get no chevron and show "Case no longer available"; tapping only marks them read | Route-less notifications | S |
| 1.9 | Messages composer: `paddingBottom: insets.bottom + space.md`; poll the case every 10 s while focused, refetch on focus and foreground, add pull-to-refresh | Composer safe area; stale thread | S |
| 1.10 | Debriefs on Today: show every actionable item, or show 5 plus "See all debriefs (n)" leading to a new `staff/records/index.tsx` | Five debriefs reachable | S-M |
| 1.11 | Screen-reader timers: drop `accessibilityLiveRegion` from ticking text; announce at 60/30/10/0 s and at record start/stop | Per-second timers | S |
| 1.12 | Move the push test from staff Me into a "Diagnostics" row shown only when `__DEV__` or the user is an admin. Don't delete it: push on a real phone is still unverified. | Push diagnostics | S |
| 1.13 | Copy pass: remove slogans and filler subtitles, plus the "24/7" and "within the hour" claims (decision 2); one assistant name (decision 3); "case" throughout staff UI, with "Resident request" only as an origin badge | Pitch copy; response claims; phone terminology; request vs case | S |
| 1.14 | Launch gate: drop the static 45% progress bar; on sign-in, put "Get help without an account" above the fold | Scorecard: launch, sign-in | S |
| 1.15 | Quick exit: render the existing `ResidentHeader` above the `ScrollView` in `Page.tsx` and give the button a full 44×44 target. Unifying the header waits for 4.2. | Quick exit scrolls away | S |
| 1.16 | Past referrals: link to the list route, not `/referrals/index` (journey N6) | Journey N6 | S |
| 1.17 | Receipt time: show the request's server `created_at`, not mount time (journey N10) | Journey N10 | S |

## Wave 2: shared foundations

These pieces are built once and then adopted screen by screen. Each one lands
with its first two or three adopters so it isn't speculative.

### 2A. Query-state rendering: error vs empty vs stale (M)

Add a `QueryView` helper (or `useQueryState`) to `components/ui.tsx`. It
returns exactly one of `pending | error | empty | data`, and `data` carries a
`stale` flag when a refetch failed. With cached data the screen shows the rows
plus a `RefreshError`; with no cache it shows a blocking `ErrorBanner`. It
never shows `EmptyState` after an error.

Adopt it in Resident Home (requests, "0 places"), Alerts feeds, `RequestList`,
Today (urgent, on-call, debriefs), `NotificationBell`, staff Me placeholders,
the `/help/request/[id]` stale thread, and the staff cases "Mine" tab, which
shows nothing until identity resolves. Also adopt it on Staff Map, where a
failed case query currently looks like a blank map with zero cases.

- **Staff role:** `useStaffStatus` returns `unknown | resident | staff`, and
  Home renders a loading or error shell until it is known.
- **Notification settings:** give `unsupported`, `loading`, `error`,
  `blocked` and `on` separate states. Branch on the result of
  `ensurePermission()` in `help/notifications.tsx`, and never default the
  switch to on.
- **Assignee sheet:** the `UpdateCaseSheet` worker list gets
  loading/error/retry, and assignment and save stay disabled until it loads.

Findings resolved: critical feeds empty; unknown role; request error plus
empty; notification settings; assignee loading; scorecard items for
`/staff/cases`, `/help/request/[id]` and `/staff/me`.

### 2B. Confirm sheet and dirty-state guard (M)

- `ConfirmSheet` on the existing `Sheet`: title, consequence, and a
  destructive style for irreversible actions. Use it for "Community member"
  role changes on `staff/team` and "Discard debrief". "Mark resolved" goes
  through the existing update sheet instead.
- `useUnsavedChangesGuard(isDirty, onDiscard)`: hooks `beforeRemove` and the
  close/back buttons, and asks "Discard this draft?" first. Use it on New
  case, New debrief (both typed and recorded), the debrief review edits, and
  the Speak/Type switch.
- On a confirmed discard: stop recording, restore the audio mode, and delete
  the local file.

Findings resolved: drafts lost; destructive actions.

### 2C. Navigation: full-screen header and back behavior (S-M)

- `FullScreenHeader` renders in every state, including loading and error, and
  closes with `router.canGoBack() ? back() : replace(fallback)`. Use it on
  Messages, New case and New debrief.
- `BackLink` either says only "Back" when it follows history, or replaces to
  the destination it names. Default: "Back" plus the history fallback.
- Opportunities gets a back-capable pushed header, returning to Me.
- Keep the page shell while loading: the Insights, call detail and place
  detail headers stay up during loading and errors, using shaped skeletons.
  `auth.tsx` gets a labeled wait, plus a "Try signing in again" link after
  about 10 s.

Findings resolved: no escape; back labels; Opportunities return; loading
shells jump.

### 2D. Case creation correctness (S, after 2A)

- Any description edit after Suggest clears the suggestion back to an
  unreviewed state ("Suggest again").
- Save stays disabled while `me` is loading. If `me` fails, hide "Assign to
  me" and show an error; never send `null` while the control is on.

Findings resolved: stale triage and false assignment.

### 2F. Offline queue integrity (M, journey N4)

- Show an explicit "Saved; will send when you're back online" state.
- Send an idempotency key with each queued submit; the API returns the
  existing case for a repeated key.
- Add a regression test in which reconnecting sends the queue twice.

### 2G. Consent integrity for sharing (S, journey N5)

- The share sheet requires the worker to choose how consent was given (in
  the thread, by phone, in person), with no default.
- Record exactly what was chosen.

### 2E. Small shared helpers (S each)

- `openExternal(url, { kind })`: validates the URL, shows a plain-language
  alert on failure, and offers "Copy number/address". Use it on Apply, Call,
  Email, Directions and Website.
- `labels.ts`: typed maps for category, urgency, disposition,
  referral/outcome status and reason code, with resident and staff variants.
  It replaces every `.replaceAll('_', ' ')` and raw enum fallback.
- `userMessage(error, audience)`: maps stable error codes to ComForce copy.
  The base URL, provider and pipeline text and the request ID go behind a
  "Technical details" disclosure. "Hacksgiving API" is never shown.

Findings resolved: external-link failures (the non-map half); raw enums; raw
errors.

## Wave 3: map workstream (L, one owner)

One shared `LeafletMapFrame` (WebView) plus `FullScreenMap` (native shell)
replace the separate frames in `PinMap` and `SafetyMap`. It resolves seven
findings and the three known map issues.

1. **Load the document once.** Update layers through `postMessage` (`setPins`,
   `setPoints`, `setUser`, `select`), so filters and search keep zoom, bounds
   and selection. This must come first, because everything else posts into
   it. *(Filters reload the map)*
2. **Handle load failures.** Show a loading state, then on a CDN or tile
   failure (`onError`, `onHttpError`, or a ready-timeout) show an error with
   Retry and "Show as list". Consider bundling Leaflet and the heat plugin
   locally instead of using the CDN. *(Map failures)*
3. **Full-screen shell.** The map runs edge to edge, with a safe-area
   close/back button. Search, filters, layer switch and legend sit on
   translucent light overlays. Embedded previews only open the full-screen
   map. Use it on Nearby, Safety, Staff Map and urgent response. *(Known 1;
   embedded cards)*
4. **User location.** Take an optional coordinate from `deviceLocation.ts`
   and `lib/location.ts`, and keep it on the device (the rule: no responder
   location sent to the server). Draw a blue dot with an accuracy circle and
   a 44-pt recenter control. When permission is denied, show a `Notice` with
   Retry and Open Settings, without asking again. Urgent response passes the
   coordinate it already has. *(Known 2)*
5. **Dense data.** Remove the permanent tooltips. Color pins by category with
   a text legend. Cluster at low zoom (`Leaflet.markercluster`, or grid
   aggregation for SafetyMap). *(Known 3)*
6. **One selection model.** Tapping a pin enlarges it and opens a native
   bottom card with one explicit action, on every map. *(Pin selection)*
7. **Screen readers.** Label each WebView. Add a native "Browse map items"
   sheet (`Group`/`Row`) that stays in sync with the selection and announces
   it, with non-color metadata. *(Map screen-reader equivalent)*

After step 1, steps 2 to 7 can each ship separately. Do the demo-critical
maps first: urgent response for demo item 1, then Staff Map.

## Wave 4: design-system consolidation and remaining accessibility (L)

Follow the survivor table at the end of the audit. Migrate one family at a
time, and fix accessibility inside each shared primitive so every adopter
inherits it.

| Step | Family | Accessibility fixes it includes | Size |
|---|---|---|---|
| 4.1 | Tokens: radius scale up to `radius.lg` for cards, list shells and skeletons; type roles for 11, 14, 16 and 18 px only where reviewed; darken `textTertiary` to ≥4.5:1; add an accessible urgent-red surface | Contrast | S |
| 4.2 | `PageHeader` (from staff `PageTitle`) with leading/trailing/Quick exit slots, pinned above the scroll body, as 1.15 already does; replaces `ResidentHeader` and the custom Today/Queue/New headers; allows two-line titles | Header drift; large text | M |
| 4.3 | `Button` with outline and link variants; retire `BigButton`, `OutlineButton` and OpportunityCard's `Action` | 44-pt pressable frames | M |
| 4.4 | `SurfaceCard` replaces the resident `Card`, raw shells and the OpportunityCard shell | Radius drift | M |
| 4.5 | `Field` with filled and outlined styles and automatic `accessibilityLabel`; retire the resident `Input` | Field labels | S |
| 4.6 | `Chip` foundation under `Pill`, `ChoiceRow`, `Segmented` and the on-call day strip; on-call reserves space for the role controls so they don't jump in | 44-pt targets; segments wrap at large text; on-call day targets and role jump (scorecard) | M |
| 4.7 | Lists: `Group`/`Row` for calls, Today section links, debrief rows and referrals; `CaseLine` stays for cases; OpportunityCard built from the shared primitives (resident and manage modes); opportunities list moved to `FlatList` | List rebuilds; unvirtualized list (scorecard) | M |
| 4.8 | Large text: staff stats wrap into 2 columns, chart labels flex, no 9 px labels; test at the largest accessibility size | Large text | S-M |
| 4.9 | Screen container: `Page` for tabs, `ResidentScreen` for pushed screens; delete `ui.Screen` | Screen container | S |

Simplifications that ride along with wave 4:

- One "Switch view" row on both Me screens. *(Mode switching)*
- Cut the static Quick exit group on Me, the "COMFORCE STAFF" kicker, and the
  passive call-total tiles (move them to Insights or make them filters).
  *(Static rows)*
- Resident Safety: summary plus recent calls; the charts move to Insights
  (decision 4). *(Analyst dashboard)*
- One canonical history for phone follow-ups and referrals at `/referrals`.
  Me links to it and Alerts drops its copy (matches `on-call-and-push.md` D6).
  *(Follow-ups ×3)*
- Staff Opportunities: the Posted list comes first, behind a "Post an
  opportunity" button that opens a sheet or route. Manage mode drops the
  resident Apply/Save actions. *(Creation blocks management; resident actions
  compete)*
- Staff Calls: lead with the outcome ("Connected to help", "Sent to 911")
  rather than AI framing; use the assistant name from decision 3. *(Scorecard)*

## Wave 5: journey pass (end-to-end flow)

Waves 1 to 4 fix the defects the code audit found. Wave 5 checks that whole
tasks flow cleanly across screens and both roles, on a real device. Each
journey is a script with a "done when" line. Every journey shares the same bar:

> No dead ends. Back always goes where it says. Every save confirms visibly.
> Every failure says what to do next. No screen jumps while loading. The
> user never has to guess what happens next.

| # | Journey | Steps | Done when |
|---|---|---|---|
| J1 | Resident asks for help, signed out | Sign-in → Get help without an account → form → receipt → notifications prompt → follow the request | The receipt repeats the contact choice; the request can be found again |
| J2 | Resident gets a reply | Staff reply → push or inbox → thread → reply → resolved | The push opens the right thread; the thread updates without a manual refresh |
| J3 | Resident finds help nearby | Home → Nearby → map/list → place → Call/Directions → back | The map opens full screen with the blue dot; failures show a fallback |
| J4 | Resident checks safety | Safety → map → recent calls → Alerts → Quick exit | Delay copy is consistent; Quick exit is reachable at any scroll position |
| J5 | Resident links a phone call | Ava call → app code → Me → Phone calls → follow-ups → referral | Exactly one history; status labels are plain words |
| J6 | Staff urgent response (demo) | Push or red banner → Accept → Responding → I've arrived → debrief → case updated → resolved | No step needs the tab bar; **the debrief updates the accepted case** |
| J7 | Staff routine case | Queue → case → assign → message → referral → outcome → resolve | Every save confirms; resolve asks first; back returns to the Queue |
| J8 | Staff creates work | New case (Suggest, edit, save) and New debrief (record and type), each cancelled once | Cancel warns; the suggestion resets after an edit; no orphaned audio |
| J9 | Staff admin | Team & roles → change a role → on-call → switch view and back | The role change asks first; the switch looks the same both ways |
| J10 | Failure drill | Run J1, J3 and J7 with the API stopped, then a slow network | Every screen shows a recoverable error, never a fake empty state |

Steps:

1. **5.1: Build the missing links** (journey N1–N3 are blockers and high; do these before the demo) that the journeys need and that the audit
   didn't count, because they're unbuilt rather than broken:
   - a "Record a debrief" link on the Responding screen
   - a confirmed debrief that updates the accepted case
   - a My tasks screen (`useTasks` exists)
   - Ava follow-ups in the inbox instead of on `/alerts`

   Size M overall. The first two are demo-critical.
2. **First run**, after waves 1 and 2: J1 to J10 on a device, recording each
   point of friction as a finding (journey, step, screenshot, severity).
3. **Fix the findings**, then make J1 to J10 the regression check for each
   wave 3 and wave 4 MR.

### First web run results (2026-11-21)

Full report: `docs/review/journey-findings.md`, with screenshots in
`docs/review/journey-shots/`. It found 31 problems: 2 blocker, 14 high, 13
medium, 2 low. 17 are known audit findings that still reproduce; 14 are new.

**Journey status:**
- Friction: J1, J2, J4, J7, J9
- Fail: J6, J8, J10
- Blocked: J5 (the call handoff isn't configured locally, and Past referrals
  hits an invalid route)
- Web-unsupported: J3, which is the map

New findings, added to the plan:

| # | New finding | Severity | Step |
|---|---|---|---|
| N1 | Responding screen has no "Record a debrief" action | **blocker** | 5.1 (missing link, demo-critical) |
| N2 | Typed debrief can't update the accepted case | **blocker** | 5.1 (missing link, demo-critical) |
| N3 | Signed-out Help has no urgency control, so the J6 urgent path can't page on call from the form | high | 5.1, plus a decision on whether residents can mark "urgent today" |
| N4 | Offline submit can hang with no "queued" state, then create duplicate cases on reconnect (#1020/#1021) | high | **new 2F**: offline queue state plus an idempotency key on submit (client and API) |
| N5 | Sharing records the consent method as "told me" without asking the worker | high | **new 2G**: make the worker choose how consent was given, with no default |
| N6 | Past referrals opens `/referrals/index` as if `index` were an ID | high | **wave 1, 1.16**: route fix (small) |
| N7 | Nearby has no loading state or recoverable error on failure or slow responses | high | 2A (add Nearby) and 3.2 |
| N8 | Urgent alert has no fallback when the map can't render | high | 3.2 |
| N9 | The thread says only ComForce messages appear, right under a resident reply | medium | 1.13 copy pass |
| N10 | Revisiting a receipt resets its time to "Just now" | medium | **wave 1, 1.17**: show the server `created_at` |
| N11 | Slow message sends show no progress for over 10 s | medium | 2B: one shared mutation-feedback pattern (pending, sent, failed and retry) |
| N12 | The selected Queue tab doesn't return to the Queue's root screen | medium | 2C: tapping the active tab pops to root |
| N13 | Web debrief hides the recorder without explaining the typed fallback | medium | 2B / J8: show "Recording isn't available here; type it instead" |
| N14 | Admin role controls overflow at 320 px; the Auth0 login shows "Cooli" and "(dev)" branding | low/medium | 4.6 wrapping; 1.13 (Auth0 app display name via Terraform) |

Smaller items that join existing steps:
- the 22 px safe-to-text checkbox (4.6, plus `accessibilityState`)
- the 42 px call-handoff field (4.5)
- staff form labels missing their programmatic names (4.5)

**Clean up the test data** before any demo:
- requests and cases #1014–#1024 (`UXSWARM`)
- two debriefs
- one partner and one share

The full identifiers are at the end of the findings file.

### Cognitive-load pass (next)

The journey runs checked that flows *work*. Neither the audit nor the
journeys checked how much thinking a task takes. The next run is
`docs/review/codex-cognitive-load-prompt.md`. It has three parts:

- goal-only, first-time-user tests for six personas, with no scripted steps
- per-screen scoring: primary action, choice count, words before the first
  action, reading grade, jargon
- a navigation check: tab-label predictions, reachability, the app map

Its output, `cognitive-load-findings.md`, maps simplifications into these
waves.

### Web run (current approach)

The journey test now runs first in the Expo web build at a phone viewport,
with five parallel Playwright testers: `docs/review/codex-web-journey-prompt.md`.
It's much lighter on CPU than three emulators. Maps, push, voice recording and
native links can't be tested on web. A short device pass on one emulator or a
phone covers those afterwards, using the setup below.

### Device setup (ready on Austin's machine, 2026-11-21)

- **Emulators:** three Android emulators, `ux-resident`, `ux-staff` and
  `ux-drill` (Android 36, Google Play, x86_64, 1080×2400), in
  `~/.android/avd`. `ux-resident` boots in about 60 s. Start one with
  `ANDROID_SDK_ROOT=%LOCALAPPDATA%\Android\Sdk emulator -avd <name>`.
- **Network:** the emulators reach this machine's Tailscale IP
  (`100.102.172.1`), which is already in Auth0's `dev_callback_urls`, so
  sign-in through Expo Go works. Don't use `10.0.2.2`: Auth0 would reject the
  callback.
- **Android Expo Go sign-in is fixed.** Expo Go 58 on Android reports
  `executionEnvironment: "bare"`, so the app sent `hacksgiving://auth` and
  Auth0 rejected it. `src/lib/redirect.ts` now builds `exp://<host>/--/auth`
  whenever `isRunningInExpoGo()`. Member sign-in was verified on `ux-resident`
  and landed on resident Home. This isn't committed yet.
- **Expo Go is now installed** on all three emulators (the swarm's run 2 did
  it). On a fresh emulator, `npx expo start --android` installs it; copy the
  APK to others with `adb pull` and `adb install`.
- **Accounts and environment:** test accounts are in `docs/test-accounts.md`
  (member, worker, admin). `api/.env` has the OpenAI key, so debriefs and
  Suggest work.
- **The code has moved on.** `main` gained 12 commits after the audit: the
  offline queue, weather banners, bed counts and push for signed-out
  requests. The journey run confirms which audit findings still reproduce.
  Re-check a step against the current code before implementing it.
- **First run is a baseline.** Waves 1 and 2 aren't built yet, so the run
  tags anything the audit already lists as "known" and focuses on new
  problems between screens.
- **Prompt for the run:** `docs/review/codex-journey-swarm-prompt.md`.
  Findings go to `docs/review/journey-findings.md`.

---

## Suggested sequencing

| When | What | Why |
|---|---|---|
| Before the demo | Wave 1 entirely (includes the pinned Quick exit); 2A on Today, Home and Staff Map; 2D | Fixes unsafe or wrong behavior on the screens judges see. All small. |
| Next | 2B, 2C, 2E, the rest of 2A | Shared pieces that stop work loss and make failures honest |
| In parallel (one person) | Wave 3, steps 1 → 2 → 3 → 4, then 5 to 7 | Self-contained in two components plus four screens |
| After waves 1-2 | Wave 5 first run (J6 first, for the demo) | Catches problems between screens that the code audit can't see |
| Last | The rest of wave 4 | Touches every screen. Pull first, coordinate with teammates, and fold in any screens they've duplicated in the meantime. |

Every MR runs the area checks from `AGENTS.md`: app `tsc`, lint and jest, and
API flake8, mypy and pytest for 1.3 and 1.6.

## Every finding mapped to a step

| Finding | Severity | Step |
|---|---|---|
| Safe-contact wording | high | 1.2 |
| Unusable phone numbers | high | 1.3 |
| Stale triage / false assignment | high | 2D |
| Drafts and review edits lost | high | 2B |
| Destructive actions unconfirmed | high | 2B |
| Only five debriefs reachable | high | 1.10 |
| Stale message threads | high | 1.9 |
| Full-screen routes no escape | high | 2C |
| Referral guard bypass | high | 1.1 |
| Route-less notifications | high | 1.8 |
| Back labels vs destinations | medium | 2C |
| Opportunities no return | medium | 2C |
| Three design systems | medium | 4.2-4.7 |
| Header/typography drift | medium | 4.1, 4.2 |
| Radius scale | medium | 4.1, 4.4 |
| Rebuilt list/card primitives | medium | 4.7 |
| Mode switching | low | Wave 4 ride-along |
| Dispatch called live | high | 1.4 |
| Two vs six hours | high | 1.4 |
| Account vs Me | high | 1.4 |
| Raw backend errors | medium | 2E |
| Raw enum labels | medium | 2E |
| Request vs case | medium | 1.13 |
| Phone-call terminology | medium | 1.13 |
| Pitch copy | low | 1.13 |
| Unconditional response claims | medium | 1.13 |
| Failures shown as empty | high | 2A |
| Unknown role → resident | high | 2A |
| Request error + "No requests yet" | high | 2A |
| Notification settings misleading | high | 2A |
| Map / external-link failures | high | 3.2, 2E |
| Assignee list loading | high | 2A |
| Overdue frozen | high | 1.7 |
| Loading shells jump | medium | 2C |
| Maps embedded cards | high | 3.3 |
| No user location | high | 3.4 |
| Permanent labels / no clustering | high | 3.5 |
| Filters reload map | medium | 3.1 |
| Pin selection inconsistent | medium | 3.6 |
| Quick exit scrolls away | high | 1.15 |
| Map screen-reader equivalent | high | 3.7 |
| Ticking live regions | high | 1.11 |
| Targets under 44 pt | medium | 4.3, 4.6 |
| Field labels | medium | 4.5 |
| Contrast | medium | 4.1 |
| Large text | medium | 4.2, 4.6, 4.8 |
| Composer safe area | medium | 1.9 |
| Local-only reporting | high | 1.5 |
| Sample resources actionable | high | 1.6 |
| Safety analyst dashboard | medium | Wave 4 ride-along |
| Push diagnostics | medium | 1.12 |
| Follow-ups duplicated | medium | Wave 4 ride-along |
| Opportunity creation blocks | medium | Wave 4 ride-along |
| Static / vanity rows | low | Wave 4 ride-along |
| *Scorecard:* launch 45% bar, sign-in help placement | — | 1.14 |
| *Scorecard:* `/staff/cases` Mine false empty, `/help/request/[id]` stale, `/staff/me` placeholders | — | 2A |
| *Scorecard:* `/staff/map` blank/zero data | — | 2A |
| *Scorecard:* on-call day targets, role UI jump | — | 4.6 |
| *Scorecard:* opportunities unvirtualized | — | 4.7 |
| *Scorecard:* staff opportunities resident actions; staff calls AI framing | — | Wave 4 ride-along |
