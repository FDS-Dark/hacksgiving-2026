"""Background jobs for urgent escalation (docs/design/on-call-and-push.md D3,
docs/design/push-escalation-contract.md phase 3). They follow the stage
contract in services/pipeline.py: `run` only reads, `finish` writes in the
job's completion transaction, and a late or duplicate job does nothing.

    an urgent case is open and unassigned (OncallService.open_for_case)
        -> alert `offering` at step 1, job oncall.offer
    oncall.offer (alert:{id}:offer:{step})
        -> offers for the step's people (steps with nobody new are skipped),
           an urgent_offer notification each, and oncall.escalate at the
           step's expiry; nobody left on the ladder -> `unanswered`
    oncall.escalate (alert:{id}:escalate:{step}), only while still offering
    at that step: pending offers time out
        -> the next step (oncall.offer), or after the last -> `unanswered`
    `unanswered` -> oncall.remind (alert:{id}:remind:{n}), n = 1 at once,
        then every APP__ONCALL__REMIND_SECONDS, at most MAX_REMINDERS: an
        urgent_unanswered notification for every admin

The SQL functions (0018_urgent_alerts.sql) lock the alert and check its
status and step again, so the checks in `run` are only a shortcut.
"""

import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from databridge.executor import FunctionCaller
from databridge.job import JobDatabridge
from databridge.oncall import Advance, OncallDatabridge
from models.job import Job
from models.notification import NotificationKind
from models.oncall import AlertStatus
from services.notification import NotificationService
from services.pipeline import Finish

logger = logging.getLogger(__name__)

OFFER = "oncall.offer"
ESCALATE = "oncall.escalate"
REMIND = "oncall.remind"


async def _nothing(_: FunctionCaller) -> None:
    return None


def _alert_id(job: Job) -> UUID:
    return UUID(str(job.payload["alert_id"]))


async def enqueue_offer(jobs: JobDatabridge, alert_id: UUID, step: int) -> None:
    await jobs.enqueue(OFFER, {"alert_id": str(alert_id), "step": step}, dedupe_key=f"alert:{alert_id}:offer:{step}")


async def enqueue_escalate(jobs: JobDatabridge, alert_id: UUID, step: int, run_at: datetime | None) -> None:
    await jobs.enqueue(
        ESCALATE, {"alert_id": str(alert_id), "step": step}, run_at=run_at,
        dedupe_key=f"alert:{alert_id}:escalate:{step}",
    )


async def enqueue_remind(jobs: JobDatabridge, alert_id: UUID, n: int, run_at: datetime | None = None) -> None:
    await jobs.enqueue(
        REMIND, {"alert_id": str(alert_id), "n": n}, run_at=run_at, dedupe_key=f"alert:{alert_id}:remind:{n}"
    )


async def follow_up(jobs: JobDatabridge, alert_id: UUID, advance: Advance) -> None:
    """The job an escalation leads to: the next step's offers, or the first
    reminder once nobody is left."""
    if advance.outcome == "next" and advance.step is not None:
        await enqueue_offer(jobs, alert_id, advance.step)
    elif advance.outcome == "unanswered":
        logger.warning("Alert %s: nobody accepted; reminding admins", alert_id)
        await enqueue_remind(jobs, alert_id, 1)


class OfferStage:
    kind = OFFER
    timeout = 15.0

    def __init__(
        self, alerts: OncallDatabridge, jobs: JobDatabridge, notifications: NotificationService, offer_seconds: int
    ) -> None:
        self.alerts = alerts
        self.jobs = jobs
        self.notifications = notifications
        self.offer_seconds = offer_seconds

    async def run(self, job: Job) -> Finish:
        alert_id, step = _alert_id(job), int(job.payload["step"])
        alert = await self.alerts.stored_alert(alert_id)
        if alert is None or alert.status != AlertStatus.OFFERING or alert.step != step:
            return _nothing

        async def finish(tx: FunctionCaller) -> None:
            result = await self.alerts.within(tx).offer_step(alert_id, step, self.offer_seconds)
            jobs = self.jobs.within(tx)
            if result.outcome == "offered" and result.step is not None:
                for offer in result.offers:
                    await self.notifications.notify(
                        tx, user_id=offer.user_id, kind=NotificationKind.URGENT_OFFER, dedupe_key=f"offer:{offer.id}",
                        actor_id=None, case_id=result.case_id, alert_id=alert_id, expires_at=offer.expires_at,
                    )
                await enqueue_escalate(jobs, alert_id, result.step, result.step_expires_at)
                logger.info("Alert %s: offered to %d at step %d", alert_id, len(result.offers), result.step)
            elif result.outcome == "unanswered":
                await follow_up(jobs, alert_id, Advance("unanswered", None))

        return finish

    async def after(self, job: Job) -> None:
        return None

    async def on_dead(self, job: Job) -> None:
        return None


class EscalateStage:
    kind = ESCALATE
    timeout = 15.0

    def __init__(self, alerts: OncallDatabridge, jobs: JobDatabridge) -> None:
        self.alerts = alerts
        self.jobs = jobs

    async def run(self, job: Job) -> Finish:
        alert_id, step = _alert_id(job), int(job.payload["step"])
        alert = await self.alerts.stored_alert(alert_id)
        # Accepted, passed on early, or closed since: nothing to do.
        if alert is None or alert.status != AlertStatus.OFFERING or alert.step != step:
            return _nothing

        async def finish(tx: FunctionCaller) -> None:
            advance = await self.alerts.within(tx).escalate(alert_id, step)
            await follow_up(self.jobs.within(tx), alert_id, advance)

        return finish

    async def after(self, job: Job) -> None:
        return None

    async def on_dead(self, job: Job) -> None:
        return None


class RemindStage:
    kind = REMIND
    timeout = 15.0

    def __init__(
        self,
        alerts: OncallDatabridge,
        jobs: JobDatabridge,
        notifications: NotificationService,
        remind_seconds: int,
        max_reminders: int,
    ) -> None:
        self.alerts = alerts
        self.jobs = jobs
        self.notifications = notifications
        self.remind_seconds = remind_seconds
        self.max_reminders = max_reminders

    async def run(self, job: Job) -> Finish:
        alert_id, n = _alert_id(job), int(job.payload["n"])
        alert = await self.alerts.stored_alert(alert_id)
        if (
            n > self.max_reminders
            or alert is None
            or alert.status != AlertStatus.UNANSWERED  # accepted or closed meanwhile
            or alert.reminders_sent != n - 1  # this one already went out
        ):
            return _nothing

        async def finish(tx: FunctionCaller) -> None:
            outcome, case_id, admins = await self.alerts.within(tx).remind(alert_id, n, self.max_reminders)
            if outcome != "reminded":
                return
            for admin in admins:
                await self.notifications.notify(
                    tx, user_id=admin, kind=NotificationKind.URGENT_UNANSWERED,
                    dedupe_key=f"unanswered:{alert_id}:{n}", actor_id=None, case_id=case_id, alert_id=alert_id,
                )
            if n < self.max_reminders:
                next_at = datetime.now(timezone.utc) + timedelta(seconds=self.remind_seconds)
                await enqueue_remind(self.jobs.within(tx), alert_id, n + 1, next_at)

        return finish

    async def after(self, job: Job) -> None:
        return None

    async def on_dead(self, job: Job) -> None:
        return None
