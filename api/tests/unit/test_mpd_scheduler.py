"""The in-API ingest loop: scrapes only when it holds the lease, survives a
failed run or an unmigrated database, and ingests right at startup."""

import asyncio

from databridge.mpd_call import MpdCallDatabridge
from services.mpd_calls import MpdCallService
from services.mpd_scheduler import MpdIngestLoop
from tests.unit.fakes import FakeFunctions
from tests.unit.test_mpd_calls import PAGE


class Client:
    def __init__(self, page=PAGE):
        self.page = page
        self.closed = False

    async def fetch_calls_page(self):
        return self.page

    async def geocode(self, address):
        return (43.0, -87.9)

    async def aclose(self):
        self.closed = True


def loop_with(claimed, **handlers):
    fake = FakeFunctions(
        mpd_ingest_claim=claimed,
        mpd_geocode_lookup=[], mpd_geocode_save=[], mpd_calls_upsert=[{"new_calls": 5}],
        mpd_calls_prune=[{"deleted": 0}], mpd_ingest_record=[], **handlers,
    )
    return MpdIngestLoop(MpdCallService(MpdCallDatabridge(fake)), 120), fake


async def test_ingests_when_it_holds_the_lease():
    loop, fake = loop_with([{"claimed": True}])
    assert await loop.tick(Client()) is True
    assert fake.called("mpd_ingest_claim") == [{"every_seconds": 120}]
    assert len(fake.called("mpd_calls_upsert")) == 1


async def test_skips_when_another_process_holds_it():
    loop, fake = loop_with([{"claimed": False}])
    assert await loop.tick(Client()) is False
    assert fake.called("mpd_calls_upsert") == []


async def test_a_failed_scrape_does_not_stop_the_loop():
    loop, fake = loop_with([{"claimed": True}])
    assert await loop.tick(Client(page="<html>down</html>")) is True
    [run] = fake.called("mpd_ingest_record")
    assert run["ok"] is False


RATE_LIMITED = (
    "<table><tbody><tr><td>17952985</td><td>11/21/2026 04:02:19 PM</td>"
    "<td><h3 style='color: red;'>Milwaukee: You have made 14 calls in the last 30 minutes, "
    "current limit is 10.</h3></td>"
    "<td>-1</td><td>Unreasonable amount of requests</td>"
    "<td><h3>You will be denied results until your number of calls is a reasonable number</h3></td>"
    "</tr></tbody></table>"
)


async def test_the_city_rate_limit_is_recorded_as_such():
    loop, fake = loop_with([{"claimed": True}])
    assert await loop.tick(Client(page=RATE_LIMITED)) is True
    [run] = fake.called("mpd_ingest_record")
    assert run["ok"] is False and "rate limit" in run["error"]
    assert fake.called("mpd_calls_upsert") == []


def test_the_interval_cannot_break_the_city_limit():
    import pytest
    from pydantic import ValidationError

    from settings import MpdIngestConfig

    assert MpdIngestConfig().interval_seconds == 300
    with pytest.raises(ValidationError):
        MpdIngestConfig(interval_seconds=120)


async def test_an_unmigrated_database_is_skipped_not_fatal():
    def missing(_):
        raise RuntimeError("function app.mpd_ingest_claim does not exist")

    loop, fake = loop_with(missing)
    assert await loop.tick(Client()) is False
    assert await loop.tick(Client()) is False
    assert fake.called("mpd_calls_upsert") == []


async def test_runs_at_startup_then_sleeps_and_closes_on_stop():
    slept = asyncio.Event()

    async def sleep(_):
        slept.set()
        await asyncio.Event().wait()  # park until cancelled

    client = Client()
    loop, fake = loop_with([{"claimed": True}])
    loop._client_factory = lambda: client
    loop._sleep = sleep
    loop.start()
    await asyncio.wait_for(slept.wait(), 2)
    assert len(fake.called("mpd_calls_upsert")) == 1  # ingested before the first sleep
    await loop.stop()
    assert client.closed
