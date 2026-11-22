# Expo web journey findings

Run date: 2026-11-21 (America/Chicago)

## 1. Run summary

Five testers ran in parallel in separate Playwright Chromium contexts against exactly
`http://localhost:8081`. Each context used a 390×844 viewport, device scale factor 3,
mobile/touch emulation, `en-US`, `America/Chicago`, and Milwaukee geolocation. Each
tester also made a 320 px and 150% root-font pass. The API, worker, and Metro health
gates passed before testing, stayed up during the run, and were left running. Tester E
simulated API failure, offline state, and a four-second network delay only inside its
own context. All five browsers were closed. No app code, migration, environment file,
or Auth0 setting was changed, and nothing was committed.

What ran:

- A: J1, J3, J4, and the resident half of J2.
- B: J5, offline queue, weather, bed counts, and signed-out notification opt-in.
- C: J6, J7, and the staff half of J2.
- D: J8, partners, consented sharing, requester texts, and need vs coverage.
- E: J9 and J10 under API-abort, Chromium offline, and slow-network conditions.
- J2 completed end to end: staff and resident messages appeared without a manual
  reload, and the case was resolved.
- Partners, the browser-observable requester-text flow, and the coverage list/detail
  fallback worked. Weather and fresh bed-count behavior were blocked by the absence
  of active local data. The signed-out notification control was not present on web.

Counts after reconciling duplicate observations: **2 blocker, 14 high, 13 medium,
2 low**; **17 known** audit/plan problems still reproduce and **14 are new**.

Web-unsupported (recorded once, not counted as findings):

- WebView maps themselves: Nearby, Safety, Staff Map, Coverage, and urgent response.
  Their surrounding lists, filters, details, and fallback/error states were tested.
- Push notifications and lock-screen behavior. The in-app inbox/banner surfaces were
  tested where available.
- Actual voice recording. The typed debrief and the quality of the web fallback were
  tested.
- Native `tel:`, `sms:`, Directions, and haptic effects. Link formation and control
  response were inspected.
- The Android back gesture; browser back was used as the stand-in.

## 2. Top 10 new problems

1. Offline submission can hang without a queued state and create duplicate cases
   when connectivity returns.
2. Consented sharing records `told me` even though the worker is never asked how
   consent was given.
3. The signed-out help form has no urgency control, so the prescribed J6 urgent
   request cannot page the on-call worker.
4. Past referrals navigates to `/referrals/index` as though `index` were a referral
   ID, producing a validation-error dead end.
5. Nearby has neither a recoverable error nor a loading state: API failure and slow
   responses both leave a nearly blank shell.
6. The request thread says only ComForce messages appear while displaying the
   resident's reply directly above that sentence.
7. Slow message sends have no positive progress/confirmation state for more than ten
   seconds.
8. Admin role controls overflow their card and viewport at 320 px instead of wrapping.
9. New debrief silently removes the recorder on web rather than explaining the typed
   fallback.
10. Revisiting a receipt resets its timeline to “Received — Just now.”

## 3. Findings by journey

### J1 — Resident asks for help

#### Auth0 exposes hackathon and development branding

- **Severity:** medium
- **Known or new:** new
- **Tester and account:** A and B; signed out, then `member`
- **Steps to reproduce:** Open sign-in, choose **I already have an account**, and view
  Universal Login and its consent screen.
- **Expected vs actual:** Expected ComForce identity; actual copy says “Cooli,”
  “Hacksgiving Mobile (dev),” and “Authorize App.”
- **Screenshot path:** `docs/review/journey-shots/web-j1-auth0-hacksgiving-name.png`
  and `docs/review/journey-shots/web-J5-auth0-consent-dev-copy.png`
- **Suggested fix:** Add a Wave 1 Auth0/product-branding step alongside plan 1.13.

#### Receipt still makes an unconditional one-hour promise

- **Severity:** medium
- **Known or new:** known — audit **Response-time claims are unconditional**, plan
  1.13; still reproduces
- **Tester and account:** A; signed out
- **Steps to reproduce:** Submit a signed-out call request and read the receipt intro
  and timeline.
- **Expected vs actual:** Expected a qualified staffing-dependent estimate; both
  locations say “usually within the hour.”
- **Screenshot path:** `docs/review/journey-shots/web-j1-receipt-response-promise.png`
- **Suggested fix:** Apply the plan 1.13 copy pass to both receipt strings.

#### Revisiting a receipt resets its time to “Just now”

- **Severity:** medium
- **Known or new:** new
- **Tester and account:** A; signed out
- **Steps to reproduce:** Submit request #1014, wait about 14 minutes, and revisit
  `/help/received`.
- **Expected vs actual:** Expected the original submission time; actual timeline says
  “Received — Just now.”
- **Screenshot path:** `docs/review/journey-shots/web-j1-receipt-response-promise.png`
- **Suggested fix:** Add a Wave 5 J1 timestamp check and use a persisted timestamp in
  the shared relative-time component.

#### Offline submit hangs and can create duplicates

- **Severity:** high
- **Known or new:** new
- **Tester and account:** B (`member`) and E (`admin` in community view)
- **Steps to reproduce:** Fill Help with `UXSWARM` data, call
  `context.setOffline(true)`, press **Send request** once, wait 12–15 seconds, then
  restore connectivity.
- **Expected vs actual:** Expected immediate “saved on this phone/queued” confirmation
  and one eventual case. The button became an unlabeled blank/spinner and the form
  hung; E's one click later created two cases (#1020 and #1021). The route-abort J1
  variant did show **Saved on your phone** and synced exactly once, so behavior differs
  by failure mode.
- **Screenshot path:** `docs/review/journey-shots/web-J10-offline-J1-stuck-sending.png`,
  `docs/review/journey-shots/web-J10-offline-J1-duplicate-requests.png`, and
  `docs/review/journey-shots/web-J10-api-down-J1-offline-queued.png`
- **Console or network evidence:** No `requestfailed` event appeared during the stuck
  interval; a later navigation produced `POST net::ERR_ABORTED`.
- **Suggested fix:** Add a Wave 2A offline-queue/idempotency step and a Wave 5 J1
  regression for abort versus browser-offline behavior.

#### Safe-to-text checkbox is 22 px tall and exposes no checked state

- **Severity:** medium
- **Known or new:** new
- **Tester and account:** B; signed out
- **Steps to reproduce:** On Help choose **Text**, inspect and toggle the safe-to-text
  checkbox.
- **Expected vs actual:** Expected a target at least 44 px high with a programmatic
  checked state; bounding box was 350×22 CSS px and `aria-checked` stayed null.
- **Screenshot path:** `docs/review/journey-shots/web-notify-safe-checkbox-22px.png`
- **Suggested fix:** Add a shared accessible checkbox/toggle to Wave 4.

### J2 — Resident gets a reply

#### Request-thread title truncates at normal 390 px width

- **Severity:** medium
- **Known or new:** known — audit **Large text is constrained instead of reflowing**,
  plan 4.2; still reproduces
- **Tester and account:** A; `member`
- **Steps to reproduce:** Open the thread for #1014 with its `UXSWARM` title.
- **Expected vs actual:** Expected a readable two-line title; actual title is
  ellipsized even at normal text size.
- **Screenshot path:** `docs/review/journey-shots/web-j2-thread-title-truncated.png`
- **Suggested fix:** Use the two-line plan 4.2 `PageHeader`.

#### Thread explanation contradicts the visible resident reply

- **Severity:** medium
- **Known or new:** new
- **Tester and account:** A; `member`
- **Steps to reproduce:** Receive C's staff reply, send the resident reply, and inspect
  the bottom of the thread without reloading.
- **Expected vs actual:** Expected copy covering both sides of the conversation;
  actual resident reply appears immediately above “Only messages ComForce sends you
  appear here.”
- **Screenshot path:** `docs/review/journey-shots/web-j2-resident-reply-copy-contradiction.png`
- **Suggested fix:** Add the thread explanation to plan 1.13's product-copy pass.

#### Shared action targets remain below 44 CSS px

- **Severity:** medium
- **Known or new:** known — audit **Shared action controls fall below 44 points**,
  plans 4.2, 4.3, and 4.6; still reproduces
- **Tester and account:** A (`member`), C (`worker`), D (`worker`), E (`admin`)
- **Steps to reproduce:** Measure request-thread Back/Call me, Nearby chips, New-case
  Cancel, urgent Call 911, message AI draft/Send, Team role choices, and Today on-call.
- **Expected vs actual:** Expected each pressable frame to be at least 44×44; measured
  examples include Back 24×26, chips 32 px high, Cancel 26×28, Call 911 36 px high,
  AI draft 32 px high, Send 42×42, role choices 32 px high, and on-call 40×20.
- **Screenshot path:** `docs/review/journey-shots/web-j2-thread-title-truncated.png`,
  `docs/review/journey-shots/web-J10-message-controls-under-44.png`, and
  `docs/review/journey-shots/web-J9-role-changed-without-confirmation.png`
- **Suggested fix:** Complete the shared pressable-frame work in plans 4.2/4.3/4.6.

### J3 — Resident finds nearby help

#### Nearby has no failure recovery or loading feedback

- **Severity:** high
- **Known or new:** new
- **Tester and account:** E; `admin` in community view
- **Steps to reproduce:** Open Nearby with `/v1/resources` aborted, then repeat with
  every API response delayed four seconds.
- **Expected vs actual:** Expected a recoverable error or loading shell plus list
  fallback. API failure leaves only the header, Safety row, and All filter; slow load
  shows the same blank shell for about four seconds before content jumps in.
- **Screenshot path:** `docs/review/journey-shots/web-J10-api-down-J3.png` and
  `docs/review/journey-shots/web-J10-slow-J3-no-loading-feedback.png`
- **Console or network evidence:** Failed run: `GET /v1/resources net::ERR_FAILED`.
  Slow run: the request completed in about 4030 ms.
- **Suggested fix:** Adopt plan 2A on Nearby and connect it to the Wave 3 step 2 list
  fallback.

### J4 — Resident checks safety

#### Quick exit is undersized and scrolls out of reach

- **Severity:** high
- **Known or new:** known — audit **Quick exit scrolls out of reach**, plan 1.15;
  still reproduces
- **Tester and account:** A; signed out and `member`
- **Steps to reproduce:** Measure Quick exit on sign-in, Nearby, or Alerts, then scroll
  Safety to the bottom.
- **Expected vs actual:** Expected a persistent 44×44 control; measured target is
  about 105×31 and its Safety bounding box moves to y=-2816.
- **Screenshot path:** `docs/review/journey-shots/web-j1-signin-quick-exit.png` and
  `docs/review/journey-shots/web-j4-quick-exit-out-of-reach-and-report.png`
- **Suggested fix:** Implement plan 1.15 and the pinned plan 4.2 header.

#### Local-only community reporting remains actionable

- **Severity:** high
- **Known or new:** known — audit **Local-only community reporting pretends to
  submit**, plan 1.5; still reproduces
- **Tester and account:** A; `member`
- **Steps to reproduce:** Scroll near the bottom of Safety.
- **Expected vs actual:** Expected the local-only feature removed; actual full-width
  **Report nearby activity** action remains.
- **Screenshot path:** `docs/review/journey-shots/web-j4-quick-exit-out-of-reach-and-report.png`
- **Suggested fix:** Complete plan 1.5 removal.

#### Alerts calls the same dispatch feed live and not live

- **Severity:** high
- **Known or new:** known — audit **Delayed dispatch data is repeatedly called live**,
  plan 1.4; still reproduces
- **Tester and account:** A and B; `member`
- **Steps to reproduce:** Open Safety Alerts.
- **Expected vs actual:** Expected the shared delayed-dispatch label; actual screen
  says “Live dispatch feed · 14” and later “Not live: MPD publishes calls 30–90 min
  after dispatch.”
- **Screenshot path:** `docs/review/journey-shots/web-j4-live-feed-contradiction.png`
- **Suggested fix:** Apply plan 1.4's one `CALL_WINDOW_HOURS` copy source.

### J5 — Resident links a phone call

#### Past referrals opens an invalid detail route

- **Severity:** high
- **Known or new:** new
- **Tester and account:** B; `member`
- **Steps to reproduce:** Open Me and choose **Past referrals**.
- **Expected vs actual:** Expected canonical referral history; actual URL is
  `/referrals/index`, titled “Referral details,” and shows “Request validation failed”
  plus a request UUID.
- **Screenshot path:** `docs/review/journey-shots/web-J5-referrals-list.png`
- **Suggested fix:** Correct the index-versus-`[id]` collision in the Wave 4 canonical
  history work.

#### Raw backend and development errors still reach people

- **Severity:** medium
- **Known or new:** known — audit **Raw backend and development errors reach users**,
  plan 2E; still reproduces
- **Tester and account:** B (`member`) and E (`admin`)
- **Steps to reproduce:** Submit a valid-shape call handoff code; create an overlapping
  on-call shift; or abort the API while opening staff Queue.
- **Expected vs actual:** Expected plain-language recovery. Actual examples include
  “Call handoff is not configured,” validation text, request UUIDs, and “Can't reach
  the Hacksgiving API at http://100.102.172.1:8000/v1 (Failed to fetch).”
- **Screenshot path:** `docs/review/journey-shots/web-J5-invalid-code-error.png`,
  `docs/review/journey-shots/web-J9-oncall-conflict-raw-request-id.png`, and
  `docs/review/journey-shots/web-J10-api-down-J7-stuck-12s.png`
- **Console or network evidence:** On-call conflict returned 409; API-abort staff gate
  logged `GET /staff/me net::ERR_FAILED` after about 12 seconds.
- **Suggested fix:** Finish plan 2E `userMessage(error, audience)` and hide technical
  details behind disclosure.

#### Call-handoff field is 42 px tall

- **Severity:** low
- **Known or new:** new
- **Tester and account:** B; `member`
- **Steps to reproduce:** Open Me → Phone calls and measure the handoff-code input at
  390 and 320 px.
- **Expected vs actual:** Expected a 44 px minimum input target; measured 196×42 CSS px.
- **Screenshot path:** `docs/review/journey-shots/web-J5-call-code-target.png`
- **Suggested fix:** Include a 44 px input minimum in plan 4.5 `Field`.

### J6 — Staff urgent response

#### Signed-out Help has no urgency control

- **Severity:** high
- **Known or new:** new
- **Tester and account:** C; signed out, then `worker`
- **Steps to reproduce:** With worker on call, open signed-out Help and try to submit
  an urgent-today/no-immediate-danger request.
- **Expected vs actual:** Expected the J6 request to page on-call staff. The form has
  only description, location, and contact; #1015 was created Medium with zero urgent
  alerts and had to be manually changed to High + Unassigned.
- **Screenshot path:** `docs/review/journey-shots/web-J6-help-form.png` and
  `docs/review/journey-shots/web-J6-return-staff.png`
- **Suggested fix:** Add a Wave 5 J6 urgency control/contract step or change the journey
  to the supported urgent entry point.

#### Urgent alert omits a map fallback

- **Severity:** high
- **Known or new:** known — audit **Map and external-link failures can look like dead
  controls or blank content**, Wave 3 step 2; still reproduces
- **Tester and account:** C; `worker`
- **Steps to reproduce:** Open the urgent alert detail after #1015 is High + Unassigned.
- **Expected vs actual:** Expected calm unsupported/error copy, Retry, or a list/location
  fallback; location is followed directly by countdown/actions with the map area blank.
- **Screenshot path:** `docs/review/journey-shots/web-J6-alert-detail.png`
- **Suggested fix:** Apply Wave 3 step 2 to urgent response.

#### Responding screen still has no Record a debrief action

- **Severity:** blocker
- **Known or new:** known — Wave 5 step 1 missing link; still reproduces
- **Tester and account:** C; `worker`
- **Steps to reproduce:** Accept the alert and choose **I've arrived**.
- **Expected vs actual:** Expected an in-flow debrief action; actual screen only shows
  Open case, Call 911, and On scene, forcing the worker to use the tab bar.
- **Screenshot path:** `docs/review/journey-shots/web-J6-arrived.png`
- **Suggested fix:** Build the first demo-critical Wave 5 step 1 link.

#### Typed debrief cannot update the accepted case

- **Severity:** blocker
- **Known or new:** known — Wave 5 step 1 missing link; still reproduces
- **Tester and account:** C; `worker`
- **Steps to reproduce:** Leave Responding for Record, type a debrief for #1015, and
  wait for **Check before saving**.
- **Expected vs actual:** Expected to attach/update #1015; actual review offers only
  **Create case**, so completing it would create a duplicate.
- **Screenshot path:** `docs/review/journey-shots/web-J6-debrief-via-tab.png` and
  `docs/review/journey-shots/web-J6-debrief-status.png`
- **Suggested fix:** Build the second demo-critical Wave 5 step 1 link.

### J7 — Staff routine case

#### Destructive staff actions still mutate without confirmation

- **Severity:** high
- **Known or new:** known — audit **Destructive staff actions need explicit
  confirmation**, plan 2B; still reproduces
- **Tester and account:** C (`worker`) and E (`admin`)
- **Steps to reproduce:** Press **Mark resolved** on a case or change Worker to Admin
  on Team & roles.
- **Expected vs actual:** Expected a consequence/confirmation sheet; PATCH or role
  mutation happens immediately with zero dialogs. The test role was restored.
- **Screenshot path:** `docs/review/journey-shots/web-J10-slow-J7-resolve-without-confirmation.png`
  and `docs/review/journey-shots/web-J9-role-changed-without-confirmation.png`
- **Suggested fix:** Complete plan 2B `ConfirmSheet`/resolved-update flow.

#### Selected Queue tab does not return to Queue root

- **Severity:** medium
- **Known or new:** new
- **Tester and account:** C; `worker`
- **Steps to reproduce:** From a case detail, tap the already-selected bottom Queue tab.
- **Expected vs actual:** Expected Queue root; URL remains the case-detail URL after
  1.5 seconds. The header Queue link does work.
- **Screenshot path:** `docs/review/journey-shots/web-J7-active-queue-tab-noop.png`
- **Suggested fix:** Add a plan 2C shared TabBar root-navigation rule.

#### Sample resources remain actionable in referral picker

- **Severity:** high
- **Known or new:** known — audit **Made-up sample resources remain actionable**,
  plan 1.6; still reproduces in local/demo mode (the plan intentionally keeps local
  sample referrals enabled)
- **Tester and account:** C; `worker`
- **Steps to reproduce:** Add a referral to #1015 and choose **Emergency Family Shelter
  (Sample)**.
- **Expected vs actual:** Expected production-safe gating; local journey allowed Add
  and a Completed outcome on a visibly sample resource. This is consistent with the
  plan's local/demo exception but confirms the risky surface remains testable.
- **Screenshot path:** `docs/review/journey-shots/web-J7-resource-picker.png` and
  `docs/review/journey-shots/web-J7-referral-completed.png`
- **Suggested fix:** Verify the plan 1.6 environment gate in the later production pass.

#### Queue displays false zero counts while data fails or loads

- **Severity:** high
- **Known or new:** known — audit **Critical feeds turn failures into empty or zero
  results**, plan 2A; still reproduces
- **Tester and account:** E; `admin`
- **Steps to reproduce:** Open Queue while Chromium is offline, then repeat with a
  four-second API delay.
- **Expected vs actual:** Expected offline/loading state without valid-looking counts;
  offline showed every category as 0 for more than 13 seconds, and slow mode showed
  zeros beside skeletons before jumping to Open 12/New 10/etc.
- **Screenshot path:** `docs/review/journey-shots/web-J10-offline-J7-after-13s.png`
  and `docs/review/journey-shots/web-J10-slow-J7-zero-counts-while-loading.png`
- **Console or network evidence:** Slow `/staff/me` and `/cases` requests each took
  about 4.04 seconds.
- **Suggested fix:** Adopt plan 2A's exclusive pending/error/empty/data states on Queue.

#### Slow message send has no clear confirmation

- **Severity:** medium
- **Known or new:** new
- **Tester and account:** E; `admin`
- **Steps to reproduce:** Under a four-second route delay, send a message from #1023.
- **Expected vs actual:** Expected explicit progress then confirmation; text remains in
  the composer with only a pale-disabled icon, and the message is not visibly confirmed
  for more than ten seconds.
- **Screenshot path:** `docs/review/journey-shots/web-J10-slow-J7-message-no-confirmation.png`
- **Console or network evidence:** POST took about 4.06 seconds and refetch another
  4.08 seconds; the message eventually appeared once.
- **Suggested fix:** Add shared mutation feedback to Wave 5's “every save confirms” bar.

### J8 — Staff creates work

#### New case and typed-debrief drafts discard without warning

- **Severity:** high
- **Known or new:** known — audit **Staff drafts and review edits can be lost without
  warning**, plan 2B; still reproduces
- **Tester and account:** D; `worker`
- **Steps to reproduce:** Enter a `UXSWARM` New case draft and press Cancel; repeat on
  a typed New debrief.
- **Expected vs actual:** Expected **Discard this draft?**; each returns immediately
  with zero dialogs and loses the draft.
- **Screenshot path:** `docs/review/journey-shots/web-j8-05-case-draft-before-cancel.png`
  and `docs/review/journey-shots/web-j8-12-debrief-draft-before-cancel.png`
- **Suggested fix:** Apply plan 2B `useUnsavedChangesGuard` to both flows.

#### Description edit leaves stale AI suggestion marked Suggested

- **Severity:** high
- **Known or new:** known — audit **Case creation can save stale triage or a false
  assignment**, plan 2D; still reproduces
- **Tester and account:** D; `worker`
- **Steps to reproduce:** Suggest for a food description, then replace the description
  with a transportation-only request.
- **Expected vs actual:** Expected suggestion invalidation; Food & meals and its food
  explanation remain marked **Suggested** until manually corrected.
- **Screenshot path:** `docs/review/journey-shots/web-j8-08-stale-suggestion-after-edit.png`
- **Suggested fix:** Clear suggestion state on every description edit per plan 2D.

#### Web debrief hides recording without explaining the fallback

- **Severity:** medium
- **Known or new:** new
- **Tester and account:** D; `worker`
- **Steps to reproduce:** Tap staff **Record** in the web build.
- **Expected vs actual:** Expected recorder UI to request permission or a plain-language
  unsupported state leading to Type; actual screen immediately shows only the textarea
  and Process debrief, with no Speak/Type choice or explanation.
- **Screenshot path:** `docs/review/journey-shots/web-j8-11-new-debrief-empty.png`
- **Suggested fix:** Add a Wave 5 J8 web-fallback requirement while preserving device
  permission behavior.

#### Sharing fabricates consent method “told me”

- **Severity:** high
- **Known or new:** new
- **Tester and account:** D; `worker`
- **Steps to reproduce:** Create a share-capable partner, open Share with partner,
  check **The person agreed to this share**, and submit.
- **Expected vs actual:** Expected the worker to select/enter how consent was obtained;
  no such control exists, yet the created share records `consent: told me`.
- **Screenshot path:** `docs/review/journey-shots/web-newstaff-08-share-sheet-initial.png`
  and `docs/review/journey-shots/web-newstaff-10-share-created.png`
- **Suggested fix:** Add a Wave 2 consent-integrity step requiring and persisting an
  explicit method/notes value.

#### Visible staff-form labels are not programmatic names

- **Severity:** medium
- **Known or new:** known — audit **Field labels are not attached to inputs by
  default**, plan 4.5; still reproduces
- **Tester and account:** D; `worker`
- **Steps to reproduce:** Inspect controls on New case, partner creation, and debrief
  review.
- **Expected vs actual:** Expected accessible names from visible labels; description,
  location, partner fields, title, summary, and contact controls all had
  `aria-label=null`.
- **Screenshot path:** `docs/review/journey-shots/web-newstaff-03-partner-sheet.png`
  and `docs/review/journey-shots/web-j8-04-new-case-empty.png`
- **Suggested fix:** Complete plan 4.5 automatic `Field` label mapping.

### J9 — Staff admin

#### Role controls overflow at 320 px

- **Severity:** medium
- **Known or new:** new
- **Tester and account:** E; `admin`
- **Steps to reproduce:** Set the viewport to 320 px and open Team & roles.
- **Expected vs actual:** Expected the three role choices to wrap/reflow within the
  Access card; they extend beyond the card and right viewport edge.
- **Screenshot path:** `docs/review/journey-shots/web-J9-team-role-controls-overflow-320.png`
- **Suggested fix:** Extend plan 4.6 so ChoiceRow wraps at narrow width and large text.

#### Switching views still looks like two unrelated features

- **Severity:** low
- **Known or new:** known — audit **Resident and staff mode switching looks like two
  unrelated apps**, Wave 4 ride-along; still reproduces
- **Tester and account:** E; `admin`
- **Steps to reproduce:** Switch from staff Me to community, then inspect resident Me.
- **Expected vs actual:** Expected one shared **Switch view** row; staff uses an ordinary
  “Switch to community view” row while resident uses an accented “Staff app / Back to
  your queue” card.
- **Screenshot path:** `docs/review/journey-shots/web-J9-switch-view-inconsistent-staff.png`
  and `docs/review/journey-shots/web-J9-switch-view-inconsistent-resident.png`
- **Suggested fix:** Complete the Wave 4 shared mode-switch row.

### J10 — Failure drill

J10's distinct findings are reported with the affected journey above: offline J1
duplication, blank/errorless J3, raw API text, fake Queue zeros, unconfirmed resolve,
and slow message confirmation. J10 failed because API-down J3 had no recovery,
offline J1 duplicated a request, and offline/slow J7 presented false valid-looking
counts. The route-abort J1 variant passed its queueing requirement.

## 4. Plan updates for new findings

| New finding | Plan placement |
|---|---|
| Auth0 hackathon/dev branding | New Wave 1 step beside 1.13 for Auth0/application display names |
| Receipt time resets on revisit | New Wave 5 J1 timestamp regression/shared relative-time source |
| Offline hang and duplicate cases | New plan 2A offline-queue state/idempotency step plus Wave 5 J1 regression |
| Safe-to-text checkbox lacks size/state semantics | New Wave 4 shared Checkbox/Toggle primitive |
| Thread explanation contradicts replies | Add to plan 1.13 copy pass |
| Nearby has no error/loading state | Add Nearby to plan 2A and connect to Wave 3 step 2 fallback |
| Past referrals routes `index` as an ID | Add route correction to Wave 4 canonical-history ride-along |
| Call-handoff input is 42 px | Add input minimum height to plan 4.5 |
| Signed-out Help has no urgent-today control | New Wave 5 J6 journey-contract step |
| Queue tab does not return to root | New plan 2C TabBar root-navigation rule |
| Slow message send lacks confirmation | New shared mutation-feedback item under Wave 5 save-confirmation bar |
| Web debrief hides recorder without explanation | New Wave 5 J8 web-fallback requirement |
| Sharing invents consent provenance | New Wave 2 consent-integrity step |
| Role choices overflow at 320 px | Extend plan 4.6 narrow-width/large-text wrapping |

## 5. Journey status

| Journey | Status | Evidence summary |
|---|---|---|
| J1 | friction | Normal and API-abort submissions worked; response copy/timestamp and browser-offline queue failed |
| J2 | friction | Full resident↔staff round trip and resolve worked without reload; copy, title, targets, and confirmation need work |
| J3 | web-unsupported | WebView map cannot run; surrounding list/place/link/back worked normally, but failure/slow states did not |
| J4 | friction | Safety/Alerts/Quick exit exercised; known Quick exit, reporting, and live-copy issues remain |
| J5 | blocked | Call handoff not configured and Past referrals routes to an invalid detail |
| J6 | fail | No urgency control, no debrief link, and no way to attach a debrief to the accepted case |
| J7 | friction | Assignment/message/referral/outcome/back completed; confirmation and failure states remain unsafe |
| J8 | fail | Case/debrief creation completed, but cancel guards, stale suggestion, and recorder fallback failed |
| J9 | friction | Role change/restore, on-call verification, and both view switches completed with confirmation/layout friction |
| J10 | fail | API-down J3, offline J1/J7, and slow J3/J7 violated recoverable-state and no-fake-empty bars |

## Created and changed `UXSWARM` data

- #1014 / `e955c786-94dd-4e54-9cdc-c6435f6d1c8b`: A's J1 request; C's staff reply;
  A's resident reply; resolved by C.
- #1015 / `7fbf5e3f-e975-43d0-b33b-39b9f668a5c4`: C's J6 urgent-text request,
  manually raised to High + Unassigned; J7 staff message; sample referral and completed
  outcome; resolved. Debrief `7a097f89-c537-41eb-83e4-3732c036f2db` remains ready for
  review and did not create a duplicate case.
- #1016 / `db7e738c-319e-40eb-8f01-3027402945ff`: B's offline-queue request, no contact.
- #1017 / `41d419bd-1ec7-49eb-8dc4-e08f28072044`: D's edited J8 transportation case;
  shared with the newly created partner below.
- #1018 / `becf1f23-42eb-44c7-b533-603a7e5e0ed1`: B's signed-out notification request,
  text contact `4145550199`.
- #1019: E's API-abort queued request; synced once after reconnect.
- #1020 and #1021: duplicate cases created from E's one offline submission.
- Debrief `0753e32a-32cc-45f2-b7ba-5ad6b811c55f2`: D's typed J8 debrief.
- #1022 / `c041dbf0-42ec-4e07-8866-cdcd5d66b26e`: case created from D's J8 debrief.
- Partner `c14ebd17-3ac3-417c-a650-763e818daa750`, **UXSWARM D Ride Partner**; one
  summary+location share from #1017 with reason **UXSWARM D transportation intake**.
- #1023: E's slow-network case; assigned to Hacksgiving Admin, Milwaukee City Services
  referral linked/completed, slow-network message sent, then resolved.
- #1024 / `65a6fe4d-97d4-4819-a342-00670255b2249`: D's safe-text requester case and
  resident message **UXSWARM D SMS journey update: we received your request and are
  reviewing ride options.**
- Hacksgiving Worker role was temporarily changed Worker → Admin → Worker and restored.
  D's two cancel-draft strings and B's `UXSWARM2` call code created no records.
