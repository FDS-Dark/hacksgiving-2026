# Cognitive-load and discoverability review

## 1. Summary

This review measured comprehension and findability in the 390×844 web build. It did not count the known web limitations (map WebViews, push/lock-screen behavior, native recording, `tel:`/`sms:`/Directions/haptics, or Android back) as findings.

| Persona | Goals completed | Partial | Failed/blocked | Completion |
|---|---:|---:|---:|---:|
| R1 — signed-out resident in crisis | 4/4 | 0 | 0 | 100% |
| R1 — 320 px, 150% text repeat | 3/4 visually | 0 | 1 safety control hidden | 75% visual |
| R2 — resident finding resources | 1/5 | 1 | 3 | 20% |
| R3 — resident after a phone call | 0/3 | 0 | 3 | 0% |
| S1 — first-shift worker | 4/6 | 2 | 0 | 67% |
| S2 — interrupted worker | 2/4 | 0 | 2 | 50% |
| S3 — admin | 4/4 | 0 | 0 | 100% |
| **Primary run total** | **15/26** | **3** | **8** | **58%** |

Across the 26 primary goals, testers used 89 tap intents, **3.4 per goal versus an expert minimum of about 2.3** (61 taps, 1.46×). This comparison excludes Auth0 and text entry, counts failed taps, and treats a task that the current UI cannot finish as ending at the shortest conclusive blocker. The largest gaps were replying to a resident (7 vs 4), starting a case (6 vs 2), finding recent work (8 vs 2), and connecting a prior phone call (4 vs 1). Evidence: [R3 call code](cognitive-shots/R3-call-code-expiry.png), [S1 reply](cognitive-shots/S1-resident-reply-sent.png), [S1 new case](cognitive-shots/S1-new-case-form.png), [S2 recent work](cognitive-shots/S2-22-recent-work-giveup.png).

The five hardest goals were: R3 finding call referrals (broken direct path and a 198-action fallback), R3 connecting a completed call (requires an expired one-time code), S2 resuming a case/debrief after interruption (draft loss), S2 finding a recently worked case (no activity-oriented view), and R2 finding food today (139 results without open-today/distance ordering). Evidence: [R3 referrals error](cognitive-shots/R3-past-referrals-validation-error.png), [R3 Nearby fallback](cognitive-shots/R3-nearby-not-call-specific.png), [S2 lost draft](cognitive-shots/S2-14-debrief-resume.png), [S2 search](cognitive-shots/S2-21-search-recent-work.png), [R2 food](cognitive-shots/R2-food-overload.png).

The highest-load measured screens were Nearby (198 actions; FK 38.9), Case Update (44; FK 20.4), Insights (38; FK 15.0), Safety (34; FK 10.6), Opportunities manager (31; FK 13.3), Debrief review (30; FK 12.9), and Queue (29; FK 35.9). Evidence: [Nearby](cognitive-shots/SCREEN-resident-nearby.png), [Case Update](cognitive-shots/SCREEN-admin-case-update-sheet.png), [Insights](cognitive-shots/SCREEN-admin-insights.png), [Safety](cognitive-shots/SCREEN-resident-safety-map.png), [Opportunities](cognitive-shots/SCREEN-admin-manage-opportunities.png), [Debrief review](cognitive-shots/SCREEN-staff-debrief-review.png), [Queue](cognitive-shots/SCREEN-staff-queue.png).

## 2. Top 10 simplifications

| Rank | Concrete change | Before → after target | Evidence |
|---:|---|---|---|
| 1 | **Move “Ask for help without an account” above both account actions** and rename it **Get help now**. | Crisis route: third visual choice and 5 taps → first choice, still 5 taps but zero account rejection decisions. | [R1 start](cognitive-shots/R1-start.png) |
| 2 | **Keep Quick exit pinned and reserve its width at every text size.** | Request detail at 320 px/150%: visually unreachable → 1 visible tap. | [R1 low-vision detail](cognitive-shots/R1-lowvision-goal2-request-detail.png) |
| 3 | **Replace Nearby’s flat directory with “Closest/open today” results, a result count, and progressive filters.** | 198 actions and FK 38.9 → ≤12 initial actions and grade ≤6; food/shelter choice becomes 1 list tap plus one detail tap. | [R2 food](cognitive-shots/R2-food-overload.png), [screen inventory](cognitive-shots/SCREEN-resident-nearby.png) |
| 4 | **Merge call follow-ups and referrals into one Phone call history with a recovery path.** | Call connection 4 taps then blocked; referrals 4 taps then blocked → Me → Phone calls in 2 taps, with “I don’t have a code.” | [R3 call code](cognitive-shots/R3-call-code-expiry.png), [R3 error](cognitive-shots/R3-past-referrals-validation-error.png) |
| 5 | **Show owner, next action, and expected time on every request.** | “Received · step 1 of 4” with no commitment → “Waiting for ComForce; a worker will call by …” on list and detail. | [R3 follow-up](cognitive-shots/R3-promised-followup-lacks-details.png) |
| 6 | **Make Today a single ordered worklist headed “Do this next.”** | 25 actions/FK 18.5 and several competing sections → ≤10 initial actions, grade ≤9, one next item. | [S1 Today](cognitive-shots/S1-today-first-shift.png), [screen](cognitive-shots/SCREEN-staff-today.png) |
| 7 | **Split Record into “New case” and “Debrief,” then autosave both.** | New case required 6 taps and 3 wrong turns; interrupted drafts vanished → 1 tab + 1 choice, and return resumes the draft. | [S2 Record](cognitive-shots/S2-03-record-menu.png), [S2 empty resume](cognitive-shots/S2-14-debrief-resume.png) |
| 8 | **Add “Recently worked” to Queue and make Queue/Back to Queue always go to the root.** | Recent case: 8 taps then give-up; Queue back landed on another case → 2 taps, stable destination. | [S2 search](cognitive-shots/S2-21-search-recent-work.png), [S1 misroute](cognitive-shots/S1-queue-navigation-failed.png) |
| 9 | **Turn Case Update into a short status sheet with “More details.”** | 44 controls at once/FK 20.4 → status, assignee, priority and Save (≤10 controls); details progressive. | [Case Update](cognitive-shots/SCREEN-admin-case-update-sheet.png) |
| 10 | **Put the posted list first and open “Post opportunity” as a separate sheet/route.** | 31 controls/21 decisions before posting → list first; posting form ≤8 required/initial choices. | [S3 form](cognitive-shots/S3-opportunity-form.png), [screen](cognitive-shots/SCREEN-admin-manage-opportunities.png) |

## 3. Goal results

Expert minima are measured from the relevant role landing/root and exclude sign-in and typing. “—” means the task cannot complete in the current UI; the number is the shortest route to the conclusive blocker.

| Persona / goal | Outcome | Taps vs expert minimum | Wrong turns | Main hesitation | Evidence |
|---|---|---:|---:|---|---|
| R1 get human help without account | Finished | 5/5 | 0 | Contact method plus voicemail safety | [receipt](cognitive-shots/R1-goal1-result.png) |
| R1 see whether anyone answered | Finished | 1/1 | 0 | None | [detail](cognitive-shots/R1-goal2-request-detail.png) |
| R1 leave quickly | Finished | 1/1 | 0 | None | [decoy](cognitive-shots/R1-goal3-quick-exit.png) |
| R1 find emergency guidance | Finished | 0/0, plus browser Back | 0 | Privacy-preserving Back returned to welcome | [911](cognitive-shots/R1-goal4-back-from-exit.png) |
| R1 low-vision leave quickly | **Gave up visually**; hidden ARIA control worked | 1/1 functional | 0 | No visible Quick exit | [hidden control](cognitive-shots/R1-lowvision-goal2-request-detail.png) |
| R2 close shelter tonight | Gave up | 3/1 to list | 0 | Only sample entries; no distance/availability | [shelter](cognitive-shots/R2-shelter-list.png) |
| R2 food today | Gave up | 1/1 to list | 0 | 139 results; no today/distance ordering | [food](cognitive-shots/R2-food-overload.png) |
| R2 local safety | Finished partially | 1/1 | 0 | District feed not relatable to current location | [safety](cognitive-shots/R2-safety-no-local-context.png) |
| R2 job/program | Gave up | 2/1 | 0 | Empty list and no public fallback | [empty jobs](cognitive-shots/R2-jobs-empty.png) |
| R2 turn off notifications | Finished | 3/2 | 1 | Me looked selected on Jobs, so first tap did nothing | [stale tab](cognitive-shots/R2-me-tab-stale-content.png), [off](cognitive-shots/R2-notifications-off.png) |
| R3 connect earlier call | Gave up/blocked | 4/1 to feature | 1 | Missing expired 15-minute code; no recovery | [code](cognitive-shots/R3-call-code-expiry.png) |
| R3 find promised follow-up | Gave up | 2/2 to status | 0 | No owner/action/time behind “step 1 of 4” | [status](cognitive-shots/R3-promised-followup-lacks-details.png) |
| R3 find referred places | Gave up | 4/2 to direct path | 1 | UUID error, then huge generic directory | [error](cognitive-shots/R3-past-referrals-validation-error.png), [fallback](cognitive-shots/R3-nearby-not-call-specific.png) |
| S1 decide first work | Partial | 0/0 | 0 | Urgent, on-call, debriefs and assigned work all compete | [Today](cognitive-shots/S1-today-first-shift.png) |
| S1 find assigned cases | Finished | 0/0 | 0 | None; visible on Today | [Today](cognitive-shots/S1-today-first-shift.png) |
| S1 reply to resident | Finished with wrong turn | 7/4 | 1 | “Message” did not reveal whether a recipient existed | [no recipient](cognitive-shots/S1-message-no-recipient.png), [sent](cognitive-shots/S1-resident-reply-sent.png) |
| S1 record completed visit | Finished | 5/4 | 0 | Review required many classifications | [review](cognitive-shots/S1-debrief-review-load.png) |
| S1 start new street case | Partial | 6/2 | 3 | Record meant Debrief; Queue root was hard to regain | [form](cognitive-shots/S1-new-case-form.png) |
| S1 hand case to teammate | Finished | 4/4 | 0 | None after finding Update | [saved](cognitive-shots/S1-handoff-saved.png) |
| S2 new case, interrupt, resume | Gave up at guardrail | 8/5 | 1 | No autosave/resume; alert replaced the work | [draft](cognitive-shots/S2-05-new-case-form.png), [alert](cognitive-shots/S2-09-alert-opened.png) |
| S2 debrief, interrupt, resume | Finished with re-entry | 8/6 | 0 | Entire draft vanished; callback phone later disappeared | [before](cognitive-shots/S2-11-debrief-draft-before-interruption.png), [empty](cognitive-shots/S2-14-debrief-resume.png), [case](cognitive-shots/S2-17-debrief-created.png) |
| S2 find case worked 10 min ago | Gave up at guardrail | 8/2 target | 2 | Only “Opened,” no last-worked activity | [give-up](cognitive-shots/S2-22-recent-work-giveup.png) |
| S2 find on-call person | Finished | 2/2 | 0 | Minor midnight-boundary ambiguity | [schedule](cognitive-shots/S2-23-on-call-schedule.png) |
| S3 make someone worker | Finished | 3/3 | 0 | Low; restored afterward | [role](cognitive-shots/S3-role-change.png) |
| S3 change weekend on-call | Finished | 6/5 | 0 | Sunday view contained Saturday-starting shift | [shift](cognitive-shots/S3-oncall-change.png) |
| S3 find need patterns | Finished | 3/3 | 0 | Three analytical axes | [patterns](cognitive-shots/S3-need-patterns.png) |
| S3 post job | Finished with wrong turn | 4/3 plus 3 fields | 1 | Selected Me tab inert; “Insights” returned to Me | [navigation](cognitive-shots/S3-nested-me-tab-inert.png), [posted](cognitive-shots/S3-opportunity-posted.png) |

### Think-aloud for failures and wrong turns

- **R1 low vision:** “I am looking for the red exit control I just used. The header now has Back and a cut-off title; I cannot see a way to leave.” The control remained in the accessibility tree, but visual discovery failed. [Evidence](cognitive-shots/R1-lowvision-goal2-request-detail.png)
- **R2 resources:** “Shelter should tell me what is real, close and open tonight; ‘Sample listing’ makes it unsafe to trust. Food gives me 139 choices, so I must remember today’s day and compare schedules myself. Safety has detail but not ‘near me.’ Jobs promises opportunities and gives me none.” [Evidence](cognitive-shots/R2-shelter-list.png), [food](cognitive-shots/R2-food-overload.png), [safety](cognitive-shots/R2-safety-no-local-context.png), [jobs](cognitive-shots/R2-jobs-empty.png)
- **R2 notifications wrong turn:** “Me already looks selected, so I expect tapping it to show Me; nothing changes.” Home then Me was required. [Evidence](cognitive-shots/R2-me-tab-stale-content.png)
- **R3 phone call:** “Requests is the plausible place for my earlier call, but the request has no call provenance. Me finally shows a code field, yet the call ended and the code lasts 15 minutes. Past referrals should remember the places, but Retry only changes the UUID; Nearby cannot tell which places were recommended.” [Evidence](cognitive-shots/R3-request-no-call-provenance.png), [code](cognitive-shots/R3-call-code-expiry.png), [error](cognitive-shots/R3-past-referrals-validation-error.png)
- **S1 first shift:** “Today shows several different definitions of first. Message looks available on a staff-created case, but only after entering do I learn there is no resident. Record sounds like a place to start work; it opens Debrief. Queue and Back to Queue do not reliably return to Queue.” [Evidence](cognitive-shots/S1-today-first-shift.png), [message](cognitive-shots/S1-message-no-recipient.png), [navigation](cognitive-shots/S1-queue-navigation-failed.png)
- **S2 interruption:** “I expect Record to offer case or debrief. I leave the draft to read an alert and expect either autosave or a warning. Returning gives me an empty field, so I must remember location, need, timing, risk and phone. Later, Queue promises Queue but opens another case; search cannot search by time.” [Evidence](cognitive-shots/S2-03-record-menu.png), [lost draft](cognitive-shots/S2-14-debrief-resume.png), [misroute](cognitive-shots/S2-19-recent-queue-list.png)
- **S3 nested wrong turn:** “Me is selected, so it should return to Me. It does nothing. The only escape says Insights, but it takes me to Me.” [Evidence](cognitive-shots/S3-nested-me-tab-inert.png)

## 4. Screen scorecards

AF = actions visible above the fold. FK targets are resident ≤6 and staff ≤9. Every row cites the captured screen used for scoring.

| Screen | Purpose | Primary action / competition | Choices AF/total; words first; FK | Jargon / hierarchy / status | Evidence |
|---|---|---|---|---|---|
| Resident Home | Start help and discover support | **Get help now**; 911/request are strong seconds | 14/14; 2; 4.8 | Clear Received status; 9 content actions + 5 tabs | [shot](cognitive-shots/SCREEN-resident-home.png) |
| Get help | Collect minimum request info | **Send request** | 10/10; 0; 1.6 | Clear, but submit can fall behind keyboard | [shot](cognitive-shots/SCREEN-resident-get-help.png) |
| Requests—open | Review active requests | Card and Ask for help compete | 10/10; 1; 9.7 | Status/recency strong; grade too high | [shot](cognitive-shots/SCREEN-resident-requests.png) |
| Requests—closed | Review completed requests | **Ask for help** | 9/9; 1; 2.5 | Good empty state and counts | [shot](cognitive-shots/SCREEN-resident-requests-closed.png) |
| Request detail | State, timeline, messages | **Message ComForce** | 4/4; 0; 3.0 | Excellent state/step/time; low competition | [shot](cognitive-shots/SCREEN-resident-request-detail.png) |
| Nearby | Find support places | Search, 9 filters, Safety, 180+ cards | 23/198; 1; 38.9 | `dispatch`, `de-escalation`; no result/freshness status | [shot](cognitive-shots/SCREEN-resident-nearby.png) |
| Support detail | Contact one resource | Call/Directions/ride compete | 5/5; 0; 5.9 | No current availability/open status | [shot](cognitive-shots/SCREEN-resident-support-detail.png) |
| Safety map | Review public safety | Filters/windows/report/911/211 compete | 20/34; 0; 10.6 | `dispatch`, `referral`, `case`; freshness visible | [shot](cognitive-shots/SCREEN-resident-safety-map.png) |
| Safety via Me | Same destination | Same competition | 20/34; 0; 10.6 | Duplicate entry/back context | [shot](cognitive-shots/SCREEN-resident-me-safety-map.png) |
| Safety alerts | Read neighborhood alerts | Follow-ups, sort, cards compete | 9/9; 0; 12.3 | `dispatch`; caveat useful, cards repetitive | [shot](cognitive-shots/SCREEN-resident-safety-alerts.png) |
| Past referrals error | Intended referral history | **Retry** | 3/3; 0; 16.6 | `referral`; raw UUID dead end | [shot](cognitive-shots/SCREEN-resident-past-referrals.png) |
| Volunteer/jobs | Browse opportunities | Search, 5 filters, cards | 12/12; 4; 13.5 | Three feature names; open state absent | [shot](cognitive-shots/SCREEN-resident-volunteer-jobs.png) |
| Resident Me | Settings, call link, tools | 16 similar-weight actions | 12/16; 1; 7.2 | `referrals`; unrelated jobs mixed; toggle status visible | [shot](cognitive-shots/SCREEN-resident-me.png) |
| About attempted | Intended service info | No verified action; stayed on Me | 14/16; 40; 7.2 | Apparent destination did not transition | [shot](cognitive-shots/SCREEN-resident-about-comforce.png) |
| Call code attempted | Intended call-link sheet | No verified action; Connect disabled | 12/16; 1; 7.2 | Purpose explained far below control | [shot](cognitive-shots/SCREEN-resident-call-code-sheet.png) |
| Staff Today | Prioritize shift work | Urgent/metrics/debriefs/cases compete | 19/25; 5; 18.5 | `case`, `triaged`; much below fold | [shot](cognitive-shots/SCREEN-staff-today.png) |
| Staff Queue | Find/filter cases | Toolbar, 6 filters, 15 cards | 21/29; 0; 35.9 | `case`, `triaged`; status strong, density extreme | [shot](cognitive-shots/SCREEN-staff-queue.png) |
| Debrief | Capture visit | **Process debrief** | 3/3; 1; 3.4 | Low load; no draft status | [shot](cognitive-shots/SCREEN-staff-record.png) |
| Debrief review | Verify generated case | **Create case**, 30 editable choices | 26/30; 0; 12.9 | `case`; primary below fold | [shot](cognitive-shots/SCREEN-staff-debrief-review.png) |
| Staff Map | Geographic cases/calls | Cases/911 mode choice | 7/7; 7; 4.1 | `cases`; missing-location status useful | [shot](cognitive-shots/SCREEN-staff-map.png) |
| Staff Me | Shift/settings/manage | 17 similar-weight actions | 14/17; 7; 13.4 | `cases`, `referrals`; long mixed dashboard | [shot](cognitive-shots/SCREEN-staff-me.png) |
| Admin Today | Prioritize admin shift | Same broad competition | 19/22; 5; 14.7 | “On call” then “You’re off call” needs parsing | [shot](cognitive-shots/SCREEN-admin-today.png) |
| Admin Queue | Find/manage all cases | Filters and cards | 21/29; 0; 35.9 | Status strong, list extremely dense | [shot](cognitive-shots/SCREEN-admin-queue.png) |
| New case | Create directly | **Save**; Suggest secondary | 24/24; 0; 15.0 | `case`; required state unclear, categories front-loaded | [shot](cognitive-shots/SCREEN-admin-queue-tool-3.png) |
| Admin Record | Capture debrief | **Process debrief** | 3/3; 1; 3.4 | Clean, low-load | [shot](cognitive-shots/SCREEN-admin-record.png) |
| Admin Map | Geographic overview | Cases/911 choice | 7/7; 7; 4.1 | Status visible; map web-unsupported | [shot](cognitive-shots/SCREEN-admin-map.png) |
| Admin Me | Settings/manage/switch | 17 similar-weight actions | 14/17; 7; 13.3 | `cases`, `referrals`; lower tools below fold | [shot](cognitive-shots/SCREEN-admin-me.png) |
| Notifications | Review alerts | Mark read/cards compete | 13/13; 0; 5.3 | Clear chronology; repeated urgent cards | [shot](cognitive-shots/SCREEN-admin-notifications.png) |
| Urgent response | Decide response | Call 911 / Accept (appropriate) | 8/8; 2; 3.6 | `de-escalation`; status strong, request repeats | [shot](cognitive-shots/SCREEN-admin-urgent-response.png) |
| Case detail—Tasks | Manage case | Update/Message/Resolve compete | 19/21; 0; 13.3 | `case`, `referrals`; excellent owner/state | [shot](cognitive-shots/SCREEN-admin-case-detail.png) |
| Case Update sheet | Edit routine state | **Save changes** | 42/44; 0; 20.4 | Background and 44 controls overload sheet | [shot](cognitive-shots/SCREEN-admin-case-update-sheet.png) |
| Case Message | Message/note | **Send message**; mode choice | 3/3; 0; 5.8 | `case`; history dominates composer purpose | [shot](cognitive-shots/SCREEN-admin-case-message-sheet.png) |
| Case History | Read changes | No action | 15/15; 0; 8.4 | Repeated case chrome consumes space | [shot](cognitive-shots/SCREEN-admin-case-history.png) |
| Case Referrals | Review/add referral | **Add referral** | 17/18; 0; 8.2 | `referral`, `case`; consent guidance strong | [shot](cognitive-shots/SCREEN-admin-case-referrals.png) |
| Case Files | Review/attach files | **Add file** | 16/16; 0; 10.5 | Empty content under full repeated chrome | [shot](cognitive-shots/SCREEN-admin-case-files.png) |
| Case Guide | Read service guidance | Resource links compete | 16/20; 0; 7.6 | Most useful guidance below fold | [shot](cognitive-shots/SCREEN-admin-case-guide.png) |
| Team & roles | Manage access | 3 roles repeated/person | 15/18; 0; 14.8 | Current selected role not textually clear | [shot](cognitive-shots/SCREEN-admin-team-roles.png) |
| On-call schedule | See/edit coverage | **Edit** | 14/14; 0; 3.6 | Clear person/time/current state | [shot](cognitive-shots/SCREEN-admin-on-call-schedule.png) |
| Insights | Analyze patterns/outcomes | Filters, links, metrics compete | 30/38; 0; 15.0 | `cases`, `dispatch`; long caveats/below-fold content | [shot](cognitive-shots/SCREEN-admin-insights.png) |
| AI phone calls error | Intended call outcomes | **Retry** | 7/7; 0; 10.1 | Raw UUID dead end | [shot](cognitive-shots/SCREEN-admin-ai-phone-calls.png) |
| Partners error | Intended partner management | **Retry** | 7/7; 0; 11.7 | Raw UUID dead end | [shot](cognitive-shots/SCREEN-admin-partners.png) |
| Need vs coverage | Compare need/work | Category, color, period, tracts | 16/21; 0; 9.1 | Statistical source copy; 3 analytical axes | [shot](cognitive-shots/SCREEN-admin-need-coverage.png) |
| Opportunities manager | Post/manage listings | Form and posted list compete | 16/31; 0; 13.3 | `opportunity`; primary task ambiguous | [shot](cognitive-shots/SCREEN-admin-manage-opportunities.png) |

## 5. Navigation

### App map

`†` is a dead-end or non-transition in this run; `‡` is a duplicated destination.

```text
Signed out
├─ Create account → Auth0
├─ Sign in → Auth0
├─ Ask for help without account → Get help → Request received → Request detail
├─ Call 911
└─ Quick exit → weather decoy

Resident
├─ Home
│  ├─ Get help now → Get help → Request received → Request detail
│  ├─ Current request → Request detail ‡
│  ├─ Shelter / Food / other support → Nearby ‡ → Support detail
│  ├─ Safety → Safety map ‡ → Safety alerts
│  └─ Jobs/programs → Volunteer/jobs ‡
├─ Requests
│  ├─ Open / Closed
│  ├─ Request card → Request detail ‡
│  └─ Ask for help → Get help ‡
├─ Nearby ‡
│  ├─ Search / categories → Support detail
│  └─ Safety map ‡ → Safety alerts
└─ Me
   ├─ Notification switches
   ├─ Phone calls / call code (no transition observed) †
   ├─ Past referrals → validation error / Retry †
   ├─ Safety map ‡
   ├─ Volunteer and jobs ‡
   ├─ About ComForce (no transition observed) †
   ├─ Switch to staff (staff roles)
   └─ Sign out

Staff/Admin
├─ Today
│  ├─ Urgent card → Urgent response
│  ├─ Bell → Notifications → notification target (case/urgent)
│  ├─ Assigned/needs-attention card → Case detail ‡
│  ├─ Debrief card → Debrief review ‡
│  └─ On-call summary → On-call schedule ‡
├─ Queue
│  ├─ Filters/search → Case detail ‡
│  │  ├─ Update → Update sheet
│  │  ├─ Message → Message surface
│  │  ├─ Tasks
│  │  ├─ History
│  │  ├─ Referrals
│  │  ├─ Files
│  │  └─ Guide
│  └─ New case → New case form
├─ Record → Debrief → Processing → Debrief review → Case detail ‡
├─ Map
└─ Me
   ├─ Team & roles
   ├─ On-call schedule ‡ → Edit shift sheet
   ├─ Insights → Need vs coverage ‡
   ├─ AI phone calls → validation error / Retry †
   ├─ Partners → validation error / Retry †
   ├─ Volunteer & job opportunities → Opportunities manager
   ├─ Need vs coverage ‡
   ├─ Switch to community view
   └─ Sign out
```

### Tab expectation versus actual

| Tab | First-time expectation | Actual |
|---|---|---|
| Resident Home | Immediate help and a small overview | Correct, but current request plus many support tiles make 14 actions. |
| Resident Requests | All support history, including phone calls/follow-ups | App-origin requests and messages only; call provenance/referrals live under Me. |
| Resident Nearby | Close, open, trustworthy resources | 198 actions, mixed real/sample entries, no open-today/distance ordering. |
| Resident Me | Account and notification settings | Also phone-call linking, referrals, safety, jobs, neighborhood tools, About, switching and sign-out. |
| Staff Today | One ordered “what should I do first?” view | Urgent, on-call, metrics, debriefs, assigned cases and needs-attention compete. |
| Staff Queue | Assigned/all cases, recent work, and case creation | Dense filters/cards; New case is here, but recent activity is not. |
| Staff Record | A choice of new case, visit note, or debrief | Immediately opens Debrief. |
| Staff Map | Cases by location | Cases/911 modes; surrounding counts work, map itself web-unsupported. |
| Staff Me | Profile, shift, settings and administration | Correct but overloaded with 17 actions and several management products. |

### Reachability

At standard size, Quick exit was one tap on every observed resident surface. The exception is visual reachability on low-vision Request detail: **not discoverable visually** (although still one accessibility activation). Get help counts: Welcome 1; Get help 0; Home 1; Requests/open/closed 1 via Ask for help; Request detail 2; Nearby, Safety, Alerts, Opportunities and Me 2 (Home, Get help); Support detail and the referral error 3 when Back must restore a tab screen first. Evidence: [R1 low vision](cognitive-shots/R1-lowvision-goal2-request-detail.png), [Home](cognitive-shots/SCREEN-resident-home.png), [Requests](cognitive-shots/SCREEN-resident-requests.png), [Nearby](cognitive-shots/SCREEN-resident-nearby.png).

Today is 0 taps from Today; 1 from the five staff tab roots (Queue, Record, Map, Me) and nested screens that retain the tab bar (case detail/tabs, Team, On-call, Insights, Need/coverage, Opportunities); 2 from modal/sheet or pushed surfaces that first require close/back (Update, Message, Notifications, Urgent response, New case, Debrief review, AI calls error, Partners error). The selected Queue and Me tabs were not reliable root controls, so their nominal one-tap paths can fail. Evidence: [Queue misroute](cognitive-shots/S1-queue-navigation-failed.png), [nested Me](cognitive-shots/S3-nested-me-tab-inert.png).

### Depth over three screens

- Signed-out request follow-up: Welcome → Get help → Receipt → Request detail (4).
- Call referrals fallback: Me → error → Back → Nearby → resource detail (5, and loses call context).
- Staff reply from Today: Today → case → Message → alternate case → Message (5 in S1’s observed route).
- Debrief-to-case: Record → Processing → Review → Case detail (4).
- Urgent response with debrief: Today/Notifications → Urgent response → Case → Record → Review → Case (6; missing in-flow link worsens it).
- Admin opportunity from nested coverage: Need/coverage → mislabeled back → Me → Opportunities → form/list (5).

### Duplicates

- Get help: Home, Requests, and signed-out welcome; labels vary between **Get help**, **Get help now**, and **Ask for help**.
- Resources: Home category tiles and Nearby filters present different summaries of the same destinations.
- Safety: Home, Nearby, Me and Alerts lead to overlapping safety/feed content.
- Jobs: Home, resident Opportunities, resident Me, and admin Opportunities use three names.
- Phone follow-ups/referrals: Me Phone calls, Past referrals, Requests, and Safety alerts each expose part of the history.
- Cases: Today and Queue show overlapping cards with different time labels; case detail repeats its full header across five tabs.
- Urgent work: Today banner and Notifications duplicate the same offers.
- On-call: Today, staff Me, and On-call schedule present the same state at different detail levels.
- Need patterns: Insights and Need vs coverage overlap without a clear parent/child return model.

## 6. Copy rewrite list

These are all product-authored sentences/labels among the scorer's three hardest samples per screen that exceeded resident grade 6 or staff grade 9, plus raw-error and naming phrases that caused the same comprehension problem. Proper organization/person names and user-entered or generated record content are not product copy and are not rewritten (for example, “Emergency Family Shelter (Sample),” “Hacksgiving Admin,” and the `UXSWARM` titles).

| Current copy | Plain rewrite |
|---|---|
| “Only messages ComForce sends you appear here. Internal notes stay private.” | “You will see messages from ComForce here. Staff notes are private.” |
| “Public incident and dispatch activity…” | “Recent public safety calls near Milwaukee.” |
| “Recent, generalized public safety activity from official public feeds.” | “Recent public safety calls. Locations are approximate.” |
| “NearMKE only shows public-facing information.” | “NearMKE shows only public information.” |
| “Dispatch calls are delayed 30–90 minutes and are not confirmed crimes.” | “These calls may be 30–90 minutes old. A call does not mean a crime happened.” |
| “Reported yesterday · generalized location” | “Reported yesterday · approximate location” |
| “Report nearby activity” | “Report something nearby” |
| “Sort alerts by my location” | “Show alerts near me” |
| “Recommendations and contact details from your phone calls.” | “Places and follow-ups from your calls.” |
| “Ask the phone assistant for an app code. It works once, for 15 minutes.” | “During your call, ask for a code. Enter it here within 15 minutes.” |
| “Request validation failed · Request [UUID]” | “We could not load this page. Try again. If it still fails, contact ComForce.” |
| “Postings from ComForce MKE and public job boards.” | “Jobs and programs you can apply for.” |
| “Serious weather in Milwaukee, like extreme cold” | “Milwaukee severe-weather alerts” |
| “Quick exit opens a weather site.” | “Quick exit hides this app and opens weather.” |
| “Say what happened. We’ll turn it into a case you can check before saving.” | “Describe the visit. You can review everything before you save the case.” |
| “Only you (and admins) can see this recording while it’s processed.” | “Only you and admins can see this while we process it.” |
| “The AI’s suggestion is only a draft; nothing is saved until you create the case.” | “This is a draft. Review it, then choose Create case to save it.” |
| “Confirm shelter placement” | “Check whether the person got a shelter bed.” |
| “Contact (staff only, optional)” | “Contact details (optional; staff only)” |
| “7 open cases have no location and only show in the queue.” | “Seven open cases have no location. Find them in Queue.” |
| “Privacy-safe routing outcomes and referrals.” | “Call outcomes and places we recommended.” |
| “Everyone who has signed in appears here. Choose what each person can access.” | “Choose each person’s role and access.” |
| “Assigned to Hacksgiving Admin/Worker” | “Assigned to [name]” (keep the same structure; the name drives the calculated grade). |
| “Share only after the person agrees, and only what they agree to.” | “Ask first. Share only the details the person approved.” |
| “CDC community indicators” | “Community need estimates from the CDC” |
| “Milwaukee map boundaries” | “Milwaukee map areas” |
| “Milwaukee violent-crime trend” | “Milwaukee violence trend” |
| “High need, few cases…” | “Areas with high need and little ComForce support” |
| “53 tracts have high food insecurity … and few or no ComForce food cases in the last 90 days.” | “In the last 90 days, 53 areas had high food need and little or no ComForce help.” |
| “Need vs coverage” | “Where help is needed” |
| “Volunteer & job opportunities” / “Jobs, education and volunteering” / “Opportunities” | Use **Jobs and programs** everywhere for residents; **Manage jobs and programs** for staff. |
| “Call code” / “Call handoff code” / “app code” | Use **Phone-call code** everywhere. |
| “Referral” (resident surfaces) | Use **Place ComForce recommended**. |
| “Dispatch” (resident surfaces) | Use **public safety calls**. |
| “Triage/triaged” | Use **review/reviewed**. |
| “Service and urgency” | “Type of help and priority” |
| “High · De-escalation · Unassigned” | “High priority · Calming support · No worker assigned” |
| “Transportation · updated 3m/6m ago” | “Ride help · updated 3/6 minutes ago” |
| “For regular trips, check reduced-fare bus eligibility (WisGo card: seniors, kids, people with disabilities, Medicare).” | “For regular trips, check whether the rider can get a reduced-fare WisGo card.” |
| “For riders with disabilities, Transit Plus paratransit must be booked a day ahead.” | “Transit Plus serves riders with disabilities. Book at least one day ahead.” |
| “Paratransit vans for riders with disabilities; book 24 hours ahead.” | “Accessible vans are available. Book 24 hours ahead.” |
| “Services: FoodShare Resource Center — no appointment needed, walk-ins welcome.” | “FoodShare help is available without an appointment.” |
| “Get help with FoodShare benefits in your preferred language.” | “Get FoodShare help in your language.” |

## 7. Plan mapping

| Finding | Known/new and placement | Evidence |
|---|---|---|
| Crisis route visually below account actions | **Known:** `ux-fix-plan.md` 1.14; keep Get help above the fold and make it primary. | [R1](cognitive-shots/R1-start.png) |
| Quick exit disappears at 320 px/150% | **New extension:** plan 1.15/4.2 covers pinned headers but must reserve width and test large text. | [R1 low vision](cognitive-shots/R1-lowvision-goal2-request-detail.png) |
| Development callback/Auth0 branding harms trust | **Known:** `journey-findings.md` “Auth0 consent uses hackathon and development branding”; its Wave 1 addition. | [R2 sign-in](cognitive-shots/R2-sign-in.png) |
| Nearby/Safety choice overload and missing close/open-now ordering | **New:** add progressive list, proximity/open filters and result count to Wave 3 selection model. | [R2 food](cognitive-shots/R2-food-overload.png) |
| Sample shelter listings are not trustworthy | **Known:** plan 1.6 sample-resource gate. | [R2 shelter](cognitive-shots/R2-shelter-list.png) |
| Jobs empty with no fallback | **New:** Wave 2A empty-state requirement plus a public-board recovery action. | [R2 jobs](cognitive-shots/R2-jobs-empty.png) |
| Selected tab can be inert / fail to return to root | **Known:** `journey-findings.md` “Selected Queue tab does not return to Queue root”; generalize its plan 2C rule to all tabs. | [R2 Me](cognitive-shots/R2-me-tab-stale-content.png), [S3 Me](cognitive-shots/S3-nested-me-tab-inert.png) |
| Past referrals routes to validation error | **Known:** plan 1.16 and journey J5 “Past referrals opens an invalid detail route.” | [R3](cognitive-shots/R3-past-referrals-validation-error.png) |
| Raw UUID/request errors on referrals, calls and partners | **Known:** plan 2E `userMessage`; journey “Raw backend and development errors still reach people.” | [referrals](cognitive-shots/SCREEN-resident-past-referrals.png), [calls](cognitive-shots/SCREEN-admin-ai-phone-calls.png), [partners](cognitive-shots/SCREEN-admin-partners.png) |
| Completed phone call cannot be linked without an expired code | **New:** add J5 recovery (“I don’t have a code,” request another call, or staff lookup). | [R3 code](cognitive-shots/R3-call-code-expiry.png) |
| Request status lacks owner/next action/ETA | **New:** Wave 4 status-card/content step and J1/J2 regression. | [R3 status](cognitive-shots/R3-promised-followup-lacks-details.png) |
| Phone follow-ups/referrals fragmented across destinations | **Known:** Wave 4 canonical-history ride-along and J5. | [R3 fallback](cognitive-shots/R3-nearby-not-call-specific.png) |
| Today has no single next action | **New:** Wave 4 Today information-architecture step. | [S1 Today](cognitive-shots/S1-today-first-shift.png) |
| Message hides absence of resident recipient | **New:** J7; label action **Internal note** before navigation when no recipient exists. | [S1 message](cognitive-shots/S1-message-no-recipient.png) |
| Record/Debrief/New case are conceptually split | **New:** Wave 4 tab/action IA step; make Record a chooser or rename it Debrief. | [S2 Record](cognitive-shots/S2-03-record-menu.png) |
| Drafts vanish during interruption | **Known:** plan 2B; journey J8 “New case and typed-debrief drafts discard without warning.” Extend from warnings to autosave/resume. | [S2](cognitive-shots/S2-14-debrief-resume.png) |
| Generated callback task drops the phone | **New:** Wave 2D case-creation correctness and a debrief regression test. | [S2 case](cognitive-shots/S2-17-debrief-created.png) |
| No way to find recently worked cases | **New:** Wave 5/J7 “Recently worked” Queue filter and last-activity labels. | [S2](cognitive-shots/S2-22-recent-work-giveup.png) |
| Back to Queue returns to another case | **Known root cause:** plan 2C BackLink semantics and journey Queue-root finding. | [S1](cognitive-shots/S1-queue-navigation-failed.png) |
| New case, Case Update, review and Insights front-load too many choices | **New:** Wave 4 progressive forms/analytics step; targets in Section 2. | [new case](cognitive-shots/S1-new-case-form.png), [update](cognitive-shots/SCREEN-admin-case-update-sheet.png), [Insights](cognitive-shots/SCREEN-admin-insights.png) |
| Debrief review fields lack usable accessible names | **Known:** plan 4.5 and journey “Visible staff-form labels are not programmatic names.” | [S1 review](cognitive-shots/S1-debrief-review-load.png) |
| Opportunity creation blocks management | **Known:** Wave 4 ride-along “Staff Opportunities: Posted list comes first.” | [manager](cognitive-shots/SCREEN-admin-manage-opportunities.png) |
| Resident jargon and inconsistent names | **Known:** plan 1.13 copy pass, plan 2E labels, and Wave 4 canonical history. | [Me](cognitive-shots/SCREEN-resident-me.png), [jobs](cognitive-shots/SCREEN-resident-volunteer-jobs.png) |

### UXSWARM records and changes

- Created request **#1025**, access code `EV6V-6C9G`: `UXSWARM R1 I am in crisis and need a person to help me tonight.`
- Created request **#1026**, access code `VDAE-TSNK`: `UXSWARM R1 LOWVISION I am in crisis and need a person to help me tonight.`
- Sent one resident message on #1026: `UXSWARM S1 Hi, I’m with ComForce. Are you safe right now, and where would you like us to meet you?`
- Created case **#1027** from `UXSWARM S2 interrupted debrief: met a resident near 6th and National who needs a ride to overnight shelter tonight; no immediate medical danger; call back at 414-555-0199.` It remains assigned to Hacksgiving Worker, In progress, High, Transportation.
- Created case **#1028** from `UXSWARM S1 Completed a street visit near Milwaukee City Hall. Met one adult who needs a bus pass and a warm meal tomorrow. They are safe tonight; no urgent danger. Follow up by noon tomorrow.` It was reassigned, with its displayed tasks, to Hacksgiving Admin; status/priority/service stayed In progress/Low/Transportation.
- Created and left open one opportunity: title `UXSWARM S3 Resident job opportunity`, organization `UXSWARM Community Test Employer`, description `UXSWARM Temporary test posting for resident job discovery.`
- Changed the member’s **Replies and updates** notification setting to off and left it off.
- Temporarily changed Hacksgiving Resident Community member → Worker → Community member; restored.
- Temporarily changed the active primary on-call shift Hacksgiving Worker → Hacksgiving Admin → Hacksgiving Worker; restored.
- No records were deleted. All browser contexts were closed; the dev stack was left running.
