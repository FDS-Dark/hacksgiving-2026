"""What the worker does when a National Weather Service alert takes effect
(the loader brings them in every 5 minutes; docs/data-loader.md). Run from
the worker's upkeep, once a minute. Each alert is acted on once, across
every replica: claiming it and acting on it are one transaction.

- Cold or heat (`needs_shelter`) at Moderate or worse: every open
  homelessness case gets a check-in task, due in `CHECK_IN_WITHIN`, with
  its usual reminder 30 minutes before. Someone sleeping outside is the
  person the cold kills.
- Severe or Extreme, or cold or heat at Moderate: a `community_alert` push
  to residents who opted in (Me -> Community alerts). It follows their push
  switch and quiet hours like any other non-urgent push.
"""

import logging
import re
from datetime import datetime, timedelta, timezone

from databridge.community import CommunityDatabridge
from databridge.executor import Transactions
from databridge.job import JobDatabridge
from databridge.task import TaskDatabridge
from models.notification import NotificationKind
from models.public_data import WeatherAlert
from services.notification import NotificationService
from services.notification_jobs import enqueue_task_reminder

logger = logging.getLogger(__name__)

CHECK_IN_WITHIN = timedelta(hours=3)
SERIOUS = frozenset({"Severe", "Extreme"})
SHELTER_WEATHER = re.compile(r"cold|chill|freez|frost|winter|blizzard|snow|ice|heat", re.IGNORECASE)


def needs_shelter(alert: WeatherAlert) -> bool:
    """Cold or heat: weather that is dangerous to be out in overnight."""
    return bool(SHELTER_WEATHER.search(alert.event))


def wants_outreach(alert: WeatherAlert) -> bool:
    return needs_shelter(alert) and alert.severity in ("Moderate", *SERIOUS)


def wants_community_push(alert: WeatherAlert) -> bool:
    return alert.severity in SERIOUS or wants_outreach(alert)


def check_in_task(alert: WeatherAlert) -> tuple[str, str]:
    """The task's title (at most 160 characters) and detail."""
    title = f"Check in: {alert.event}"[:160]
    lines = [alert.headline or alert.event, alert.instruction or ""]
    detail = "\n\n".join(line for line in lines if line) + "\n\nMake sure they have somewhere warm (or cool) tonight."
    return title, detail[:2000]


class WeatherWatch:
    def __init__(self, transactions: Transactions, notifications: NotificationService) -> None:
        self.transactions = transactions
        self.notifications = notifications

    async def sweep(self, now: datetime | None = None) -> int:
        """Act on alerts that took effect since the last sweep. Returns how
        many were new."""
        now = now or datetime.now(timezone.utc)
        async with self.transactions.transaction() as tx:
            community = CommunityDatabridge(tx)
            fresh = await community.claim_new_weather()
            for source, alert in fresh:
                if wants_outreach(alert):
                    title, detail = check_in_task(alert)
                    ids = await community.outreach_tasks(title, detail, now + CHECK_IN_WITHIN)
                    tasks, jobs = TaskDatabridge(tx), JobDatabridge(tx)
                    for task_id in ids:
                        task = await tasks.get(task_id)
                        if task is not None:
                            await enqueue_task_reminder(jobs, task, now=now)
                    logger.info("Weather alert %s: %d check-in task(s)", alert.event, len(ids))
                if wants_community_push(alert):
                    recipients = await community.recipients()
                    for user_id in recipients:
                        await self.notifications.notify(
                            tx, user_id=user_id, kind=NotificationKind.COMMUNITY_ALERT,
                            dedupe_key=f"weather:{source}:{alert.id}", actor_id=None,
                        )
                    logger.info("Weather alert %s: community alert to %d resident(s)", alert.event, len(recipients))
        return len(fresh)
