import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import pytest

# Add the parent directory to sys.path so we can import from the API modules
api_root = Path(__file__).parent.parent
sys.path.insert(0, str(api_root))

# Tests sign HS256 tokens with the dev secret, whatever api/.env says (it may
# point at Auth0). settings.py's load_dotenv doesn't override variables that
# are already set, so pin JWT verification here, before settings is imported.
os.environ.update({
    "APP__JWT__ALGORITHM": "HS256",
    "APP__JWT__JWKS_URL": "",
    "APP__JWT__ISSUER": "",
    "APP__JWT__AUDIENCE": "",
})

from models.user import AppUser  # noqa: E402


@pytest.fixture
def sample_user() -> AppUser:
    return AppUser(
        id=uuid4(),
        auth0_sub="auth0|user-a",
        display_name="User A",
        timezone="UTC",
        created_at=datetime.now(timezone.utc),
    )
