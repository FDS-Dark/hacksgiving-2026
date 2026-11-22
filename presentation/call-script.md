# Call script: the 4:07 AM call (keynote beat 1)

**Who:** a friend plays the caller. The other end is ComForce's **Community
Response Navigator**, the AI phone agent. (Don't call the bot "Ava".)

**Number:** **+1 (414) 251-1724**
**Length:** about 90–120 seconds live. The keynote uses a 20–25 second cut.
**Story:** a mother with two kids has nowhere safe to sleep tonight, near
27th & Center. She has a phone but no data plan, so she can't use the app.
Nobody is in danger right now. She's urgent (needs someone tonight), not a
911 emergency.

---

## Before you record

1. **Record on the production release.** The navigator talks to the
   deployed API. Do this after this weekend's release reaches production, so
   the urgent request pages on call.
2. **On-call worker:** make sure the demo worker (Devon, or whoever holds the
   staff phone) is **on call right now** in the staff app (Me → On call).
   Push on a real phone needs the signed TestFlight build.
3. **Two recordings at once** (they become keynote beats 1 and 2):
   - **Caller:** put the call on speaker and screen-record the caller's phone
     with audio, or record with a second phone/mic. Captions get added in the
     edit.
   - **Staff phone, locked, screen recording on:** it should light up with
     **"Urgent request"** (no case details on the lock screen). Then tap it,
     open the case, and tap **Accept**. This is `push-notification.mp4`.
4. **Synthetic details only:** no real names, no real addresses, no real
   numbers read aloud. The navigator uses caller ID for texting, so you never
   say a phone number.
5. **Quiet room.** Speak a little slower than normal. Pause after the
   navigator finishes each turn; it waits for silence.

---

## The call

> Lines in **bold** are the caller (read them close to verbatim).
> *Italic* lines are roughly what the navigator says. Its exact wording
> varies, so just respond naturally to what it actually asks.

*Navigator:* "Hi, this is the ComForce MKE Community Response Navigator,
powered by AI. I connect Milwaukee callers with community resources. If anyone
is in immediate danger, hang up and call 911. How can I help?"

**Caller:** "Hi. Nobody's in danger right now. But I'm with my two kids and we
don't have anywhere safe to sleep tonight. We're near 27th and Center."

*Navigator:* (finds housing and shelter help; may name a shelter from the
directory and say to call to confirm space)

*Navigator:* "Would you like to save this follow-up and continue in the
ComForce app?"

**Caller:** "I can't. My phone doesn't have data right now. Can someone from
ComForce just reach out to me?"

*Navigator:* (offers to submit a request to ComForce by phone)

**Caller:** "Yes, please."

*Navigator:* (asks for a short summary, or reads one back)

**Caller:** "I need a safe place to stay tonight with my two kids."

*Navigator:* (asks how ComForce can reach you: call, text, or no contact)

**Caller:** "Text is best."

*Navigator:* (asks whether it's safe to contact you, whether a text can be
left, and whether messages should be neutral)

**Caller:** "Yes, it's safe to text. Please keep the message neutral. Don't
say ComForce."

*Navigator:* (may ask for a safe day or time window)

**Caller:** "Anytime tonight is fine."

*Navigator:* (reads the summary and fields back, then asks permission to
submit them to ComForce)

**Caller:** "Yes, that's right. Please send it."

*Navigator:* "I've marked this urgent, so the ComForce staff member on call
has been alerted. This isn't an emergency dispatch, and I can't promise when
someone will reach you. If anyone is in danger, hang up and call 911."
(then reads a **request number** and **access code**)

**Caller:** "Thank you. I'll keep those."

*(Hang up. The staff phone should have lit up a few seconds after the
"marked this urgent" line.)*

---

## The keynote cut (about 20–25 s)

Use these moments, with a caption under each:

1. *"…Community Response Navigator, powered by AI… If anyone is in immediate
   danger, hang up and call 911."* (2–3 s, then cut)
2. **"…we don't have anywhere safe to sleep tonight. We're near 27th and
   Center."**
3. **"Text is best… keep the message neutral."**
4. *"I've marked this urgent, so the ComForce staff member on call has been
   alerted."* ← the moment the staff phone lights up (beat 2)

**Captions:** use white, bold, large, bottom-center. Use "Caller" and
"Community Response Navigator" as speaker labels.

**Files:**

| Clip | Save as |
|---|---|
| The call | `assets/video/ava-call.mp4` |
| The staff phone | `assets/video/push-notification.mp4` |

The deck picks both up automatically on reload. (The filename `ava-call.mp4`
is just what the deck expects; the on-screen name is the Navigator.)

---

## If something goes off-script

- **It gives the 911 line and hangs up:** you said something that sounded
  like danger now. Call back and lead with "Nobody's in danger right now."
- **It doesn't offer to submit a request:** after it names a resource, say
  "Can someone from ComForce reach out to me instead?"
- **It doesn't say "marked this urgent":** say "We need somewhere tonight,"
  which is the urgent-today case. If it still treats it as routine, the
  deployed prompt may differ. Tell the team, and use the backup: submit the
  same request from the app's Get help form, and record the staff phone
  getting paged.
- **No push on the staff phone:** check the worker is on call, that
  notifications are allowed for the TestFlight build, and that the release
  reached production. The red "Urgent" banner on the staff Today screen also
  shows the page, and can be the fallback shot.
- **Never** read a real phone number, address or name, and never ask the
  navigator to transfer to a public agency.
