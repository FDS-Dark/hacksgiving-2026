# Community Response Navigator: provider setup

Twilio owns the phone number, ElevenLabs owns the live conversation, and the
Hacksgiving API stores only a minimal structured outcome. This is **not an
emergency service**: never configure 911, 988, or another short code as a
transfer target. Immediate danger must trigger an instruction to hang up and
dial 911 without continuing intake.

## Required accounts and secrets

- A voice-capable Twilio number and its Account SID/Auth Token.
- An ElevenLabs account with ElevenAgents access and a restricted provisioning
  API key.
- Independent `elevenlabs_webhook_secret` and `voice_tool_secret` values in
  Vault. Never reuse provider credentials or expose any secret to mobile code.

## Safe setup order

1. Deploy the API and migration `0007`; confirm the HTTPS voice endpoints.
2. Configure the prompt in [agent-prompt.md](agent-prompt.md).
3. Enable only a teammate or explicitly approved ComForce responder as a
   transfer destination. The adapter rejects emergency short codes.
4. Disable audio saving and set transcript/audio retention to zero (or enable
   Zero Retention Mode) before the first real call.
5. Configure the signed post-call webhook at
   `POST /v1/voice/webhooks/elevenlabs` and store its HMAC secret in Vault.
6. Import the Twilio number into ElevenLabs and attach it to the tested agent.
7. Configure server-side tools using `X-Voice-Tool-Secret`:
   - `GET /v1/voice/app-capabilities` so app screens, departments, handoff
     steps, and limitations come from the backend rather than the model.
   - `POST /v1/voice/route` with `system__conversation_id` and a short need
     description. This uses the same ComForce service classifier as Get Help
     and stores only its structured category on the call.
   - `GET /v1/voice/resources`
   - `POST /v1/voice/referrals`
   - `POST /v1/voice/referrals/{referral_id}/outcome`
   - `POST /v1/voice/handoffs` with `system__conversation_id` and
     `system__caller_id` when the caller
     explicitly asks to continue in the app. Read the returned eight-character
     code aloud; never ask for their password, phone number, or login code.
     The caller ID is immediately converted to a keyed hash. Claiming the code
     while signed in links that hash to the account so future calls can create
     private inbox follow-ups; caller ID alone never authorizes spoken account
     details or consequential changes.
8. Simulate emergency, routine, failed-transfer, Spanish, unlisted-number, and
   prompt-injection cases before attaching the public number.

Production transfers require approval from the receiving organization. The
model never supplies arbitrary phone numbers: only reviewed backend resources
and enabled provider destinations may be used.

## Go-live checks

- The agent identifies itself as AI and states the 911 boundary.
- Audio saving is off; retention is zero/ZRM.
- Webhook HMAC failures return 401 without logging the body.
- The demo uses synthetic scenarios and only an approved responder.
- The kill switch is known: unassign the number or disable inbound voice.

Official references: [native Twilio integration](https://elevenlabs.io/docs/eleven-agents/phone-numbers/twilio-integration/native-integration),
[transfer tool](https://elevenlabs.io/docs/eleven-agents/customization/tools/system-tools/transfer-to-number),
[privacy](https://elevenlabs.io/docs/eleven-agents/customization/privacy), and
[post-call webhooks](https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks).
