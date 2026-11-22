# Prompt: cognitive-load and discoverability review (web build, parallel subagents)

You're checking whether the ComForce MKE app is **easy to understand**, not
whether it works. Earlier reviews covered whether it works (defects,
navigation, error states); don't repeat them. Here you measure how much
thinking each task takes, whether people can find things without being told
where to look, and what to cut or simplify. **Test and report only: don't
change app code, migrations, env files or Auth0, and don't commit.**

## Who uses this app

- **Residents** may be in crisis: stressed, using one hand, on a cracked or
  small phone, with limited literacy, English as a second language, or low
  trust in institutions. They may be hiding their phone use from someone. A
  resident should never have to think about how the app works.
- **Staff** (outreach workers) use it on the sidewalk, in a car, or right
  after a hard visit. They're interrupted all the time. They need to know
  what to do next at a glance, and to pick up a half-finished task.

## Read first (setup only)

- `docs/review/codex-web-journey-prompt.md`: environment, sign-in, viewport,
  Playwright setup, web-unsupported items and shared-data rules. **Follow its
  Environment, Sign-in and shared-data rules exactly.** In short:
  - use exactly `http://localhost:8081`
  - phone viewport 390×844
  - Playwright scripts and installs go in a scratch directory outside the
    repo
  - text you create starts with `UXSWARM`
  - never stop the API, the worker or Metro
- `docs/test-accounts.md`: the accounts.

**Don't read the app source, the audit, the plan or earlier findings before
testing.** First-time testers must not know where things are. The
coordinator reads `docs/review/ux-fix-plan.md` and
`docs/review/journey-findings.md` only at the end, to tag findings as known
or new.

## Method

### Part 1: goal-only tests (one subagent per persona, in parallel)

Each tester is a first-time user. It gets a persona and a list of **goals,
not steps**. It may look only at what's on the screen: screenshots plus the
accessibility tree from Playwright (`page.accessibility.snapshot()` or
`locator.ariaSnapshot()`). No DOM digging for hidden routes, and no typing
URLs except the app's start URL.

For each goal, the tester thinks aloud: what it's looking for, what it
expects a control to do, and what surprised it. It records:

- **Outcome:** finished / finished with wrong turns / gave up. Give up after
  8 taps or 3 backtracks without progress.
- **Taps and screens** to finish, against the minimum possible (from the
  coordinator's later expert path)
- **Wrong turns:** each one, with what the tester expected to find there
- **Hesitation points:** screens where it couldn't tell what to do next, and
  why
- **Typed fields and decisions** needed
- **Memory load:** anything it had to remember from one screen to the next,
  such as a number, a name or an earlier choice

| Tester | Persona | Account | Goals |
|---|---|---|---|
| R1 | Resident in crisis, first time, signed out. Reads slowly, wants the fastest route to a human. | none | 1. Get someone to help you tonight without making an account. 2. Find out if anyone has answered you. 3. Get out of the app quickly because someone is coming. 4. Find out what to do if it's an emergency. |
| R2 | Resident, has an account, looking for resources. Not in crisis, but skeptical. | `member` | 1. Find a place to sleep tonight that's close to you. 2. Find food today. 3. Check whether it's safe around where you are. 4. Find a job or program you could apply to. 5. Turn off notifications you don't want. |
| R3 | Resident who called ComForce's phone line earlier and was told to "use the app". | `member` | 1. Connect the phone call you made to your account. 2. Find what they said they'd follow up on. 3. Find places they referred you to. |
| S1 | Outreach worker, first shift, never trained on the app. | `worker` | 1. Figure out what you should do first today. 2. Find cases assigned to you. 3. Reply to a resident who wrote in. 4. Record what happened at a visit you just finished. 5. Start a new case for someone you met on the street. 6. Hand a case to a teammate. |
| S2 | Experienced worker, interrupted constantly. | `worker` | 1. Start a new case, then get interrupted by a phone call (navigate to Today and read an alert), and come back and finish it. 2. Start a debrief, get interrupted the same way, and resume it. 3. Find the case you were working on 10 minutes ago. 4. Find out who's on call tonight. |
| S3 | Admin who manages the team. | `admin` | 1. Make someone a worker. 2. Change who's on call this weekend. 3. Find patterns in where help is needed. 4. Post a job opportunity for residents. |

Run R1 a second time at 150% root font size and 320 px width. This is the
low-vision, small-phone case.

### Part 2: per-screen scoring (one subagent, after Part 1 or alongside it)

Visit every screen reachable from both roles; the expert path is allowed
here. For each screen, record:

- **Purpose:** in one sentence, what the screen is for. If it can't be said
  in one sentence, that's a finding.
- **Primary action:** is there exactly one obvious next step? Name it. Note
  any competing equal-weight actions.
- **Choice count:** the tappable things visible at load without scrolling,
  and the total on the screen.
- **Words before the first action:** count them. Resident screens should
  have under 25.
- **Reading level:** run the screen's visible text (from `innerText`)
  through a Flesch-Kincaid grade calculation, using a small script in your
  scratch directory. Aim for grade 6 or below on resident screens and grade 9
  or below on staff screens. Quote the three hardest sentences.
- **Jargon and inconsistent names:**
  - internal terms a resident wouldn't know (case, referral, disposition,
    triage, dispatch, handoff, opportunity)
  - anything called two different names across screens (request vs case,
    Me vs Account, alerts vs notifications)
- **Hierarchy:** is the most important thing visually first? Is anything
  important below the fold that should be above it? Is there anything
  decorative or repeated that could go?
- **Status visibility:** can the user tell, without tapping, where things
  stand: open vs closed, waiting on whom, due when?

### Part 3: navigation (the coordinator, after Parts 1 and 2)

- **Tab labels:** before tapping a tab, each Part 1 tester writes down what
  it expects to find under it. Compare that with what's actually there.
- **Reachability:** from every screen, count the taps to Get help (resident),
  Quick exit (resident) and Today (staff).
- **Depth:** note any task that needs more than 3 screens deep.
- **Duplicates:** note anything findable in two or more places with
  different presentations.
- **Draw the app map** as a Markdown tree: tabs, then screens, then sheets.
  Mark dead-end leaves and duplicated destinations on it.

## Output

The coordinator writes `docs/review/cognitive-load-findings.md`:

1. **Summary:**
   - goal completion rate per persona
   - average taps against the expert minimum
   - the 5 hardest goals
   - the screens with the highest load
2. **Top 10 simplifications,** ranked by impact on residents in crisis first,
   then on interrupted staff. Each is a concrete change, such as "Merge X
   into Y", "Cut Z", "Rename A to B", "Move C above the fold", or "Make D the
   one primary action". Give a before and after: the tap count, choice count
   or reading grade.
3. **Goal results:** a table of persona × goal (outcome, taps against the
   minimum, wrong turns, hesitation points), plus the think-aloud notes for
   every failed or wrong-turn goal.
4. **Screen scorecards:** one row per screen (purpose, primary action,
   choices above the fold and in total, words before the first action,
   reading grade, jargon, hierarchy notes).
5. **Navigation:** the app map tree, the comparison of expected vs actual
   under each tab, reachability counts, and the duplicates list.
6. **Copy rewrite list:** each sentence above the reading-level target, with
   a plain rewrite. Keep the meaning, and be concrete about who, what and
   when.
7. **Plan mapping:** each finding tagged **known** (cite the
   `ux-fix-plan.md` step or `journey-findings.md` finding) or **new**, with
   the wave or step it should join, or a proposed new step.

Back every finding with a screenshot, saved to
`docs/review/cognitive-shots/<tester>-<goal-or-screen>.png`. Report what
testers saw and did, not what the code suggests.

Before you finish:

- close every browser
- leave the dev stack running
- list every `UXSWARM` record you created
