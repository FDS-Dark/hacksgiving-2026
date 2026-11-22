# ElevenLabs submit-request tool

Provider tool `submit_comforce_request` (`tool_2301m80ncgsmejpsjwcz3ycdr83c`)
was created in ElevenLabs on 2026-11-21 and points to
`POST /v1/voice/requests`.

It is intentionally **not attached to Ava yet**. Attach it only after both of
these gates are satisfied:

1. The team approves whether a non-emergency caller who needs help today may
   page the on-call worker.
2. The deployed API accepts the required `urgency` field and maps `urgent` to
   the approved, configurable paging behavior. Until then, production ignores
   an unknown urgency field, which would make the provider appear to promise a
   behavior the backend did not perform.

## Tool contract

Required fields:

- `conversation_id`: ElevenLabs `system__conversation_id`.
- `consent`: true only after the caller hears and approves the complete
  submission.
- `approved_summary`: short, caller-approved facts only; never a transcript.
- `category`: the exact service returned by the routing tool.
- `urgency`: `routine` or `urgent`. `urgent` means help is needed today without
  immediate danger. An emergency is never submitted; Ava directs the caller
  to hang up and call 911.
- `contact_method`: `none`, `call`, or `text`.

Optional fields are a general neighborhood or ZIP, the system-provided caller
ID, and explicit safe-to-contact consent. The tool reuses the existing
`X-Voice-Tool-Secret` provider credential and contains no client-side secret.

## Activation check

Before attaching the tool, verify production OpenAPI includes `urgency` on
`VoiceCaseRequest`. After attaching it, run one synthetic routine request and
one synthetic urgent-but-not-emergency request. Confirm routine creates no
page, urgent follows the approved setting, and neither staff review nor logs
contain a caller number, recording, or transcript.
