# Prompt: journey test of the Expo Go app on Android emulators

You're testing the ComForce MKE mobile app the way a real person would use it.
Drive the app in Expo Go on Android emulators, run every journey script, and
write down every point of friction you find. **Test and report only: don't
change app code, migrations or env files, and don't commit.**

## Read first

1. `AGENTS.md`: how to run the stack (ports, gotchas).
2. `docs/review/ux-fix-plan.md`: the plan. **Wave 5** has the journeys J1–J10,
   the shared "done when" bar, and the device setup you'll use.
3. `docs/review/ux-audit.md`: the 54 known defects from a code audit. Use it
   to tag what you find as **known** (with its plan step, e.g. `1.4`) or
   **new**. The audit was written before 12 newer commits on `main`:
   - an offline request queue
   - weather banners and outreach
   - open bed counts and live Home tiles
   - push for requests sent without an account

   So for known items, also say whether they **still reproduce**, and test
   those new features as part of J1, J3 and J4. New problems matter most: things between screens, timing,
   feedback, and anything only visible on a running device.
4. `docs/test-accounts.md`: sign-in accounts (`member`, `worker`, `admin`).

## Environment (already set up)

- Windows host, Git Bash. Tailscale IP `100.102.172.1`, which is in Auth0's
  callback list. Postgres (`hacksgiving-postgres`) and storage
  (`hacksgiving-storage`) are running in Docker. `api/.env` has the OpenAI
  key.
- Android SDK: `%LOCALAPPDATA%\Android\Sdk`. There are no cmdline-tools, but
  `emulator` and `platform-tools/adb` exist. Set
  `ANDROID_SDK_ROOT`/`ANDROID_HOME` to the SDK path before starting an
  emulator, or it fails with "Cannot find AVD system path".
- Emulators: `ux-resident`, `ux-staff`, `ux-drill`. The host has 16 cores and
  63 GB of RAM, so all three can run at once.

## Phase 0: bring-up (one coordinator, before any testers start)

1. First run `git status -sb`. If `main` is behind `origin/main`, run
   `git pull --ff-only` before anything else. Other checkouts on this machine
   share the database, so a stale checkout fails with "Can't locate revision
   identified by '00NN'". That stopped the first attempt. Then run
   `scripts/dev-setup.sh`, then start `scripts/dev.sh` in the background
   and leave it running. Check these three:
   - `curl localhost:8000/v1/health` returns healthy
   - `curl localhost:8090/` returns `ok`
   - Metro on `:8081` shows `exp://100.102.172.1:8081`
2. Boot the three emulators. Wait for `adb -s <serial> shell getprop
   sys.boot_completed` to return `1`.
3. Install Expo Go: `cd apps/mobile && npx expo start --android` installs it
   on one emulator (or press `a`). Then `adb shell pm path host.exp.exponent`,
   `adb pull` the APK, and `adb -s <serial> install` it on the other two.
   Don't start a second Metro; reuse the one `dev.sh` started.
4. Open the app on each emulator: `adb -s <serial> shell am start -a
   android.intent.action.VIEW -d exp://100.102.172.1:8081`.
   **Start every emulator clean.** Boot with `emulator -avd <name>
   -no-snapshot-load -no-snapshot-save`. Before opening the project, run
   `adb shell am force-stop com.android.chrome` and `adb shell pm clear
   host.exp.exponent`. Runs 2 and 3 resumed a saved snapshot: the old
   JavaScript was still in memory, along with a Chrome tab already showing
   "Callback URL mismatch". That's why the fixed callback didn't appear.
5. **Check the sign-in callback first.** The sign-in screen's footer must
   read `Callback URL: exp://100.102.172.1:8081/--/auth`. Expo Go 58 on
   Android reports `executionEnvironment: "bare"`, which made the app send
   `hacksgiving://auth` and stopped run 2. A fix is now in the working tree,
   uncommitted: `src/lib/redirect.ts`, wired into `src/lib/auth.tsx`. **Don't
   revert or stash it.** If the footer still shows `hacksgiving://`, reload
   the app from the Expo Go menu.
6. Sign in on each: `ux-resident` as **member**, `ux-staff` as **worker**,
   `ux-drill` as **admin**. Sign-in goes through Auth0 in the browser. If you
   see "callback URL mismatch", stop and report it; don't change the Auth0
   config.

If bring-up fails, record the exact error and what you tried in
`docs/review/journey-findings.md` and stop. A broken bring-up is itself a
finding.

## Driving the device

Use the T3 device tools (`device_list`, `device_open`, `device_screenshot`,
then the `agent-device` CLI) if this thread has them. Otherwise use adb
directly:

- **See the screen:** `adb -s <serial> exec-out screencap -p > shot.png`,
  then look at it.
- **Find elements:** `adb -s <serial> shell uiautomator dump /sdcard/ui.xml
  && adb -s <serial> pull /sdcard/ui.xml`. Use the bounds and content-desc
  attributes to tap.
- **Act:**
  - `adb shell input tap X Y`
  - `input swipe` to scroll
  - `input text 'escaped%stext'`, where `%s` is a space
  - `input keyevent KEYCODE_BACK` for the Android back gesture, which is part
    of testing flow
- **Location:** `adb -s <serial> emu geo fix -87.9065 43.0389` (Milwaukee).
  Test granted, denied and "only this time".
- Take a screenshot after **every** step. Save the ones that show a finding
  to `docs/review/journey-shots/<journey>-<step>.png`.

## Phase 1: testers in parallel (one agent per emulator)

| Agent | Emulator | Journeys |
|---|---|---|
| Resident | `ux-resident` | J1, J3, J4, J5, then the resident half of J2 |
| Staff | `ux-staff` | J6, J7, J8, then the staff half of J2 |
| Admin | `ux-drill` | J9, plus the staff role in J6's escalation if a second responder is needed |

The two-role journeys need a handoff between agents:

- **J2:** Resident submits a request (from J1) → Staff finds it and replies →
  Resident checks the reply arrives and the thread updates.
- **J6:** to raise an urgent alert without Ava, submit an urgent request from
  the resident Get help form, signed out. That already pages on-call. Make
  sure the worker account is on call first (J9 or `/staff/oncall`).

To coordinate, write handoffs to `docs/review/journey-handoff.md` ("J2:
request #123 submitted, waiting for staff reply") and read it before you
start a step that depends on another agent.

Rules for shared state (one database, one API):

- Start any text you create with `UXSWARM` so it can be cleaned up later.
- Don't change real roles except in J9. In J9, change the role of a test
  account and then change it back.
- **Never stop the API, the worker or Metro in phase 1.**
- Voice debriefs: the emulator mic has no input. Record about 10 s anyway to
  test the recording UI and the pipeline, then use the typed debrief for the
  content.
- Push notifications can't be delivered to Expo Go on Android. Record what the
  UI says about notifications; the in-app bell, the inbox and the Today banner
  are what you're actually testing.

## Phase 2: failure drill (J10, after every phase 1 agent has finished)

Admin agent only. Rerun J1, J3 and J7 under three failure conditions:

1. **API stopped:** stop only the API process, and check every screen shows a
   recoverable error rather than an empty state.
2. **No network:** `adb shell svc wifi disable` plus `svc data disable`.
3. **Slow network:** `adb emu network delay gprs` and `adb emu network speed
   gsm`.

Restore everything afterwards and confirm `/v1/health` is healthy again.

## What counts as a finding

Judge every step against the wave 5 bar: no dead ends, back goes where it
says, every save confirms, every failure says what to do next, no layout
jumps, never guessing what happens next. Also note:

- Copy that's confusing, contradictory or technical (raw errors, enum
  values, "Hacksgiving").
- Anything off on Android specifically: the back gesture, keyboard covering
  inputs, safe areas, the status bar.
- Targets that are hard to tap.
- Behavior at large font size: run one pass with `adb shell settings put
  system font_scale 1.5`, then reset it to 1.0.
- Slow steps over about 2 s with no feedback.
- Anything that looks unfinished, placeholder or demo-only.

## Output

Write `docs/review/journey-findings.md`:

1. **Run summary:** what ran, what was blocked, bring-up problems, counts by
   severity, and known vs new.
2. **Top 10 new problems**, ranked.
3. **Findings by journey.** Each finding has:
   - **Title**
   - **Severity:** blocker / high / medium / low
   - **Known or new:** for known, cite the audit finding and plan step
   - **Device and account**
   - **Steps to reproduce**
   - **Expected vs actual**
   - **Screenshot path**
   - **Suggested fix:** one line, naming the shared component or plan step
     it belongs to
4. **Plan updates:** for each new finding, which wave or step of
   `ux-fix-plan.md` it should join, or a proposed new step.
5. **Journey status table:** J1–J10 × pass / friction / fail / blocked.

Every finding must come from something seen on the device, with a
screenshot. If you didn't see it, don't report it. Don't infer findings from
the code; that's what the audit already did.

Before you finish:

- stop the emulators (`adb emu kill`)
- reset the font scale and the network
- leave the dev stack running
- list every `UXSWARM` record you created
