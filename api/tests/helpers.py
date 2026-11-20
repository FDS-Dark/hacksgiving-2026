import time

import jwt

from settings import config


def make_token(sub: str = "auth0|user-a", **claims) -> str:
    """An HS256 access token signed with the dev secret (no JWKS configured)."""
    now = int(time.time())
    payload = {"sub": sub, "iat": now, "exp": now + 300, **claims}
    return jwt.encode(payload, config.jwt.secret, algorithm="HS256")


def auth_header(sub: str = "auth0|user-a", **claims) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(sub, **claims)}"}
