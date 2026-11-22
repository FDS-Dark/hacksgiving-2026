# Prompt: journey test of the web build (parallel subagents)

You're testing the ComForce MKE app the way a real person would use it, in
the Expo **web** build at a phone-sized viewport. Run the journey scripts with
parallel subagents and write down every point of friction. **Test and report
only: don't change app code, migrations, env files or Auth0, and don't
commit.**

This replaces the Android-emulator run (`codex-journey-swarm-prompt.md`),
which used too much CPU. On web, each tester is a cheap headless browser
context.

## Read first

1. `docs/review/ux-fix-plan.md`, **wave 5**: journeys J1–J10 and the shared
   "done when" bar. Judge every step against that bar.
2. `docs/review/ux-audit.md`: the 54 known defects. Tag each finding
   **known** (cite the plan step, e.g. `1.4`, and say whether it still
   reproduces) or **new**. New problems matter most. The audit predates
   recent features: the offline queue, weather banners, bed counts, push for
   signed-out requests, partners, consented sharing, texts to requesters, and
   need vs coverage. Test those too.
3. `docs/test-accounts.md`: `member`, `worker`, `admin`.

## Environment (already running; don't restart it)

- Check all three first:
  - `curl localhost:8000/v1/health` returns healthy
  - `curl localhost:8090/` returns `ok`
  - `curl localhost:8081/` returns HTML with `<title>Hacksgiving</title>`

  If any is down, run `scripts/dev.sh` once from the repo root. Never start a
  second Metro.
- **The app URL must be exactly `http://localhost:8081`.** Auth0 only accepts
  the web callback `http://localhost:8081/auth`. `127.0.0.1` or a LAN IP fails
  with "Callback URL mismatch".
- **Browser:** Playwright with Chromium. It's already installed under
  `%LOCALAPPDATA%\ms-playwright`. Put any scripts and `npm i playwright` in a
  scratch directory outside the repo. Never add dependencies to the repo.
  Headless is fine.
- **Viewport:** 390×844, `deviceScaleFactor: 3`, `isMobile: true`,
  `hasTouch: true`, locale `en-US`, timezone `America/Chicago`. Grant
  geolocation at Milwaukee (43.0389, -87.9065), except where a journey tests
  denial.
- **The first page load compiles the web bundle,** which can take 1–2
  minutes. Wait for the sign-in screen (`text=I already have an account`)
  with a long timeout before you decide anything is broken.

## Sign-in

On the sign-in screen, tap "I already have an account". Auth0 Universal Login
opens. Fill in the email and password, then tap Continue, and you return to
`http://localhost:8081/auth` and then the app. To skip the login on later
runs, save each account's session with `context.storageState()` to a file in
your scratch directory, never in the repo.

If sign-in fails, record a screenshot and the exact error, and stop that
tester only.

## What the web build can't test

Record these once as **"web-unsupported"** in the run summary, not as
findings. They're covered by a later device pass.

- **Maps:** the Nearby, Safety, Staff Map, Coverage and urgent-response maps
  use `react-native-webview`, which has no web version. Do test everything
  around them: list fallbacks, filters, the selected-place detail, and the
  error each screen shows in place of the map. A blank or crashed screen
  where the map would be **is** a finding.
- **Push notifications** and lock-screen behavior. Do test the in-app bell,
  the inbox and the Today banner.
- **Voice recording:** do test that the recorder UI asks for permission and
  degrades cleanly, then use the typed debrief.
- **`tel:`, `sms:`, Directions links and haptics:** check that the link is
  formed correctly and the control responds.
- **The Android back gesture:** use the browser's back as the stand-in, and
  report it if browser back breaks navigation.

## Testers (run in parallel, one subagent each, each with its own browser context)

| Tester | Account | Journeys |
|---|---|---|
| A, Resident | signed out, then `member` | J1, J3, J4, then the resident half of J2 |
| B, Resident follow-up | `member` | J5, plus the new resident features (offline queue, weather banner, bed counts, "Notify me" for signed-out requests) |
| C, Staff | `worker` | J6, J7, then the staff half of J2 |
| D, Staff creation | `worker` | J8 (New case with Suggest, New debrief typed, each cancelled once), plus the new staff features (partners, consented sharing, texts to requesters, need vs coverage) |
| E, Admin and failure drill | `admin` | J9, then J10 |

The two-role journeys need a handoff between testers:

- **J2:** A submits a request → C replies to it → A checks the reply arrives
  and the thread updates without a manual reload.
- **J6:** submit an urgent request from the signed-out Get help form. That
  pages whoever is on call, so first make sure `worker` is on call (E does
  this in J9, or C does it from `/staff/oncall`).

To coordinate, append lines to `docs/review/journey-handoff.md` (for example
"J2: request #123 submitted by A; waiting for C") and read it before starting
a dependent step.

**J10 needs no shared outage.** Simulate failures inside E's own browser
context, so the other testers aren't affected:

- **API down:** `context.route('**/localhost:8000/**', r => r.abort())`
- **Offline:** `context.setOffline(true)`
- **Slow network:** route with a 3–5 s delay

Rerun J1, J3 and J7 under each condition. **Never stop the API, the worker
or Metro.**

## Rules for shared data (one database)

- Start any text you create with `UXSWARM`.
- In J9, only change the roles of test accounts, and change each one back.
- Don't delete anything you didn't create.

## What counts as a finding

Judge every step against the wave 5 bar: no dead ends, back goes where it
says, every save confirms, every failure says what to do next, no layout
jumps, never guessing what happens next. Also record:

- Confusing, contradictory or technical copy: raw errors, enum values, the
  word "Hacksgiving", "live" for delayed data.
- Tap targets under 44×44 CSS px. Measure them with `boundingBox()`.
- Text cut off or overlapping at 390 px wide, and again at 320 px.
- Large-text behavior: one pass per tester with `page.addStyleTag({ content:
  'html { font-size: 150% }' })`, or browser zoom at 150%.
- Steps over about 2 s with no visible feedback.
- Console errors and failed network requests during a step. Use
  `page.on('console')` and `page.on('requestfailed')`. A red error on a step
  is evidence.
- Anything that looks unfinished, placeholder or demo-only.

Take a screenshot after every step. Save the ones that show a finding to
`docs/review/journey-shots/web-<journey>-<step>.png`.

## Output

When all testers have finished, one coordinator replaces the contents of
`docs/review/journey-findings.md` (earlier runs were blocked in setup) with:

1. **Run summary:** what ran, what was blocked, the web-unsupported list,
   counts by severity, and known vs new.
2. **Top 10 new problems**, ranked.
3. **Findings by journey.** Each finding has:
   - **Title**
   - **Severity:** blocker / high / medium / low
   - **Known or new:** for known, cite the audit finding and plan step, and
     say whether it still reproduces
   - **Tester and account**
   - **Steps to reproduce**
   - **Expected vs actual**
   - **Screenshot path**
   - **Console or network evidence**, if any
   - **Suggested fix:** one line, naming the plan step or shared component
4. **Plan updates:** for each new finding, which wave or step of
   `ux-fix-plan.md` it belongs in, or a proposed new step.
5. **Journey status table:** J1–J10 × pass / friction / fail / blocked /
   web-unsupported.

Report only what you saw in the browser, with a screenshot. Don't infer
findings from the code.

Before you finish:

- close every browser
- leave the dev stack running
- list every `UXSWARM` record you created
