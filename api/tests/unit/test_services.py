"""Service rules against in-memory stored functions (tests/unit/fakes.py).
What reaches the database is covered by tests/integration."""

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import pytest

from databridge.user import UserDatabridge
from models.user import AppUser, TokenClaims
from services.user import UserService, display_name
from tests.unit.fakes import FakeFunctions

NOW = datetime.now(timezone.utc)


def user_row(sub: str = "auth0|user-a", name: str | None = None) -> dict[str, Any]:
    return {"id": uuid4(), "auth0_sub": sub, "display_name": name, "timezone": "UTC", "created_at": NOW}


# --- User ------------------------------------------------------------------------


async def test_an_existing_user_is_not_provisioned_again():
    db = FakeFunctions(user_get_by_sub=[user_row()])

    user = await UserService(UserDatabridge(db)).get_or_create(TokenClaims(sub="auth0|user-a"))

    assert user.auth0_sub == "auth0|user-a"
    assert db.called("user_provision") == []


async def test_a_new_user_is_provisioned_with_their_name():
    created = user_row(name="Casey Jones")
    db = FakeFunctions(user_get_by_sub=[], user_provision=[created])

    user = await UserService(UserDatabridge(db)).get_or_create(TokenClaims(sub="auth0|user-a", name="Casey Jones"))

    assert user.id == created["id"]
    assert db.called("user_provision") == [{"sub": "auth0|user-a", "display_name": "Casey Jones"}]


async def test_losing_a_first_login_race_returns_the_winner():
    winner = user_row()
    lookups = iter([[], [winner]])
    db = FakeFunctions(user_get_by_sub=lambda _: next(lookups), user_provision=[])

    user = await UserService(UserDatabridge(db)).get_or_create(TokenClaims(sub="auth0|user-a"))

    assert user.id == winner["id"]


@pytest.mark.parametrize(
    ("given", "kept"),
    [("Casey", "Casey"), ("  Casey  ", "Casey"), ("casey@example.com", None), ("", None), (None, None)],
)
def test_email_addresses_are_never_kept_as_names(given, kept):
    assert display_name(given) == kept


async def test_an_email_from_auth0_names_nobody():
    db = FakeFunctions(user_get_by_sub=[], user_provision=[user_row()])

    await UserService(UserDatabridge(db)).get_or_create(TokenClaims(sub="auth0|user-a", name="a@b.co"))

    assert db.called("user_provision")[0]["display_name"] is None


async def test_update_keeps_names_free_of_email_addresses(sample_user: AppUser):
    db = FakeFunctions(user_update=[user_row()])

    await UserService(UserDatabridge(db)).update(sample_user, "a@b.co", "Europe/Berlin")

    assert db.called("user_update") == [{"user_id": sample_user.id, "display_name": None, "timezone": "Europe/Berlin"}]
