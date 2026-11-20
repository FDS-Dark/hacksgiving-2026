"""Load a folder of seed SQL files, in name order, into an already-migrated database.

    HACKSGIVING_MIGRATION_DATABASE_URL=postgresql://... python seeds/load.py seeds/local

Seeds are development data, not schema: they aren't Alembic revisions and
each file must be safe to run again (fixed ids, ON CONFLICT DO NOTHING).
Reference data every environment needs belongs in a migration instead.
"""

import os
import sys
from pathlib import Path

import psycopg


def load(url: str, folder: Path) -> None:
    # psycopg wants a libpq URL, not SQLAlchemy's postgresql+psycopg:// form.
    url = url.replace("postgresql+psycopg://", "postgresql://", 1)
    with psycopg.connect(url) as conn:
        for script in sorted(folder.glob("*.sql")):
            print(f"seed {script.name}", file=sys.stderr)
            conn.execute(script.read_text(encoding="utf-8"))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python seeds/load.py <folder>")
    load(os.environ["HACKSGIVING_MIGRATION_DATABASE_URL"], Path(sys.argv[1]))
