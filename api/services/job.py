"""The job queue as staff see it: how much work is waiting, running or dead
(the worker itself uses JobDatabridge directly)."""

from databridge.job import JobDatabridge
from models.job import JobStat


class JobService:
    def __init__(self, jobs: JobDatabridge) -> None:
        self.jobs = jobs

    async def stats(self) -> list[JobStat]:
        return await self.jobs.stats()
