"""Writes the API's OpenAPI document, the contract the mobile app's types
are generated from (apps/mobile/src/api/schema.ts).

    uv run python scripts/export_openapi.py ../apps/mobile/openapi.json

CI regenerates it and fails when the committed copy differs, so a change
to a model can't reach the app without its types changing too.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from main import app  # noqa: E402

if len(sys.argv) != 2:
    sys.exit("usage: python scripts/export_openapi.py <output.json>")
Path(sys.argv[1]).write_text(json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n", encoding="utf-8")
