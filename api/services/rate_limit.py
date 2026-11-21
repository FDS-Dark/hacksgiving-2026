"""A small per-client rate limit for the endpoints anyone can call without
signing in. Counts live in this process: with several API replicas each
keeps its own, which is enough to stop a script flooding the queue or
guessing access codes, not a precise quota."""

import time
from collections import defaultdict, deque
from dataclasses import dataclass, field

from fastapi import Request

from errors import ApiError


# eq=False keeps it hashable: FastAPI keys dependencies by the callable.
@dataclass(eq=False)
class RateLimit:
    name: str
    limit: int
    window_seconds: float
    _hits: dict[str, deque[float]] = field(default_factory=lambda: defaultdict(deque), repr=False)

    def check(self, key: str, now: float | None = None) -> None:
        """Counts one call for `key`; 429 when it is over the limit."""
        now = time.monotonic() if now is None else now
        hits = self._hits[key]
        while hits and hits[0] <= now - self.window_seconds:
            hits.popleft()
        if len(hits) >= self.limit:
            retry = int(hits[0] + self.window_seconds - now) + 1
            raise ApiError(
                429, "rate_limited", f"Too many requests. Try again in {retry} seconds, or call 911 in an emergency."
            )
        hits.append(now)
        if len(self._hits) > 10_000:
            self._forget_idle(now)

    def _forget_idle(self, now: float) -> None:
        for key in [k for k, v in self._hits.items() if not v or v[-1] <= now - self.window_seconds]:
            del self._hits[key]

    def reset(self) -> None:
        self._hits.clear()

    async def __call__(self, request: Request) -> None:
        """As a FastAPI dependency. The client address is the one uvicorn
        reports, which honors X-Forwarded-For from the ingress
        (--proxy-headers in the Dockerfile)."""
        self.check(request.client.host if request.client else "unknown")


# Sending a request without an account: a person in need sends one or two.
anonymous_submissions = RateLimit("anonymous_submissions", limit=5, window_seconds=3600)
# Reading or replying with an access code: generous for a real person,
# far too slow to guess a code.
code_lookups = RateLimit("code_lookups", limit=60, window_seconds=600)
