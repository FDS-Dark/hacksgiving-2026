# ComForce MKE mobile UX audit

Read-only audit of `apps/mobile/src`, completed 2026-11-21 against the settled **C · Light** direction. Findings are based on code, not proposed features; overlapping screen and cross-cutting findings have been merged and high-severity claims were independently re-read before inclusion.

## Summary: the 10 highest-impact changes

1. [Make every map a full-screen, resilient tool](#all-maps-are-embedded-cards), with overlaid controls and a list fallback, instead of a fixed-height WebView card.
2. [Show the user's current location on every map](#maps-do-not-show-the-users-location), with a blue dot, recenter control, and a calm denied-permission state.
3. [Stop presenting failed requests as legitimate empty data](#critical-feeds-turn-failures-into-empty-or-zero-results), especially on Resident Home, Alerts, Staff Today, and Requests.
4. [Clarify safe-contact consent](#safe-contact-wording-can-authorize-contact-the-resident-did-not-expect) so a resident cannot accidentally authorize a call or text they believe they declined.
5. [Keep Quick exit persistently reachable](#quick-exit-scrolls-out-of-reach), rather than letting it scroll away on resident tab screens.
6. [Protect staff case and debrief work from silent loss](#staff-drafts-and-review-edits-can-be-lost-without-warning), including recorded audio, long case drafts, and corrected AI extraction.
7. [Prevent stale or missing staff decisions from being saved](#case-creation-can-save-stale-triage-or-a-false-assignment), covering stale AI triage, false “Assign to me,” and unavailable assignee lists.
8. [Consolidate the three visual component systems](#resident-staff-and-shared-components-form-three-design-systems) into one button, card, header, field, chip, and row foundation.
9. [Make urgent and map interactions accessible](#map-interactions-have-no-complete-screen-reader-equivalent), including native alternatives, 44-point targets, contrast, and non-repeating announcements.
10. [Remove prototype and misleading launch UI](#local-only-community-reporting-pretends-to-submit), especially local-only safety reports, actionable sample resources, developer diagnostics, and contradictory “live” safety language.

## Known issues: map fix plan

### 1. All maps must be full screen

Confirmed in Nearby, resident Safety, Staff Map, and urgent-response alerts. Keep Leaflet in a WebView, but move it into a shared full-screen map shell: edge to edge behind the status bar; safe-area close/back button; search, filters, layer switch, and legend overlaid on translucent light surfaces; selected point in a native bottom card/sheet. Compact previews may remain only when they clearly launch the full-screen map. See [All maps are embedded cards](#all-maps-are-embedded-cards).

### 2. All maps must show the user's location

Extend `PinMap` and `SafetyMap` to accept an optional device coordinate from `src/services/deviceLocation.ts` and `src/lib/location.ts`. Draw a Leaflet blue dot plus accuracy circle, add a 44-point recenter control, and keep the coordinate device-local. If permission is denied, leave the map usable and show a concise `Notice` with Retry/Open Settings instead of repeatedly prompting. See [Maps do not show the user's location](#maps-do-not-show-the-users-location).

### 3. Dense resource/opportunity maps cannot label every pin

Remove `bindTooltip(..., { permanent: true })` from `PinMap`. Color pins by category with a text legend, reveal the name in a selected-point card on tap, and cluster or grid-aggregate at low zoom. This is necessary because resource results are unbounded, Staff Map requests up to 500 cases, and SafetyMap can draw hundreds of incident/call markers. Leaflet supports all of this without changing map stacks. See [Permanent labels and unclustered points make dense maps unreadable](#permanent-labels-and-unclustered-points-make-dense-maps-unreadable).

## Findings by theme

## Flow

### Safe-contact wording can authorize contact the resident did not expect
- Severity: high
- Kind: flow
- Where: apps/mobile/src/app/help/index.tsx:12; apps/mobile/src/app/help/index.tsx:28; apps/mobile/src/app/help/index.tsx:73; apps/mobile/src/app/help/index.tsx:85; apps/mobile/src/app/help/index.tsx:188; apps/mobile/src/app/help/received.tsx:12; api/services/task.py:81
- What's wrong: Call is selected by default and the form allows submission with “It’s safe to call or leave a voicemail” unchecked. The backend interprets that as “contact discreetly,” but the UI never explains that distinction and the receipt still promises contact.
- Evidence: `safe_to_contact: ... safe`; `"It’s safe to call or leave a voicemail"`; the generated task remains `Call the requester` or `Text the requester` when false.
- Fix: Separate consent (“Call,” “Text,” “Do not contact me”) from discretion (“Can we identify ComForce or leave details?”), and explain exactly what an unchecked choice means with shared `FieldLabel`/`Notice` copy.

### The help form accepts unusable phone numbers
- Severity: high
- Kind: state
- Where: apps/mobile/src/app/help/index.tsx:73; apps/mobile/src/app/help/index.tsx:176; api/models/case.py:301
- What's wrong: Any seven-character string passes the client and any nonblank value passes the API, so a malformed value can produce a success receipt and a contact promise staff cannot fulfill.
- Evidence: `phone.trim().length >= 7`; the API checks only that the value is nonblank.
- Fix: Normalize and validate a real phone-number shape on both client and server, retain input on failure, and show a field-level plain-language error.

### Case creation can save stale triage or a false assignment
- Severity: high
- Kind: flow
- Where: apps/mobile/src/app/staff/cases/new.tsx:24; apps/mobile/src/app/staff/cases/new.tsx:35; apps/mobile/src/app/staff/cases/new.tsx:39; apps/mobile/src/app/staff/cases/new.tsx:42; apps/mobile/src/app/staff/cases/new.tsx:58; apps/mobile/src/app/staff/cases/new.tsx:93; apps/mobile/src/app/staff/cases/new.tsx:104; apps/mobile/src/app/staff/cases/new.tsx:121
- What's wrong: Editing the description after Suggest leaves the old service/urgency labeled “Suggested.” Separately, enabled “Assign to me” becomes `null` if staff identity is still loading or failed.
- Evidence: `onChangeText={setDescription}` does not invalidate the suggestion; `assigned_worker_id: assignToMe ? (me.data?.id ?? null) : null`.
- Fix: Invalidate suggestions on description changes and require review; block save until identity resolves, and never translate an enabled assignment control into `null`.

### Staff drafts and review edits can be lost without warning
- Severity: high
- Kind: flow
- Where: apps/mobile/src/app/staff/cases/new.tsx:29; apps/mobile/src/app/staff/cases/new.tsx:71; apps/mobile/src/app/staff/records/new.tsx:36; apps/mobile/src/app/staff/records/new.tsx:43; apps/mobile/src/app/staff/records/new.tsx:57; apps/mobile/src/app/staff/records/new.tsx:76; apps/mobile/src/app/staff/records/[id].tsx:43; apps/mobile/src/app/staff/records/[id].tsx:140; apps/mobile/src/app/staff/records/[id].tsx:193; apps/mobile/src/components/BackLink.tsx:12
- What's wrong: Cancel, Back, and Speak/Type switching discard local case text, typed debriefs, recordings, or corrected AI fields without confirmation. Cancelled audio may also remain in cache because deletion happens only on record-again or successful upload.
- Evidence: close actions call `router.back()`; mode uses `onChange={setMode}`; review corrections live only in `useState`.
- Fix: Add one shared dirty-state/navigation guard. On confirmed discard, stop recording, restore audio mode, and delete the local file; otherwise keep the worker on the screen.

### Destructive staff actions need explicit confirmation
- Severity: high
- Kind: flow
- Where: apps/mobile/src/app/staff/team.tsx:50; apps/mobile/src/app/staff/team.tsx:56; apps/mobile/src/app/staff/records/[id].tsx:272; apps/mobile/src/app/staff/records/[id].tsx:280; apps/mobile/src/app/staff/cases/[id]/index.tsx:178
- What's wrong: Changing a worker to Community member and deleting a debrief happen immediately; resolving a case also happens in one tap. Role removal and debrief deletion are especially easy to trigger and consequential.
- Evidence: role selection immediately calls `setRole.mutate`; `Discard debrief` immediately invokes the delete mutation; `Mark resolved` directly patches status.
- Fix: Confirm person/case/debrief and consequence in a shared `Sheet`; style irreversible confirmation as destructive. Route “Mark resolved” through the existing update sheet (medium severity because it is recoverable).

### Only five unresolved debriefs are reachable
- Severity: high
- Kind: flow
- Where: apps/mobile/src/components/staff/Debriefs.tsx:21; apps/mobile/src/components/staff/Debriefs.tsx:32; apps/mobile/src/app/staff/_layout.tsx:55
- What's wrong: Today truncates open debriefs to five, while the router has New and Detail but no records index or “See all.” A sixth processing, failed, or ready record has no UI route.
- Evidence: `open.slice(0, 5)`; only `records/new` and `records/[id]` are registered.
- Fix: Show all actionable items or add a records index and a clear “See all debriefs” row; never silently truncate unresolved work.

### Staff message threads can stay stale while open
- Severity: high
- Kind: state
- Where: apps/mobile/src/app/staff/cases/[id]/messages.tsx:23; apps/mobile/src/services/cases.ts:52
- What's wrong: A resident can reply while staff read the thread, but the detail query has no polling, subscription, focus refresh, or manual refresh.
- Evidence: the screen only calls `useCase(id)`; the underlying query has no `refetchInterval`.
- Fix: Poll while focused or subscribe, refetch on focus/foreground, and add a visible refresh affordance consistent with resident threads.

### Full-screen routes can have no visible or defined escape
- Severity: high
- Kind: flow
- Where: apps/mobile/src/app/staff/_layout.tsx:39; apps/mobile/src/app/staff/_layout.tsx:68; apps/mobile/src/app/staff/cases/[id]/messages.tsx:28; apps/mobile/src/app/staff/cases/[id]/messages.tsx:39; apps/mobile/src/app/staff/cases/new.tsx:71; apps/mobile/src/app/staff/records/new.tsx:43
- What's wrong: Messages hide the tab bar and omit their BackLink during loading/error. New case and New debrief also hide tabs, but their only close action is `router.back()` with no cold-entry fallback.
- Evidence: `fullScreen` removes `TabBar`; early returns omit `BackLink`; create flows call only `router.back()`.
- Fix: Keep a shared full-screen header in every state and use `router.canGoBack() ? router.back() : router.replace(fallback)`.

### Referral routes bypass the sign-in guard
- Severity: high
- Kind: state
- Where: apps/mobile/src/app/_layout.tsx:47; apps/mobile/src/app/_layout.tsx:52; apps/mobile/src/app/referrals/index.tsx:8; apps/mobile/src/app/referrals/[id].tsx:10
- What's wrong: Signed-out deep links can render account-only referral screens and authenticated queries instead of going to sign-in.
- Evidence: the protected group contains only `(main)`, `staff`, and `place/[id]`; referral screens immediately call authenticated hooks.
- Fix: Put the referral navigator inside `Stack.Protected guard={signedIn}`.

### Route-less notifications promise navigation and go nowhere
- Severity: high
- Kind: flow
- Where: apps/mobile/src/app/staff/notifications.tsx:40; apps/mobile/src/app/staff/notifications.tsx:80; apps/mobile/src/app/staff/notifications.tsx:96; apps/mobile/src/app/staff/notifications.tsx:108
- What's wrong: A notification whose destination is gone still shows a chevron. Tapping only marks it read and leaves the worker in place.
- Evidence: navigation is conditional on `item.route`, but every row has `accessory="chevron"` and `onPress`.
- Fix: Make route-less items non-navigating rows with no chevron and an explicit “Case no longer available” detail; provide a separate read action if needed.

### Back labels do not enforce their named destinations
- Severity: medium
- Kind: flow
- Where: apps/mobile/src/components/BackLink.tsx:7; apps/mobile/src/components/BackLink.tsx:12; apps/mobile/src/app/staff/cases/[id]/index.tsx:65; apps/mobile/src/app/staff/records/[id].tsx:43; apps/mobile/src/app/staff/alerts/[id].tsx:65
- What's wrong: Controls labeled “Back to Queue” or “Back to Today” return to whatever is in history, which may be Insights, a notification, Map, or another screen.
- Evidence: `BackLink` always prefers `router.back()` and uses the named fallback only with no history.
- Fix: Label history behavior simply “Back,” or deterministically replace to the destination named in the control.

### Opportunities has no explicit return to its parent
- Severity: medium
- Kind: flow
- Where: apps/mobile/src/app/(main)/me.tsx:60; apps/mobile/src/app/(main)/opportunities.tsx:27; apps/mobile/src/app/(main)/_layout.tsx:9; apps/mobile/src/components/TabBar.tsx:35
- What's wrong: Me pushes Opportunities, but the destination has no back control and the active Me tab is deliberately a no-op. Other tabs remain available, so this is a hierarchy defect rather than a complete trap.
- Evidence: `router.push('/opportunities')`; the screen renders only `ResidentHeader`; its path matches Me.
- Fix: Use a back-capable resident pushed-screen header or a visible “Back to Me” action.

## Cohesion and design-system drift

### Resident, staff, and shared components form three design systems
- Severity: medium
- Kind: cohesion
- Where: apps/mobile/src/components/resident.tsx:120; apps/mobile/src/components/resident.tsx:132; apps/mobile/src/components/resident.tsx:199; apps/mobile/src/components/resident.tsx:404; apps/mobile/src/components/staff/kit.tsx:82; apps/mobile/src/components/staff/kit.tsx:105; apps/mobile/src/components/ui.tsx:317; apps/mobile/src/components/ui.tsx:436; apps/mobile/src/components/OpportunityCard.tsx:133
- What's wrong: Identical primitives have visibly different radii, borders, fills, heights, and weights. The help flow, resident tabs, staff screens, and opportunities look like related prototypes rather than one product.
- Evidence: resident `Card` is radius 16, staff `Card` radius 12, `BigButton` is 52/14, shared `Button` is 44–50/12, and OpportunityCard implements another action family.
- Fix: Keep `ui.tsx` as the base: one `Button` (add outline/link variants), `Field` (filled/outlined), role-neutral `SurfaceCard`, `PageHeader`, `Chip`, and `Row`. Keep only domain vocabulary/status wrappers outside it.

### Headers and typography drift screen by screen
- Severity: medium
- Kind: cohesion
- Where: apps/mobile/src/components/resident.tsx:381; apps/mobile/src/components/resident.tsx:422; apps/mobile/src/components/staff/kit.tsx:105; apps/mobile/src/components/staff/kit.tsx:220; apps/mobile/src/app/staff/index.tsx:57; apps/mobile/src/app/staff/cases/index.tsx:47; apps/mobile/src/app/staff/records/new.tsx:46; apps/mobile/src/app/staff/cases/new.tsx:74; apps/mobile/src/components/OpportunityCard.tsx:157
- What's wrong: Page titles alternate among 28/800, 30/700, and local variants, while ordinary text repeatedly invents 11, 14, 16, and 18px roles up to weight 900.
- Evidence: `ResidentHeader`, `PageTitle`, Today, Queue, Record, New case, and OpportunityCard all declare separate title/text styles.
- Fix: Promote one `PageHeader` and use `Txt`/`type` tokens; add only named, reviewed roles that the token scale genuinely lacks.

### Cards and rows use an unplanned radius scale
- Severity: medium
- Kind: cohesion
- Where: apps/mobile/src/theme/tokens.ts:78; apps/mobile/src/components/resident.tsx:404; apps/mobile/src/components/staff/kit.tsx:236; apps/mobile/src/components/OpportunityCard.tsx:154; apps/mobile/src/components/staff/CaseLine.tsx:60; apps/mobile/src/components/staff/Debriefs.tsx:65; apps/mobile/src/components/Skeleton.tsx:85; apps/mobile/src/app/staff/records/[id].tsx:290
- What's wrong: Similar white surfaces alternate among 8, 12, 14, and 16px corners, including their skeletons.
- Evidence: theme radii stop at 12, but local `borderRadius: 14` and `16` recur across resident and staff surfaces.
- Fix: Standardize ordinary cards/list shells/skeletons on `radius.lg`; reserve pill/circle shapes as explicit exceptions.

### Staff Today, calls, debriefs, and opportunities rebuild list/card primitives
- Severity: medium
- Kind: cohesion
- Where: apps/mobile/src/app/staff/index.tsx:125; apps/mobile/src/app/staff/calls/index.tsx:23; apps/mobile/src/components/staff/Debriefs.tsx:41; apps/mobile/src/components/staff/CaseLine.tsx:60; apps/mobile/src/app/staff/opportunities.tsx:236; apps/mobile/src/components/OpportunityCard.tsx:154
- What's wrong: These screens create custom section links, bordered pressables, quiet cards, debrief rows, and dense opportunity cards instead of sharing the product's list language.
- Evidence: repeated custom borders, radii, padding, circular icons, chevrons, and 800/900-weight titles.
- Fix: Keep `Group`/`Row` for plain lists, `CaseLine` for case-domain rows, and make `OpportunityCard` compose the shared card/badge/button primitives with resident and management modes.

### Resident and staff mode switching looks like two unrelated apps
- Severity: low
- Kind: cohesion
- Where: apps/mobile/src/app/(main)/me.tsx:65; apps/mobile/src/app/staff/me.tsx:115
- What's wrong: Community Me calls the destination “Staff app” with accented styling; Staff Me says “Switch to community view” as an ordinary row.
- Evidence: `"Staff app" / "Back to your queue"` versus `"Switch to community view"`.
- Fix: Use one “Switch view” row, the same icon/tone/placement, and detail “Staff” or “Community.”

## Copy and tone

### Delayed dispatch data is repeatedly called live
- Severity: high
- Kind: copy
- Where: apps/mobile/src/app/(main)/alerts.tsx:64; apps/mobile/src/app/(main)/alerts.tsx:129; apps/mobile/src/app/(main)/alerts.tsx:132; apps/mobile/src/app/(main)/alerts.tsx:135; apps/mobile/src/app/(main)/alerts.tsx:136; apps/mobile/src/components/SafetyMap.tsx:138
- What's wrong: The safety screen calls the feed “live” and “not live” in the same experience, despite a stated 30–90 minute delay.
- Evidence: `"The live city dispatch feed"`; `"Live dispatch feed"`; `"Not live: MPD publishes calls 30–90 min after dispatch"`.
- Fix: Use “Recent dispatch calls” everywhere and put the delay beside the heading.

### The Alerts empty state contradicts the six-hour query
- Severity: high
- Kind: copy
- Where: apps/mobile/src/app/(main)/alerts.tsx:136; apps/mobile/src/app/(main)/alerts.tsx:154; apps/mobile/src/services/recentCalls.ts:220
- What's wrong: The screen assures residents there were no matching calls in two hours while the query and nearby copy use six hours.
- Evidence: `"last two hours"` versus `callsApi.list(6, 500)` and `"last six hours"`.
- Fix: Derive all time-window copy from the same query constant.

### Alerts directs residents to an Account screen that is named Me
- Severity: high
- Kind: flow
- Where: apps/mobile/src/app/(main)/alerts.tsx:69; apps/mobile/src/app/(main)/alerts.tsx:84; apps/mobile/src/app/(main)/me.tsx:32
- What's wrong: A resident cannot follow the instruction as written.
- Evidence: `"Connect your first call from the Account page"`; the actual header/tab is `"Me"`.
- Fix: Say “Go to Me → Phone calls.”

### Raw backend and development errors reach users
- Severity: medium
- Kind: hacked-together
- Where: apps/mobile/src/api/client.ts:106; apps/mobile/src/api/client.ts:121; apps/mobile/src/components/ui.tsx:493; apps/mobile/src/components/ui.tsx:500; apps/mobile/src/app/sign-in.tsx:67; apps/mobile/src/app/staff/records/[id].tsx:118
- What's wrong: Residents and workers can see “Hacksgiving API,” the base URL, low-level fetch/provider/pipeline messages, and raw request IDs.
- Evidence: ``Can't reach the Hacksgiving API at ${BASE_URL}``; `{error.message}`; `Request {error.requestId}`.
- Fix: Map stable codes to task-specific ComForce copy; keep URLs, provider messages, pipeline errors, and IDs behind technical/support details.

### Raw enum values and uncurated labels leak into UI
- Severity: medium
- Kind: hacked-together
- Where: apps/mobile/src/app/(main)/alerts.tsx:75; apps/mobile/src/app/(main)/alerts.tsx:77; apps/mobile/src/app/(main)/me.tsx:170; apps/mobile/src/app/referrals/[id].tsx:22; apps/mobile/src/app/staff/calls/index.tsx:14; apps/mobile/src/app/staff/calls/[id].tsx:14
- What's wrong: Residents can see lowercase or machine values such as `follow_up_needed`, `no_answer`, and raw urgency; staff values are mechanically separator-stripped but not product-written.
- Evidence: `item.urgency_tier ?? 'new'`; `item.outcome_status ?? item.status`; `.replaceAll(...)` formatting.
- Fix: Add typed label maps for category, urgency, disposition, referral/outcome status, and reason code, with resident/staff variants only where needed.

### Staff alternates between request and case for the same object
- Severity: medium
- Kind: cohesion
- Where: apps/mobile/src/app/staff/calls/[id].tsx:87; apps/mobile/src/app/staff/calls/[id].tsx:91; apps/mobile/src/app/staff/cases/[id]/index.tsx:116; apps/mobile/src/components/staff/Urgent.tsx:189
- What's wrong: A call detail says “Open request,” the destination is a case route, and the case header shows both “CASE” and “REQUEST.”
- Evidence: `"Linked request"`; `"Open request #..."`; `"CASE #... · REQUEST"`; `"Open case #..."`.
- Fix: Use “case” throughout staff UI; use “Resident request” only as an origin badge.

### Phone-call terminology and privacy copy do not form one product
- Severity: medium
- Kind: cohesion
- Where: apps/mobile/src/app/(main)/me.tsx:141; apps/mobile/src/app/(main)/alerts.tsx:84; apps/mobile/src/app/staff/me.tsx:100; apps/mobile/src/app/staff/calls/index.tsx:77; apps/mobile/src/app/staff/calls/index.tsx:104
- What's wrong: Residents see “phone assistant” and “call handoff code,” while staff see “AI phone calls” and “privacy-safe routing outcomes/data.”
- Evidence: exact phrases above appear across the same workflow.
- Fix: Choose one name (for example, “ComForce phone calls” or the approved assistant name) and state privacy concretely: “No recording or transcript is stored.”

### Launch and permission copy reads like a pitch
- Severity: low
- Kind: vibe copy
- Where: apps/mobile/src/app/_layout.tsx:73; apps/mobile/src/app/sign-in.tsx:41; apps/mobile/src/app/sign-in.tsx:44; apps/mobile/src/app/help/notifications.tsx:52; apps/mobile/src/app/staff/oncall.tsx:60
- What's wrong: Broad slogans, upbeat claims, and restated headings precede direct tasks.
- Evidence: `"We Empower. We Protect. We Uplift."`; `"Help is one tap away."`; `"people who show up, 24/7"`; `"Know the moment someone replies"`; `"Who is on and who is next."`
- Fix: Keep organization/task names and concrete next actions; remove slogans and filler subtitles.

### Response-time claims are unconditional
- Severity: medium
- Kind: copy
- Where: apps/mobile/src/app/sign-in.tsx:44; apps/mobile/src/app/help/received.tsx:13; apps/mobile/src/app/help/received.tsx:69
- What's wrong: “24/7” and “usually within the hour” are presented without any live staffing or SLA signal. Code alone cannot prove the operational promise false, but the app cannot qualify it.
- Evidence: `"people who show up, 24/7"`; `"usually within the hour"`.
- Fix: Remove or qualify the promise unless ComForce owns that SLA; show a live estimate only when backed by staffing data.

## Loading, empty, error, offline, and permission states

### Critical feeds turn failures into empty or zero results
- Severity: high
- Kind: state
- Where: apps/mobile/src/app/(main)/index.tsx:35; apps/mobile/src/app/(main)/index.tsx:41; apps/mobile/src/app/(main)/index.tsx:80; apps/mobile/src/app/(main)/index.tsx:91; apps/mobile/src/app/(main)/alerts.tsx:67; apps/mobile/src/app/(main)/alerts.tsx:106; apps/mobile/src/app/staff/index.tsx:68; apps/mobile/src/components/staff/OncallCard.tsx:48; apps/mobile/src/components/staff/Debriefs.tsx:21; apps/mobile/src/components/staff/NotificationBell.tsx:11
- What's wrong: Failed requests/resources become no open request or “0 places”; failed Alerts feeds become “No call notifications” or a blank group; failed urgent/on-call/debrief/unread queries disappear.
- Evidence: repeated `data ?? []`, `if (!data) return null`, conditional omission, and zero fallbacks without error branches.
- Fix: Make pending, blocking error, successful empty, stale content, and refreshed content mutually exclusive. Preserve cached operational data with `RefreshError`/`Notice`.

### Unknown staff role is treated as resident
- Severity: high
- Kind: state
- Where: apps/mobile/src/services/staff.ts:24; apps/mobile/src/services/staff.ts:29; apps/mobile/src/app/(main)/index.tsx:26
- What's wrong: Pending and failed role checks become `false`, briefly showing Resident Home and leaving staff there after failure.
- Evidence: `useStaffStatus().data?.is_worker ?? false`.
- Fix: Return full query state or `unknown | resident | staff`; render loading/error before either shell.

### Request errors also say “No requests yet”
- Severity: high
- Kind: state
- Where: apps/mobile/src/components/RequestList.tsx:29; apps/mobile/src/components/RequestList.tsx:37; apps/mobile/src/components/RequestList.tsx:51
- What's wrong: A failed request with no cache renders both an error and the successful-empty message, suggesting prior requests vanished.
- Evidence: the error banner and `list.requests.length ? ... : <EmptyState>` are independent branches.
- Fix: Make blocking error and successful empty mutually exclusive; show cached rows with a stale warning when available.

### Notification settings can look enabled when delivery is impossible
- Severity: high
- Kind: state
- Where: apps/mobile/src/app/(main)/me.tsx:79; apps/mobile/src/app/(main)/me.tsx:101; apps/mobile/src/app/(main)/me.tsx:108; apps/mobile/src/lib/push.ts:35; apps/mobile/src/lib/push.ts:75; apps/mobile/src/lib/pushRules.ts:75; apps/mobile/src/app/help/notifications.tsx:28
- What's wrong: `unsupported` is not given its own resident state; unloaded/failed preferences default the disabled switch to visually on; the permission explainer leaves even when permission was denied or unsupported.
- Evidence: only `blocked` is handled; `muted_kinds ?? []` yields `on = true`; `ensurePermission(...)` result is ignored.
- Fix: Design separate unsupported/loading/error/blocked/on states, branch on permission result, and never promise delivery without confirmed capability and preference data.

### Map and external-link failures can look like dead controls or blank content
- Severity: high
- Kind: state
- Where: apps/mobile/src/lib/leaflet.ts:9; apps/mobile/src/components/PinMap.tsx:67; apps/mobile/src/components/SafetyMap.tsx:73; apps/mobile/src/components/SafetyMap.tsx:120; apps/mobile/src/components/OpportunityCard.tsx:49; apps/mobile/src/app/place/[id].tsx:70; apps/mobile/src/app/place/[id].tsx:79
- What's wrong: Runtime CDN/tile failures have no map recovery UI, and Apply/Call/Email/Directions/Website actions ignore open failures.
- Evidence: remote Leaflet/heat/tile URLs; WebViews lack loading/error handlers; `Linking.openURL(...).catch(() => undefined)` or uncaught promises.
- Fix: Create a shared `LeafletMapFrame` with loading/error/retry/list fallback and a shared external-link helper with validation, plain error, and copy fallback.

### Assignee loading or failure looks like an unassigned-only team
- Severity: high
- Kind: state
- Where: apps/mobile/src/components/staff/case/UpdateCaseSheet.tsx:39; apps/mobile/src/components/staff/case/UpdateCaseSheet.tsx:50; apps/mobile/src/components/staff/case/UpdateCaseSheet.tsx:58
- What's wrong: The update sheet shows “Unassigned” as the only choice and can save while the worker directory is pending or failed.
- Evidence: `workers.data ?? []`; no pending/error branch; save is disabled only when unchanged.
- Fix: Show shared loading/error/retry states and disable assignment/save until the directory resolves.

### Overdue task state freezes at mount
- Severity: high
- Kind: state
- Where: apps/mobile/src/components/staff/case/CaseTasks.tsx:18; apps/mobile/src/components/staff/case/CaseTasks.tsx:43
- What's wrong: A task that becomes late while the case stays open continues to look on time.
- Evidence: `const [now] = useState(() => Date.now())` never updates.
- Fix: Update at least each minute and on foreground, or use a shared live due-time component with an explicit “Overdue” label.

### Loading shells often discard navigation and then jump
- Severity: medium
- Kind: state
- Where: apps/mobile/src/app/auth.tsx:16; apps/mobile/src/app/staff/insights.tsx:29; apps/mobile/src/app/staff/calls/[id].tsx:51; apps/mobile/src/app/place/[id].tsx:23; apps/mobile/src/app/(main)/nearby.tsx:56
- What's wrong: Auth can wait on an unlabeled spinner; Insights/call/place details omit their normal header or geometry; Nearby inserts the map and filters after loading, shifting the page.
- Evidence: early returns with bare `ActivityIndicator`/`Loading`; successful states later add headers, cards, footer, map, and chips.
- Fix: Preserve the page shell and navigation in every state; use shaped header/card/map skeletons and a bounded auth recovery state.

## Maps

### All maps are embedded cards
- Severity: high
- Kind: map
- Where: apps/mobile/src/app/(main)/nearby.tsx:53; apps/mobile/src/app/(main)/nearby.tsx:135; apps/mobile/src/app/(main)/safety.tsx:113; apps/mobile/src/components/SafetyMap.tsx:160; apps/mobile/src/app/staff/map.tsx:51; apps/mobile/src/app/staff/map.tsx:114; apps/mobile/src/app/staff/alerts/[id].tsx:131; apps/mobile/src/app/staff/alerts/[id].tsx:320; apps/mobile/src/components/PinMap.tsx:81
- What's wrong: Nearby is 240px high, resident/staff safety maps 480px, and urgent response 200px, all inside scrolling/padded pages. Panning competes with scrolling and selected details leave the spatial context.
- Evidence: `height: 240`, `height: 480`, `height: 200`, and rounded bordered frames.
- Fix: Use the shared full-screen map shell described in Known issues, with overlays and a selected-point bottom sheet.

### Maps do not show the user's location
- Severity: high
- Kind: map
- Where: apps/mobile/src/components/PinMap.tsx:35; apps/mobile/src/components/PinMap.tsx:54; apps/mobile/src/components/SafetyMap.tsx:76; apps/mobile/src/components/SafetyMap.tsx:88; apps/mobile/src/app/staff/alerts/[id].tsx:263; apps/mobile/src/app/staff/alerts/[id].tsx:284; apps/mobile/src/services/deviceLocation.ts:6; apps/mobile/src/lib/location.ts:20
- What's wrong: Every map centers on a fixed Milwaukee point and has no blue dot, accuracy ring, recenter control, or map-specific denied state. Urgent Alert obtains location only for text distance.
- Evidence: map props accept no device coordinate; alert never passes its location into `PinMap`.
- Fix: Pass optional current position into Leaflet, keep it device-local, render blue dot/accuracy, add 44-point recenter, and provide Retry/Open Settings when denied.

### Permanent labels and unclustered points make dense maps unreadable
- Severity: high
- Kind: map
- Where: apps/mobile/src/components/PinMap.tsx:35; apps/mobile/src/components/PinMap.tsx:39; apps/mobile/src/app/(main)/nearby.tsx:46; apps/mobile/src/services/resources.ts:10; apps/mobile/src/app/staff/map.tsx:26; apps/mobile/src/components/SafetyMap.tsx:38; apps/mobile/src/components/SafetyMap.tsx:51
- What's wrong: Every PinMap marker permanently shows full text, Nearby uses one green for all places, resource results are unbounded, Staff Map can load 500 cases, and SafetyMap can draw hundreds of points individually.
- Evidence: `bindTooltip(...,{permanent:true})`; `pins.forEach`; `.slice(0, 220)` and `.slice(0, 600)`.
- Fix: Remove permanent labels, color by category with a text legend, show names on selection, and cluster/grid-aggregate at low zoom.

### Map filters reload the document and reset the viewport
- Severity: medium
- Kind: state
- Where: apps/mobile/src/components/PinMap.tsx:56; apps/mobile/src/components/PinMap.tsx:70; apps/mobile/src/components/SafetyMap.tsx:101; apps/mobile/src/components/SafetyMap.tsx:123; apps/mobile/src/app/(main)/nearby.tsx:35; apps/mobile/src/app/(main)/safety.tsx:44
- What's wrong: Search/filter changes regenerate the HTML source, reloading Leaflet, recentering/refitting, closing popups, and flashing the map.
- Evidence: memoized HTML keyed to `pins`/`points` is passed as a new `source={{ html }}`.
- Fix: Load the document once and update Leaflet layer groups through postMessage/injected JavaScript while preserving bounds, zoom, and selection.

### Pin selection means something different on every map
- Severity: medium
- Kind: cohesion
- Where: apps/mobile/src/app/(main)/nearby.tsx:58; apps/mobile/src/app/staff/map.tsx:83; apps/mobile/src/app/staff/map.tsx:88; apps/mobile/src/app/staff/alerts/[id].tsx:274; apps/mobile/src/components/SafetyMap.tsx:81
- What's wrong: A pin navigates immediately, inserts a row below the fold, does nothing, or opens WebView/native details depending on the screen.
- Evidence: `router.push`, `setSelectedId`, `onSelect={() => undefined}`, Leaflet popups, and coordinate-tap sheet behavior.
- Fix: Standardize tap to select/enlarge a pin and open a native bottom card with one explicit action.

## Accessibility and real-world use

### Quick exit scrolls out of reach
- Severity: high
- Kind: accessibility
- Where: apps/mobile/src/components/Page.tsx:26; apps/mobile/src/components/Page.tsx:32; apps/mobile/src/components/resident.tsx:381; apps/mobile/src/components/resident.tsx:391; apps/mobile/src/app/(main)/safety.tsx:113
- What's wrong: On resident tab screens, Quick exit is ordinary content inside `Page`'s `ScrollView`, so it disappears on long pages. Pushed `ResidentScreen` flows correctly keep it outside their body scroll.
- Evidence: `ResidentHeader` is rendered among scroll children; Safety is a long example.
- Fix: Put a persistent resident header above the scroll body or use a safe-area overlay with a full 44×44 target.

### Map interactions have no complete screen-reader equivalent
- Severity: high
- Kind: accessibility
- Where: apps/mobile/src/components/PinMap.tsx:39; apps/mobile/src/components/PinMap.tsx:69; apps/mobile/src/components/SafetyMap.tsx:81; apps/mobile/src/components/SafetyMap.tsx:122; apps/mobile/src/app/staff/map.tsx:81
- What's wrong: Bare WebViews expose no useful label/action; Safety area inspection requires tapping an arbitrary coordinate and Staff Map reveals case detail only after a pin tap. Nearby has a separate list, so the gap is not universal.
- Evidence: Leaflet click handlers are the only selection path; WebViews have no accessibility props or synchronized native controls.
- Fix: Label each WebView and provide a native “Browse map items/areas” sheet using shared `Group`/`Row`, with selection announcements and non-color metadata.

### Per-second timers can continuously interrupt screen readers
- Severity: high
- Kind: accessibility
- Where: apps/mobile/src/components/staff/Urgent.tsx:19; apps/mobile/src/components/staff/Urgent.tsx:170; apps/mobile/src/app/staff/alerts/[id].tsx:160; apps/mobile/src/app/staff/alerts/[id].tsx:165; apps/mobile/src/components/staff/VoiceRecorder.tsx:44; apps/mobile/src/components/staff/VoiceRecorder.tsx:95
- What's wrong: Urgent countdowns and the recorder clock are polite live regions that continually change, competing with Accept, Pass, Stop, and case content.
- Evidence: one-second `useNow`; recorder updates every 120ms; changing text has `accessibilityLiveRegion="polite"`.
- Fix: Remove live regions from ticking text and announce only meaningful milestones such as 60/30/10/0 seconds and recording start/stop.

### Shared action controls fall below 44 points
- Severity: medium
- Kind: accessibility
- Where: apps/mobile/src/components/ui.tsx:617; apps/mobile/src/components/Segmented.tsx:46; apps/mobile/src/components/staff/kit.tsx:247; apps/mobile/src/components/resident.tsx:411; apps/mobile/src/components/staff/Urgent.tsx:208; apps/mobile/src/components/OpportunityCard.tsx:169
- What's wrong: Chips, segments, choice tokens, resident pills, opportunity actions, and urgent Accept/Pass are roughly 28–38 points high.
- Evidence: `minHeight: 32`; `paddingVertical: 6–8`; urgent override `minHeight: 36`.
- Fix: Make the pressable frame at least 44 points in shared primitives; compact visuals can remain centered within it.

### Field labels are not attached to inputs by default
- Severity: medium
- Kind: accessibility
- Where: apps/mobile/src/components/ui.tsx:430; apps/mobile/src/components/ui.tsx:442; apps/mobile/src/components/ui.tsx:445
- What's wrong: `Field` renders a visible label as a sibling but does not derive the TextInput's accessible name from it.
- Evidence: `<FieldLabel>` is followed by `<TextInput {...rest}>` with no label mapping.
- Fix: Default `accessibilityLabel` to the explicit field label, then placeholder; allow callers to override.

### Key light-theme colors miss normal-text contrast
- Severity: medium
- Kind: accessibility
- Where: apps/mobile/src/theme/tokens.ts:24; apps/mobile/src/theme/tokens.ts:30; apps/mobile/src/components/ui.tsx:445; apps/mobile/src/components/resident.tsx:402; apps/mobile/src/components/staff/Urgent.tsx:201
- What's wrong: `#8C979B` is 2.99:1 on white (2.83:1 on the page background), and white on `#E92626` is 4.40:1; all cited uses are 12–15px normal text.
- Evidence: tertiary placeholders and white Quick exit/urgent text use those combinations.
- Fix: Darken the tertiary token and use `theme.danger` or a dedicated accessible urgent-red surface.

### Large text is constrained instead of reflowing
- Severity: medium
- Kind: accessibility
- Where: apps/mobile/src/components/resident.tsx:73; apps/mobile/src/components/resident.tsx:387; apps/mobile/src/components/Segmented.tsx:35; apps/mobile/src/components/staff/kit.tsx:130; apps/mobile/src/components/staff/kit.tsx:133; apps/mobile/src/app/staff/index.tsx:159; apps/mobile/src/components/CallSummary.tsx:270; apps/mobile/src/components/CallSummary.tsx:284
- What's wrong: Headers and equal-width segments force one line, metrics shrink, four staff stats share one row, charts reserve fixed label widths, and hour labels drop to 9px.
- Evidence: `numberOfLines={1}`, `adjustsFontSizeToFit`, fixed horizontal layouts, `fontSize: 9`.
- Fix: Allow two-line headings/segments, wrap metrics to two columns, let labels flex, and test the shared primitives at maximum accessibility text size.

### Message composer ignores the bottom safe area
- Severity: medium
- Kind: accessibility
- Where: apps/mobile/src/app/staff/_layout.tsx:36; apps/mobile/src/app/staff/_layout.tsx:73; apps/mobile/src/app/staff/cases/[id]/messages.tsx:137; apps/mobile/src/app/staff/cases/[id]/messages.tsx:205
- What's wrong: Messages remove the safe-area-aware tab bar, but the bottom composer adds only fixed padding and can crowd the home indicator.
- Evidence: layout applies only top inset; composer uses `padding: space.md` and never reads bottom insets.
- Fix: Add `paddingBottom: insets.bottom + space.md`.

## Things to cut or simplify

### Local-only community reporting pretends to submit
- Severity: high
- Kind: unnecessary
- Where: apps/mobile/src/app/(main)/safety.tsx:21; apps/mobile/src/app/(main)/safety.tsx:51; apps/mobile/src/app/(main)/safety.tsx:97; apps/mobile/src/app/(main)/safety.tsx:138; apps/mobile/src/app/(main)/safety.tsx:178; apps/mobile/src/app/(main)/safety.tsx:207
- What's wrong: “Report nearby activity” shows success and adds a community point, but the report exists only in component state, reaches nobody, and disappears on remount.
- Evidence: `setReports(...)`; `"Share only what neighbors need"`; `"Reports stay on this device in the MVP."`
- Fix: Remove the action, Community filter, report sheet, hard-coded report coordinates, and local state until persistence, moderation, expiry, and delivery status exist.

### Made-up sample resources remain actionable
- Severity: high
- Kind: hacked-together
- Where: apps/mobile/src/components/resident.tsx:366; apps/mobile/src/app/(main)/nearby.tsx:31; apps/mobile/src/app/(main)/nearby.tsx:119; apps/mobile/src/app/place/[id].tsx:57; apps/mobile/src/app/place/[id].tsx:68; apps/mobile/src/components/staff/ResourcePicker.tsx:74; apps/mobile/src/components/staff/case/CaseReferrals.tsx:44
- What's wrong: Resources explicitly “made up for the demo” remain callable, navigable, and referable. A small sample badge is not adequate protection for residents in crisis.
- Evidence: `is_sample` only adds a badge; Call, Directions, selection, and referral actions remain enabled.
- Fix: Exclude samples from production resident and referral queries; keep them only in explicit demo/dev environments.

### Resident Safety contains an analyst dashboard
- Severity: medium
- Kind: unnecessary
- Where: apps/mobile/src/app/(main)/safety.tsx:165; apps/mobile/src/components/CallSummary.tsx:169; apps/mobile/src/components/CallSummary.tsx:177; apps/mobile/src/components/CallSummary.tsx:210; apps/mobile/src/components/CallSummary.tsx:223
- What's wrong: Calls-per-hour, type, district, common-call, and latest-call charts bury immediate safety and emergency tasks.
- Evidence: `Calls per hour`, `By type`, `By police district`, `Most common call types`, `Latest calls`.
- Fix: Keep a short delayed-call summary and relevant recent calls; move operational charts to Staff Insights or cut them.

### Push-test diagnostics occupy production staff Me
- Severity: medium
- Kind: unnecessary
- Where: apps/mobile/src/app/staff/me.tsx:131; apps/mobile/src/app/staff/me.tsx:150; apps/mobile/src/app/staff/me.tsx:158
- What's wrong: “Send a test notification” is deployment verification tooling shown as an everyday setting, even when push is unsupported.
- Evidence: the documented purpose is to “check the whole path”; success promises arrival in seconds.
- Fix: Remove from production Me or gate it behind an admin/development diagnostics area.

### Phone follow-ups are duplicated across three concepts
- Severity: medium
- Kind: unnecessary
- Where: apps/mobile/src/app/(main)/me.tsx:120; apps/mobile/src/app/(main)/me.tsx:161; apps/mobile/src/app/(main)/alerts.tsx:67; apps/mobile/src/app/referrals/index.tsx:12
- What's wrong: The same call follow-ups appear inline in Me, in Safety Alerts, and again in Past referrals.
- Evidence: each route calls the follow-up/referral data and renders overlapping history.
- Fix: Keep one canonical call/referral history surface; Me should link to it and Safety Alerts should remain safety-focused.

### Staff opportunity creation blocks management
- Severity: medium
- Kind: unnecessary
- Where: apps/mobile/src/app/staff/opportunities.tsx:33; apps/mobile/src/app/staff/opportunities.tsx:95; apps/mobile/src/app/staff/opportunities.tsx:174; apps/mobile/src/app/staff/opportunities.tsx:178
- What's wrong: Every visit starts with a roughly ten-field creation form, so closing, reopening, or reviewing existing posts requires scrolling past it.
- Evidence: `<NewOpportunity />` renders before `<Posted />`.
- Fix: Lead with Posted and a single “Post an opportunity” button; open creation in a dedicated route or sheet.

### Static and vanity rows lengthen already dense screens
- Severity: low
- Kind: unnecessary
- Where: apps/mobile/src/app/(main)/me.tsx:47; apps/mobile/src/app/staff/index.tsx:49; apps/mobile/src/app/staff/calls/index.tsx:70; apps/mobile/src/app/staff/calls/index.tsx:89
- What's wrong: The Quick exit explanation looks like a setting but is inert; “COMFORCE STAFF” repeats known context; call totals consume queue space without filtering or action.
- Evidence: `"Quick exit opens" / "A weather site"`; `"COMFORCE STAFF"`; passive Calls/With referrals/Urgent tiles.
- Fix: Cut the static Quick exit group and staff kicker; move useful call aggregates to Insights or turn them into actual filters.

## Per-screen scorecard

“States” covers loading, empty, error, offline, signed-out, and relevant permission states.

| Route | Flow | Cohesion | Copy | States | Top issue |
|---|---|---|---|---|---|
| Launch gate (`_layout`) | good | needs work | poor | needs work | Static 45% progress bar and pitch-like tagline |
| `/sign-in` | needs work | needs work | poor | needs work | Account-free help sits below promotional content |
| `/auth` | poor | needs work | needs work | poor | Callback can become an unlabeled unrecoverable wait |
| `/` | needs work | needs work | good | poor | Failed data appears as no request or zero nearby help |
| `/requests` | good | needs work | good | poor | Error and “No requests yet” can appear together |
| `/nearby` | needs work | needs work | good | poor | Embedded map has no location and can jump/blank |
| `/me` | needs work | needs work | needs work | poor | Notification and follow-up failures look valid |
| `/opportunities` | needs work | poor | needs work | poor | No explicit return to Me; unvirtualized list and silent actions |
| `/safety` | needs work | needs work | poor | poor | Embedded map plus misleading local-only reporting |
| `/alerts` | poor | good | poor | poor | Failed feeds look empty and safety copy contradicts its data |
| `/place/[id]` | good | needs work | good | needs work | External actions fail silently and shell jumps |
| `/help` | poor | needs work | poor | needs work | Unsafe-contact ambiguity and weak phone validation |
| `/help/received` | needs work | needs work | needs work | good | Unqualified response/outcome promises |
| `/help/notifications` | needs work | needs work | needs work | poor | Denied/unsupported permission is treated like success |
| `/help/requests` | good | needs work | good | needs work | Shared request list conflates error and empty |
| `/help/request/[id]` | good | needs work | good | needs work | Cached thread can look current after refresh failure |
| `/referrals` | poor | needs work | good | poor | Auth-required route is outside the sign-in guard |
| `/referrals/[id]` | poor | needs work | poor | poor | Unguarded route and raw enum status |
| `/staff` | needs work | needs work | good | poor | Urgent, on-call, and debrief failures disappear |
| `/staff/notifications` | poor | good | needs work | needs work | Route-less rows promise navigation and do nothing |
| `/staff/cases` | needs work | needs work | good | poor | Mine can be a false empty state while identity is unknown |
| `/staff/cases/new` | poor | needs work | needs work | poor | Stale AI triage, false assignment, and draft loss |
| `/staff/cases/[id]` | needs work | needs work | good | poor | Failed assignee lookup looks like an unassigned-only team |
| `/staff/cases/[id]/messages` | poor | good | needs work | poor | No refresh; loading/error has no visible exit |
| `/staff/records/new` | poor | needs work | good | poor | Cancel/mode switching can lose work and local audio |
| `/staff/records/[id]` | poor | needs work | needs work | needs work | Edits and debrief can be discarded without confirmation |
| `/staff/calls` | good | needs work | needs work | good | AI-heavy framing and bespoke cards |
| `/staff/calls/[id]` | good | needs work | needs work | needs work | Bare loading state and request/case terminology |
| `/staff/alerts/[id]` | needs work | needs work | good | needs work | Embedded map lacks responder location and recovery |
| `/staff/map` | needs work | needs work | good | poor | Fixed map can silently show blank/zero data |
| `/staff/oncall` | good | needs work | needs work | needs work | Role UI jumps and seven day targets are too small |
| `/staff/team` | poor | needs work | needs work | poor | One tap can revoke staff access |
| `/staff/insights` | needs work | good | good | poor | Loading/error drops normal navigation context |
| `/staff/opportunities` | poor | poor | needs work | needs work | Creation form blocks management; resident actions compete |
| `/staff/me` | needs work | good | needs work | poor | Query failures look like valid placeholders/disabled settings |

## Duplicate components to consolidate

| Family | Survivor | Retire or migrate | Screens/components to move |
|---|---|---|---|
| Buttons | `components/ui.tsx` `Button`, adding outline/link variants | `resident.tsx` `BigButton`; `staff/Urgent.tsx` `OutlineButton`; `OpportunityCard.tsx` `Action`; bare text actions | Help flow, urgent actions, opportunities, Today section links, place facts |
| Cards | Promote one role-neutral `ui.SurfaceCard` from staff `Card`, with tone/padding | `resident.tsx` `Card`; raw record/new-case shells; OpportunityCard outer shell | Help/received/place, staff records/cases, both opportunity screens |
| Headers | Promote `staff/kit.tsx` `PageTitle` into role-neutral `ui.PageHeader` with leading/trailing/Quick exit slots | `ResidentHeader`; custom Today, Queue, New case, New record headers | Every resident tab and staff primary/creation screen |
| Fields | `ui.Field`, adding filled/outlined appearances and automatic accessibility label | `resident.tsx` `Input`; bespoke search/text fields | Help, Nearby/Opportunities search, staff forms |
| Chips and choices | `ui.Chip` foundation with semantic wrappers | `resident.Pill`; staff `ChoiceRow` token implementation; `Segmented` internals | Help contact/location choices, queue/case tabs, filters, on-call day strip |
| Lists and rows | `ui.Group`/`Row`/`GroupItem`; keep `CaseLine` for case-domain rows | Raw call cards; Debriefs row; static settings-like cards | Calls, Today, debriefs, referrals, activity links |
| Empty/loading/error | `EmptyState`, shell-preserving skeletons, audience-safe `ErrorBanner`, `RefreshError` | loose empty text; bare spinner early returns; raw API messages | All list/detail screens, especially Home/Alerts/Today/Insights |
| Screen container | `components/Page.tsx` for tab screens; `ResidentScreen` only for pushed resident flows | unused `ui.Screen` after folding in needed inset behavior | Remove ambiguity for all new screens |
| Map shell | New shared `LeafletMapFrame` + full-screen native wrapper | separate PinMap/SafetyMap frames, error handling, and selection conventions | Nearby, Safety, Staff Map, urgent response |

