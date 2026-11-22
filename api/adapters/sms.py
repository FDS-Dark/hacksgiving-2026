"""Text messages to requesters. Two backends, one interface (`SmsSender`):

- `TwilioSms`: Twilio's Messages API (the account the phone agent's number is
  on), from `APP__SMS__FROM_NUMBER` or a Messaging Service.
- `FakeSms`: logs instead of sending, for local development.

Chosen by `APP__SMS__PROVIDER` (`twilio` | `fake` | `off`, the default).
Called only from services/text.py, in the worker."""

import base64
import logging
import re
import uuid
from dataclasses import dataclass
from typing import Protocol

import httpx

from settings import SmsConfig

logger = logging.getLogger(__name__)

TWILIO_API = "https://api.twilio.com/2010-04-01"
# Twilio errors that mean "don't try this number again": opted out (21610),
# not a valid or textable number (21211, 21614, 21612).
PERMANENT = {21610: "opted_out", 21211: "invalid_number", 21614: "invalid_number", 21612: "not_textable"}


def us_number(text: str | None) -> str | None:
    """A US phone number in E.164 ('+14145550199'), or None."""
    digits = re.sub(r"\D", "", text or "")
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10 or digits[0] in "01" or digits[3] in "01":
        return None
    return "+1" + digits


@dataclass(frozen=True)
class SmsResult:
    sent: bool
    provider_id: str | None = None
    # When not sent: a short reason (opted_out, invalid_number, twilio_30007).
    reason: str | None = None
    # Not sent, and trying again later may work (a network blip, a 5xx).
    retry: bool = False


class SmsSender(Protocol):
    async def send(self, to: str, body: str) -> SmsResult: ...

    async def close(self) -> None: ...


class FakeSms:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []

    async def send(self, to: str, body: str) -> SmsResult:
        self.sent.append((to, body))
        logger.info("Fake text to ...%s: %s", to[-4:], body)
        return SmsResult(sent=True, provider_id=f"fake-{uuid.uuid4().hex[:12]}")

    async def close(self) -> None:
        return None


class TwilioSms:
    def __init__(self, config: SmsConfig, http: httpx.AsyncClient | None = None) -> None:
        self.config = config
        token = base64.b64encode(f"{config.twilio_account_sid}:{config.twilio_auth_token}".encode()).decode()
        self.http = http or httpx.AsyncClient(timeout=15.0, headers={"Authorization": f"Basic {token}"})

    async def send(self, to: str, body: str) -> SmsResult:
        form = {"To": to, "Body": body}
        if self.config.twilio_messaging_service_sid:
            form["MessagingServiceSid"] = self.config.twilio_messaging_service_sid
        else:
            form["From"] = self.config.from_number
        url = f"{TWILIO_API}/Accounts/{self.config.twilio_account_sid}/Messages.json"
        try:
            response = await self.http.post(url, data=form)
        except httpx.HTTPError as exc:
            return SmsResult(sent=False, reason=f"network_{type(exc).__name__}"[:60], retry=True)
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        if response.status_code in (200, 201):
            return SmsResult(sent=True, provider_id=str(payload.get("sid") or "")[:64] or None)
        code = payload.get("code") if isinstance(payload, dict) else None
        if isinstance(code, int) and code in PERMANENT:
            return SmsResult(sent=False, reason=PERMANENT[code])
        if response.status_code == 429 or response.status_code >= 500:
            return SmsResult(sent=False, reason=f"twilio_{response.status_code}", retry=True)
        # Any other 4xx is our setup (credentials, the From number): log it loudly, don't retry this update.
        logger.error("Twilio refused a text: %s %s", response.status_code, code)
        return SmsResult(sent=False, reason=f"twilio_{code or response.status_code}")

    async def close(self) -> None:
        await self.http.aclose()


def make_sms_sender(config: SmsConfig) -> SmsSender | None:
    if config.provider == "twilio":
        if not (config.twilio_account_sid and config.twilio_auth_token
                and (config.from_number or config.twilio_messaging_service_sid)):
            logger.warning("APP__SMS__PROVIDER=twilio but its credentials aren't set; texts are off")
            return None
        return TwilioSms(config)
    if config.provider == "fake":
        return FakeSms()
    return None
