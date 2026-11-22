# Codex prompt: UX and cohesion audit (subagent swarm)

Paste everything below the line into Codex from the repo root.

---

You're the lead on a read-only UX audit of the ComForce MKE app in this repo.
It's an Expo (React Native) app in `apps/mobile/` with two sides: a
**resident** side (people in the community getting help) and a **staff**
side (ComForce outreach workers and admins). The app needs to feel like one
carefully designed product. Right now parts of it feel like they were
assembled quickly during a hackathon. Your job is to find every place where
that shows.

**Use subagents heavily. This is a swarm job, not a solo read.** Spawn many
subagents in parallel (aim for 20 or more across the waves below). Give each
one a narrow scope and have it report back to you in the finding format at the
end. Don't read the whole app yourself; delegate, then verify and merge. If a
subagent's scope turns out to be large, have it split the work further.

**Don't change any code.** The output is one report file (see "Deliverable").

## Before spawning anything: shared context (you read this, then pass the relevant parts to each subagent)

- `AGENTS.md`, `apps/mobile/AGENTS.md`, `apps/mobile/README.md`
- `docs/app-flow.md`: what's built and planned, per screen
- `docs/handoff.md`: current state
- `docs/review/hackathon-features.md`: an earlier feature pass. Don't repeat
  its feature ideas; this audit is about quality, not new features.
- `apps/mobile/src/theme/` and `apps/mobile/src/components/ui.tsx`,
  `components/staff/kit.tsx`: the design tokens and shared components that
  screens should be using.

The design direction is settled. Judge against it:

- **Visual style "C · Light":** light surfaces, restrained color. No large
  saturated green blocks.
- **Native tab bars per role:** residents and staff each have their own tab
  bar (`src/app/(main)/_layout.tsx`, `src/app/staff/_layout.tsx`).
- The users include people in crisis, on cheap phones, outdoors, sometimes
  with poor literacy. Clarity beats cleverness.

## Wave 1: one subagent per screen group (spawn all at once)

Each reads its screens and every component they import, then reports on its
area. Suggested split (adjust if you find routes not listed):

1. Sign-in and auth: `src/app/sign-in.tsx`, `src/app/auth.tsx`, `src/app/_layout.tsx`
2. Resident Home: `src/app/(main)/index.tsx`, `(main)/_layout.tsx`
3. Resident Nearby and place detail: `(main)/nearby.tsx`, `src/app/place/[id].tsx`
4. Resident Opportunities: `(main)/opportunities.tsx`, `components/OpportunityCard.tsx`
5. Resident Safety and Alerts: `(main)/safety.tsx`, `(main)/alerts.tsx`, `components/SafetyMap.tsx`
6. Resident requests and Me: `(main)/requests.tsx`, `(main)/me.tsx`, `components/RequestList.tsx`
7. Get help flow: everything under `src/app/help/`
8. Referrals: `src/app/referrals/`
9. Staff Today and notifications: `src/app/staff/index.tsx`, `staff/notifications.tsx`, `components/staff/NotificationBell.tsx`, `OncallCard.tsx`, `Urgent.tsx`
10. Staff cases: `src/app/staff/cases/` (list, detail, messages, new) and `components/staff/case/`, `CaseLine.tsx`
11. Staff records and voice debriefs: `src/app/staff/records/`, `components/staff/VoiceRecorder.tsx`, `Debriefs.tsx`
12. Staff calls and alerts: `src/app/staff/calls/`, `src/app/staff/alerts/[id].tsx`, `components/CallSummary.tsx`
13. Staff map: `src/app/staff/map.tsx`, `components/PinMap.tsx`, `components/SafetyMap.tsx`
14. Staff on-call, team, insights, opportunities, Me: `staff/oncall.tsx`, `team.tsx`, `insights.tsx`, `opportunities.tsx`, `me.tsx`

For each screen, every subagent answers:

- **Flow:** Is it obvious what this screen is for and what to do next? Does
  it hand off cleanly to the screens before and after it? Are there dead
  ends, double back buttons, or ways in with no way out?
- **Cohesion:** Does it look like it belongs with the rest of the app? Or is
  it a stack of unrelated cards, mismatched spacing, one-off colors, font
  sizes or button styles that don't match the shared components?
- **Hacked-together signals:** hard-coded values instead of theme tokens,
  inline styles copied between screens, placeholder or debug text, raw error
  messages or JSON shown to users, inconsistent capitalization, layout that
  only works at one phone size, missing safe-area handling, things that jump
  around while loading.
- **States:** loading, empty, error, offline, signed-out, no-permission (location,
  notifications, microphone). Each should be designed, not an afterthought.
- **"Vibe-coded" tells:** one-sentence marketing tag lines under headings,
  filler subtitles that restate the title, emoji used as decoration,
  exclamation-mark cheerfulness, generic AI phrasing ("Seamlessly...",
  "Empower...", "Your journey..."), and explanations of the obvious. Quote
  the exact string and give its file:line.
- **Unnecessary:** sections, toggles, badges, stats or whole screens a real
  resident or worker wouldn't miss. Say what to cut and why.

## Wave 2: cross-cutting lenses (spawn alongside or right after wave 1)

One subagent per lens, each across the whole of `apps/mobile/src`:

1. **Copy and tone.** Every user-facing string. Flag vibe-coded copy (above),
   inconsistent terms for the same thing (case vs request vs referral;
   member vs resident), jargon a resident wouldn't know, and wording that
   differs between the two sides for the same concept.
2. **Design system drift.** Grep for hex colors, raw font sizes, margins and
   paddings that bypass `src/theme`. Find near-duplicate components (two
   kinds of card, header, button, chip or list row doing the same job) and
   say which one should stay.
3. **Navigation map.** Build the full route graph from `src/app` and every
   `router.push`/`Link`. Find orphaned screens, unreachable routes, circular
   or confusing paths, inconsistent back behavior, and screens that appear
   in both roles' navigation with different look or behavior.
4. **Resident/staff cohesion.** Do the two sides feel like one product with
   two modes, or two apps? Compare headers, tab bars, lists, detail
   screens and empty states side by side.
5. **Maps.** Every map in the app (`PinMap`, `SafetyMap` and the screens that
   use them). Include the known issues below, and check pin density, legends,
   colors, tap targets, how a pin opens its detail, and behavior with no
   location permission.
6. **Accessibility and real-world use.** Tap target sizes, contrast on the
   light theme, Dynamic Type or font scaling, screen-reader labels on
   icon-only buttons, one-handed reach, and use in bright sunlight.
7. **Loading, empty and error states.** Inventory every `isLoading`,
   `isError`, empty-list and `RefreshError` path. Find the inconsistent ones
   and the missing ones.
8. **Dead weight.** Features, settings, screens, components and services
   that are unused, half-built, demo-only or unnecessary for launch.
   Cross-check `docs/app-flow.md` for what's meant to exist.

## Wave 3: verify and merge (you, plus a few verifier subagents)

- Deduplicate: many wave 1 and wave 2 findings will overlap. Merge them into
  one finding with every file:line.
- Spawn verifier subagents on the high-severity findings. Each re-reads the
  cited code and confirms or rejects the finding with evidence. Drop
  anything that doesn't hold up. Keep only claims you can tie to code.
- Group the result by theme, not by subagent.

## Known issues (already confirmed by the team; include them, with file:line and a concrete fix)

1. **Maps must be full screen.** Every map is currently embedded in a page.
   Each map needs a full-screen view (edge to edge, behind the status bar,
   with a clear close or back control and its filters overlaid).
2. **Maps must show the user's location.** Show the current position (blue
   dot style, with a recenter button), using the existing
   `src/lib/location.ts` and `src/services/deviceLocation.ts`. Cover the
   denied-permission case.
3. **The opportunity map can't label every pin.** It shows hundreds of
   points, and `PinMap` currently binds a permanent text label to each one
   (the `bindTooltip(..., {permanent: true})` call in
   `src/components/PinMap.tsx`). That map should use color coding only, with
   a legend, and show the name on tap. Also check whether clustering is
   needed at that density.

The maps are Leaflet running inside a WebView (`PinMap.tsx`,
`SafetyMap.tsx`). Fixes should stay within that approach unless you can show
it can't support what's needed.

## Finding format (every subagent reports in this shape)

```
### <short title>
- Severity: high | medium | low
- Kind: flow | cohesion | hacked-together | vibe copy | unnecessary | state | accessibility | map
- Where: apps/mobile/src/...:<line> (every location)
- What's wrong: <what a user sees or experiences, in one or two sentences>
- Evidence: <quoted code or string>
- Fix: <the concrete change, and which shared component or token to use>
```

Severity: **high** means a user gets lost, stuck, misled, or the screen looks
broken; **medium** means it visibly looks unpolished or inconsistent;
**low** is polish.

## Deliverable

Write `docs/review/ux-audit.md`:

1. **Summary:** the 10 changes that would most improve how the app feels,
   ranked, each a sentence with a link to its finding.
2. **Known issues:** the three map items, with the fix plan.
3. **Findings by theme:** flow, cohesion and design-system drift, copy, states,
   maps, accessibility, things to cut.
4. **Per-screen scorecard:** a table with one row per route, columns for flow,
   cohesion, copy and states (good / needs work / poor), and the top issue.
5. **Duplicate components to consolidate:** which one survives and which
   screens move to it.

Then stop. Don't edit app code, don't commit, don't open an MR.
