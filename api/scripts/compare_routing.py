"""Routes labeled sample requests with both routers, against the real APIs,
and compares accuracy, latency and cost.

    uv run python scripts/compare_routing.py                 # api/.env
    uv run python scripts/compare_routing.py --env ../../api/.env

Needs APP__OPENAI__API_KEY. Costs a few cents."""

import argparse
import asyncio
import os
import sys
import time
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).parent.parent))

parser = argparse.ArgumentParser()
parser.add_argument("--env", help="A .env file to read APP__* settings from")
args = parser.parse_args()
if args.env:
    load_dotenv(args.env, override=False)

from openai import AsyncOpenAI  # noqa: E402

from models.routing import Service  # noqa: E402
from services.routing import RoutingService  # noqa: E402
from services.routing_decisions import DecisionsRoutingService  # noqa: E402
from settings import config  # noqa: E402

S = Service
# (message, expected service, also acceptable, expected urgent)
CASES: list[tuple[str, Service, set[Service], bool]] = [
    ("i got evicted and me and my kids are sleeping in the car", S.HOMELESSNESS, set(), False),
    ("my son hasnt come home in 2 days and wont answer his phone", S.MISSING_PERSONS, set(), True),
    ("theres no food in the house", S.MEAL_PROGRAMS, set(), False),
    ("some guys keep threatening my nephew and say theyll come back", S.VIOLENCE_PREVENTION, set(), True),
    ("two families are yelling outside my building and its about to get physical", S.INCIDENT_DEESCALATION,
     {S.VIOLENCE_PREVENTION}, True),
    ("my mom passed last week and we cant pay for the funeral", S.BURIAL_ASSISTANCE, set(), False),
    ("just got out and need a job", S.BRIDGE_TO_EMPLOYMENT, set(), False),
    ("i need help with this thing", S.UNCLEAR, set(), False),
    ("need a ride to court tomorrow at 9, no bus fare", S.TRANSPORTATION, set(), False),
    ("somebody shot at my cousins house last night and they're saying they'll be back", S.VIOLENCE_PREVENTION,
     set(), True),
    ("my 8 year old daughter didnt come home from school and its dark out", S.MISSING_PERSONS, set(), True),
    ("guy outside the store is screaming at people and throwing things right now", S.INCIDENT_DEESCALATION,
     set(), True),
    ("we have a shelter bed but no way to get there tonight", S.TRANSPORTATION, {S.HOMELESSNESS}, False),
    ("my landlord gave us 5 days to leave", S.HOMELESSNESS, set(), False),
    ("kids havent eaten since yesterday", S.MEAL_PROGRAMS, set(), False),
    ("need help writing a resume for a warehouse job", S.BRIDGE_TO_EMPLOYMENT, set(), False),
    ("my brother was killed and we want to stop the retaliation before someone else gets hurt",
     S.VIOLENCE_PREVENTION, set(), True),
    ("necesito comida para mis hijos", S.MEAL_PROGRAMS, set(), False),
    ("he has a gun and he's banging on my door", S.VIOLENCE_PREVENTION, {S.INCIDENT_DEESCALATION}, True),
    ("hello", S.UNCLEAR, set(), False),
]

# gpt-5.4-mini list prices (per 1M tokens) for the Responses router's cost.
MINI_INPUT, MINI_OUTPUT = 0.75, 4.50


class Metered:
    """Wraps AsyncOpenAI().responses to keep each call's token usage."""

    def __init__(self, responses: Any) -> None:
        self.responses = responses
        self.usage: Any = None

    async def parse(self, **kwargs: Any) -> Any:
        result = await self.responses.parse(**kwargs)
        self.usage = result.usage
        return result


async def main() -> None:
    if not config.openai.api_key:
        sys.exit("APP__OPENAI__API_KEY is not set (pass --env path/to/api/.env)")
    metered = Metered(AsyncOpenAI(api_key=config.openai.api_key, max_retries=1).responses)
    responses = RoutingService(metered, config.openai.model)  # type: ignore[arg-type]
    decisions = DecisionsRoutingService(config.openai.api_key, config.openai.decisions_model)

    rows = []
    for message, expected, ok_also, urgent in CASES:
        t = time.monotonic()
        r1 = await responses.route(message)
        t1 = time.monotonic() - t
        u = metered.usage
        c1 = (u.input_tokens * MINI_INPUT + u.output_tokens * MINI_OUTPUT) / 1e6
        try:
            r2 = await decisions.decide(message)
            t2, c2 = decisions.last_usage.seconds, decisions.last_usage.usd  # type: ignore[union-attr]
            err = None
        except Exception as e:  # report it; don't fall back here, we're measuring Decisions
            r2, t2, c2, err = None, 0.0, 0.0, f"{type(e).__name__}: {e}"[:120]
        rows.append((message, expected, ok_also, urgent, r1, t1, c1, r2, t2, c2, err))

    def right(r: Any, expected: Service, ok: set[Service]) -> bool:
        return r is not None and r.service in {expected, *ok}

    print(f"{'request':<58} {'expected':<22} {'responses':<22} {'decisions':<22}")
    for message, exp, ok, urg, r1, t1, c1, r2, t2, c2, err in rows:
        a = f"{r1.service}{'!' if r1.urgent else ''}{'' if right(r1, exp, ok) else ' ✗'}"
        b = err or f"{r2.service}{'!' if r2.urgent else ''}{'' if right(r2, exp, ok) else ' ✗'}"
        print(f"{message[:57]:<58} {exp + ('!' if urg else ''):<22} {a:<22} {b:<22}")

    n = len(rows)
    for label, i_r, i_t, i_c in (("Responses (gpt-5.4-mini)", 4, 5, 6), ("Decisions (gpt-6-luna)", 7, 8, 9)):
        got = [row for row in rows if row[i_r] is not None]
        service_ok = sum(right(row[i_r], row[1], row[2]) for row in got)
        urgent_ok = sum(row[i_r].urgent == row[3] for row in got)
        missed_urgent = sum(row[3] and not row[i_r].urgent for row in got)
        cost = sum(row[i_c] for row in got)
        latency = sum(row[i_t] for row in got) / max(len(got), 1)
        print(f"\n{label}: answered {len(got)}/{n}, service right {service_ok}/{len(got)}, urgent right "
              f"{urgent_ok}/{len(got)} (missed urgent: {missed_urgent}), avg {latency:.2f}s, "
              f"total ${cost:.5f} (${cost / max(len(got), 1) * 1000:.3f} per 1,000 requests)")
    errors = [row[10] for row in rows if row[10]]
    if errors:
        print("\nDecisions errors:", *sorted(set(errors)), sep="\n  ")
    sys.stdout.flush()
    os._exit(0)


asyncio.run(main())
