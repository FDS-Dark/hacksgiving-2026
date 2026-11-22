# Demo-day brief (ready as of Sunday morning)

## Production is live and healthy
- **Website:** https://hacksgiving.austinkoske.com. Web maps work now, including the 911 call map.
- **API:** https://hacksgiving-api.austinkoske.com/v1/health → healthy
- **What's deployed:** `main` @ `3fa2cf9`, production database at migration **0033**. Smoke tests passed.
- **Staging** has the same code: https://hacksgiving-staging.austinkoske.com (database at 0033).
- **Everything shipped:**
  - the new dataloader (rate-gated MPD polling: production every 5 min, staging hourly)
  - team chat, partner requests, "Delivered by", Export my records
  - all the cognitive-load fixes (resident and staff)
  - web maps
  - the My tasks → Done tab fix (it was always empty)
- **Test accounts** (`docs/test-accounts.md` in the repo): the staff accounts now show as **Devon Harris** (worker) and **Jordan Lee** (admin) on both staging and production.
- **Push to a real iPhone works.** It was verified on the staging TestFlight build.

## Present the keynote (4:00)
1. Open `index.html` in Chrome. It needs no internet and no server.
2. Press **P** for the presenter view. Drag it to your laptop screen; it shows the notes, the next slide and the timer.
3. Click the deck window and press **F** for full screen. **That keypress also unlocks sound** for the call and the debrief.
4. **Sound check:** press **S** (in either window, or the 🔊 Test button in the presenter view). The deck window plays the Navigator's first line (about 5 seconds) through the speakers; press S again to stop it. It doesn't move the slides or start the timer, so do it as often as you like before the talk.
5. The **title slide** stays up while people sit down. Press → to go to the call (black stage, 3:01 AM), then **click to start the call**. The presenter timer starts with the call.
6. Use the clicker or arrows to advance. B blanks the screen, S plays the sound check, N shows notes on the deck, Home jumps to the title and End to the close (the appendix comes after it; see below).

## Slides and target times
| # | Slide | Target | Notes |
|---|---|---|---|
| 0 | Title | pre-show | not timed |
| 1 | The call | 0:00–0:31 | **Audio.** Click to start, then say nothing. It cuts to slide 2 by itself at "…has been alerted." |
| 2 | Someone always answers | –0:48 | the real iPhone push recording, zooming on the banner, then the tap and the alert. 1 click for the ladder. |
| 3 | The case builds itself | –1:10 | 2 clicks: team chat, then Sojourner beds and bus |
| 4 | She's not left wondering | –1:26 | 1 click |
| 5 | Shared only with her consent | –1:40 | 1 click |
| 6 | Just talk. We'll write it down. | –2:00 | **Audio, 1 click.** The clip waits on its first frame; click to start Devon's spoken debrief (~11 s). Stop talking while Devon speaks. |
| 7 | Help arrived | –2:13 | |
| 8 | A week later, a pattern | –2:33 | 2 clicks |
| 9 | And everything around it | –2:51 | montage: Get help, Jobs & programs, Community view, My tasks, Queue, 911 call map |
| 10 | The whole team gets better | –3:05 | 1 click |
| 11 | How it's built | –3:33 | 5 clicks; trust markers on the last one. The 4th click's bar now carries the cost line: "Deployed to production · open source · ≈ $70 / month to run, then ~20¢ per call answered" (one short clause in the notes) |
| 12 | Close | –3:56 | 1 click |

**Backup:** `ComForce Keynote.pdf` in this folder: every slide at its final build, with videos as still frames (the appendix pages included).

## Appendix (for Q&A)
After the close, → keeps going into five static appendix slides (no clicks). They're **not timed**: the presenter view shows "Appendix · not timed", the talk timer holds at the time the talk ended, and **End** still jumps to the close, not the appendix. Each has a few lines of Q&A notes. To jump straight to one, type its number and press Enter.

| # | Slide | What's on it |
|---|---|---|
| 13 · A1 | What it costs to run | usage per day and hosting per month (hosting is an AWS list-price estimate), **≈ $70 / month to run, then ~20¢ per call answered** (assuming ~2-minute calls); at 1,000 residents a day that's ≈ $390 / month all-in, about 1.3¢ per resident per day |
| 14 · A2 | How fast help moves | real timings: ~30 s call to page, push in seconds, 5 min per escalation step, ~10 s debrief draft, data every 5 min, MPD's 30–90 min delay |
| 15 · A3 | 16 public data sources | 4 live (every 5 min), 12 daily, plus the MPD rate gate (10 requests per 30 min per IP) |
| 16 · A4 | Privacy and safety, by design | the ten privacy and safety rules |
| 17 · A5 | What's next | Android push, partner portal, more Insights, shorter Navigator calls |

(Slide numbers here count the title as 0, like the table above; in the deck's own numbering, used by number + Enter, they're 14–18.)

## Before you go on stage
- **Rehearse once on the real projector** with two screens. The presenter sync has only been tested in a scripted browser.
- **Sound:** check the room's audio is connected to the laptop. The call and the debrief play through it.
- **Live demo:** if you show the app, use the **staging** app or site with Devon's account. Case **#1002** is the accepted "safe place tonight" case from the push recording. The other test request (#1001) is resolved.

## Known caveats (small)
- **Clip details that don't match the story exactly:**
  - The push clip's lock screen shows 03:01, its case is #1002, and its alert says "Moves to Jordan".
  - The other clips use #1012 and "Moves to Maya".
  - Nobody will read those details at stage distance.
- **Case clip:** there's a cut when it jumps from the referral to Sojourner's place page. A staff referral doesn't link to the place page.
- **The ElevenLabs key** was pasted in chat. It's in Vault (`secret/deployments/hacksgiving/app` → `elevenlabs_api_key`). Rotate it after the hackathon.
- **Media files:**
  - Older media is kept in `assets/old-20261122/` and `assets/old-20261122b/`.
  - The full call audio, segments and timeline are in `assets/audio/call/`.
  - To change a caption, edit `call-timeline.json`, then run `scratchpad\keynote-v3\rebuild-call-data.sh`.
