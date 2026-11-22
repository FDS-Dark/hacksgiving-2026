"""Texts to requesters, from the worker's upkeep (like services/place.py,
so it covers every way an update is written without touching any of them).

Who: a case whose requester chose "text me" and said texting is safe
(cases.contact_method = 'text', safe_to_contact). What: the request coming
in, a staff message, a status change. The text is always generic and never
holds the update's content: the phone may not be private, and these are
sometimes domestic-violence cases. It names only the request number and
where to read the update. At most one text per case every
`coalesce_minutes`; skipped updates are recorded as `coalesced`.
"""

import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from adapters.sms import SmsSender, us_number
from databridge.text import TextDatabridge
from models.text import CaseText, PendingText, TextStatus

logger = logging.getLogger(__name__)

STOP = "Reply STOP to stop texts."


def text_for(item: PendingText) -> str:
    """The generic text for one update."""
    where = "Open the ComForce MKE app (Requests, or Get help > Check a request with your code) to see it."
    if item.update_type == "created":
        return (f"ComForce MKE: we got your request #{item.case_number}. We'll text when there's an update. "
                f"{STOP}")
    if item.update_type == "status_change" and item.case_status in ("resolved", "closed"):
        return f"ComForce MKE: request #{item.case_number} is marked done. {where} {STOP}"
    return f"ComForce MKE: there's an update on request #{item.case_number}. {where} {STOP}"


class CaseTexter:
    def __init__(self, texts: TextDatabridge, sender: SmsSender, *, coalesce_minutes: int = 30,
                 batch: int = 20) -> None:
        self.texts = texts
        self.sender = sender
        self.coalesce = timedelta(minutes=coalesce_minutes)
        self.batch = batch

    async def sweep(self, now: datetime | None = None) -> int:
        """Handles up to `batch` pending updates. Returns how many were sent."""
        now = now or datetime.now(timezone.utc)
        sent = 0
        last_sent: dict[object, datetime] = {}
        for item in await self.texts.pending(self.batch):
            last = max(filter(None, (item.last_sent_at, last_sent.get(item.case_id))), default=None)
            if last is not None and now - last < self.coalesce:
                await self.texts.record(item.case_id, item.case_update_id, TextStatus.SKIPPED, "coalesced", None)
                continue
            to = us_number(item.contact_phone)
            if to is None:
                await self.texts.record(item.case_id, item.case_update_id, TextStatus.SKIPPED, "invalid_number",
                                        None)
                continue
            result = await self.sender.send(to, text_for(item))
            if result.retry:
                logger.warning("Text for case #%s not sent yet: %s", item.case_number, result.reason)
                continue  # next round
            status = TextStatus.SENT if result.sent else TextStatus.FAILED
            await self.texts.record(item.case_id, item.case_update_id, status, result.reason, result.provider_id)
            if result.sent:
                sent += 1
                last_sent[item.case_id] = now
        return sent


class CaseTextService:
    """What a case's requester was texted, for staff (outcomes only)."""

    def __init__(self, texts: TextDatabridge) -> None:
        self.texts = texts

    async def for_case(self, case_id: UUID) -> list[CaseText]:
        return await self.texts.for_case(case_id)
