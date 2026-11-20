"""Prints an HS256 access token for local development (no Auth0 needed).

    uv run python scripts/dev_token.py                       # the seeded dev user
    uv run python scripts/dev_token.py "auth0|someone" Sam   # any subject and name
    DEV_TOKEN_HOURS=72 uv run python scripts/dev_token.py    # longer than 12 hours

Only works while APP__JWT__JWKS_URL is empty, i.e. never against Auth0.
"""

import os
import sys
import time
from pathlib import Path

import jwt

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from settings import config  # noqa: E402

if config.jwt.jwks_url:
    sys.exit("APP__JWT__JWKS_URL is set; dev tokens are only for the HS256 dev setup.")

sub = sys.argv[1] if len(sys.argv) > 1 else "dev|local-user"
name = sys.argv[2] if len(sys.argv) > 2 else "Local Dev"
hours = float(os.environ.get("DEV_TOKEN_HOURS", "12"))
now = int(time.time())
claims = {"sub": sub, "name": name, "iat": now, "exp": now + int(hours * 3600)}
if config.jwt.audience:
    claims["aud"] = config.jwt.audience
if config.jwt.issuer:
    claims["iss"] = config.jwt.issuer
print(jwt.encode(claims, config.jwt.secret, algorithm="HS256"))
