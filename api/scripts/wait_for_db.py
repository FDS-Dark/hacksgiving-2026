"""Wait until HACKSGIVING_TEST_DATABASE_URL accepts connections.

CI starts the Postgres service alongside the job, and it can still be
booting when the tests begin. Usage: uv run python scripts/wait_for_db.py [seconds]
"""

import asyncio
import os
import sys
import time

import asyncpg


async def wait(url: str, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    while True:
        try:
            conn = await asyncpg.connect(url, timeout=5)
            await conn.close()
            return
        except (OSError, asyncpg.PostgresError) as exc:
            if time.monotonic() > deadline:
                sys.exit(f"database not ready after {timeout:.0f}s: {exc}")
            await asyncio.sleep(1)


if __name__ == "__main__":
    asyncio.run(wait(os.environ["HACKSGIVING_TEST_DATABASE_URL"], float(sys.argv[1]) if len(sys.argv) > 1 else 60))
    print("database ready")
