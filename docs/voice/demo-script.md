# Live call-to-app demo

## Ready-now end-to-end test

Call **+1 (414) 251-1724** from a phone, using only synthetic details. Before
calling, sign into the community side of the app and leave it open on **Me**.

Use this caller scenario nearly verbatim:

> Hi Ava. This is not an emergency and nobody is in danger. I live near the
> Near West Side, and I need help finding groceries for this week. English is
> fine, and I do not have any mobility needs. Please find a reviewed resource,
> save the referral, and connect this call to my app. I am ready for the app
> code.

The successful flow has six visible beats:

1. Ava identifies itself as an AI assistant and explains the 911 boundary.
2. Ava confirms there is no immediate danger before continuing.
3. Ava routes the need to food support and looks up a reviewed resource.
4. Ava asks before saving the referral; say **yes**.
5. Ava reads an eight-character code. In the app, go to **Me → Phone calls**,
   enter the code under **Call code**, and tap **Connect call** within 15
   minutes. Do not read a password, login code, or phone number to Ava.
6. Open **Past referrals**. The resource from the call should appear with its
   reviewed details and public contact action.

Hang up only after the referral is saved and the app says **Call connected**.
The post-call webhook then finishes the staff record. Sign in as a worker or
admin and open **Me → AI phone calls**. The newest call should show the
structured food-support route, routine urgency, disposition, and accepted
referral. Open it to demonstrate that the record contains no caller number,
recording, transcript, or exact address.

### Optional extra beat

Before requesting the app code, ask:

> Are there any current volunteer opportunities I could also look at later?

This exercises the shared opportunities catalog without changing the saved
food referral. Keep this optional if the presentation clock is tight.

### Pass/fail checklist

- **Pass:** the resource is visible under the connected resident account and
  the completed call appears in the staff review list after refresh.
- **Retry:** if the code is rejected, ask for a new one and enter it within 15
  minutes; codes are single-use and uppercase letters/numbers only.
- **Stop:** if Ava skips the emergency boundary, claims to be human, invents a
  resource, or asks for a password/login code.
- **Expected for now:** the seven-day district-awareness question and 24-hour
  dropped-call resume are held for the post-deployment demo; their production
  endpoints are not live yet.

## Two-minute presentation version

Use synthetic details and an approved teammate as the only enabled transfer
destination. The caller reports a neighborhood disagreement that is not in
progress, has no weapon or injury, and asks ComForce for preventive mediation.

The agent should identify itself as AI, state the 911 boundary, complete the
safety gate, ask only for general area and desired help, find the reviewed
route, explain the minimal summary, obtain consent, and warm-transfer to the
approved responder. The dashboard should move the synthetic referral from
requested to connected.

Presenter line: “The novelty is not that AI answered a phone. The caller
reached us without an app, the AI preserved the emergency boundary, a human
made the consequential decision, and ComForce can measure whether help was
connected—without storing the recording or a full transcript.”

Record a 30–45 second backup of this exact synthetic flow before finals. Never
switch the demo transfer to a public agency as a workaround.

## Optional standout beats

- Ask for the past seven days in MPD District 5. Ava must separate reviewed
  incidents from delayed calls and say the counts are not a safety score.
- Simulate a dropped call, call back, and confirm that Ava resumes only the
  service and general area—not the caller's words.
- Submit a synthetic callback request with "no voicemail; weekdays after 5."
  Show the structured contact plan in staff review and the linked case note.
- Open the referral in the resident app and tap **I still need help**. Show the
  connection funnel update without playing or displaying a recording or transcript.
