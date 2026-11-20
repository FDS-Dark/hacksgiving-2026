import logging

from databridge.user import UserDatabridge
from models.user import AppUser, TokenClaims

logger = logging.getLogger(__name__)


def display_name(value: str | None) -> str | None:
    """A name fit to show other people, or None. Hacksgiving keeps no email
    addresses, and Auth0 makes a password user's `name` their email."""
    value = (value or "").strip()
    return value[:80] if value and "@" not in value else None


class UserService:
    """Maps a verified Auth0 subject to the internal app.users row,
    provisioning the user on first sight."""

    def __init__(self, users: UserDatabridge) -> None:
        self.users = users

    async def get_or_create(self, claims: TokenClaims) -> AppUser:
        if user := await self.users.get_by_sub(claims.sub):
            return user
        name = display_name(claims.name)
        if user := await self.users.provision(claims.sub, name):
            logger.info("Provisioned user %s", user.id)
            return user
        # Lost a first-login race: another request created the user after our
        # lookup, and provisioning created nothing. It's committed now.
        if user := await self.users.get_by_sub(claims.sub):
            return user
        raise RuntimeError("User vanished during provisioning")

    async def update(self, user: AppUser, name: str | None, timezone: str | None) -> AppUser:
        return await self.users.update(user.id, display_name(name), timezone)
