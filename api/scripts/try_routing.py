"""Routes sample requests against the real OpenAI model.

    uv run python scripts/try_routing.py                 # the samples below
    uv run python scripts/try_routing.py "i need a ride to court tomorrow"

Needs APP__OPENAI__API_KEY in api/.env."""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from dependencies import get_routing_service  # noqa: E402

SAMPLES = [
    "i got evicted and me and my kids are sleeping in the car",
    "my son hasnt come home in 2 days and wont answer his phone",
    "theres no food in the house",
    "some guys keep threatening my nephew and say theyll come back",
    "two families are yelling outside my building and its about to get physical",
    "my mom passed last week and we cant pay for the funeral",
    "just got out and need a job",
    "i need help with this thing",
]


async def main() -> None:
    service = get_routing_service()
    for message in sys.argv[1:] or SAMPLES:
        r = await service.route(message)
        extra = f" (+{', '.join(r.also_relevant)})" if r.also_relevant else ""
        print(f"{'URGENT ' if r.urgent else ''}{r.service}{extra}  <- {message!r}\n    {r.reason}")
        if r.follow_up_question:
            print(f"    ask: {r.follow_up_question}")


asyncio.run(main())
