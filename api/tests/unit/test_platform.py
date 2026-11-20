"""The plumbing every request goes through: the stored-function executor and
the structured error contract."""

from collections.abc import Iterator
from enum import StrEnum

import pytest
from fastapi.testclient import TestClient

from databridge.executor import _bind, _statement
from dependencies import get_current_user
from main import app
from tests.helpers import auth_header


def test_a_call_names_every_argument():
    assert _statement("user_update", {"user_id": 1, "timezone": 2}) == (
        "SELECT * FROM app.user_update(p_user_id => :user_id, p_timezone => :timezone)"
    )


@pytest.mark.parametrize(
    ("function", "params"),
    [("users; DROP TABLE app.users", {}), ("user_update", {"id) --": 1}), ("Upper", {})],
)
def test_names_that_are_not_plain_identifiers_are_refused(function: str, params: dict):
    with pytest.raises(ValueError):
        _statement(function, params)


def test_enum_members_go_as_their_values():
    class Kind(StrEnum):
        member = "member"

    assert _bind(Kind.member) == "member" and type(_bind(Kind.member)) is str


@pytest.fixture
def broken_user() -> Iterator[TestClient]:
    async def boom() -> None:
        raise RuntimeError("database is on fire")

    app.dependency_overrides[get_current_user] = boom
    yield TestClient(app, raise_server_exceptions=False)
    app.dependency_overrides.clear()


def test_an_unexpected_error_keeps_the_contract(broken_user: TestClient):
    response = broken_user.get("/v1/me", headers={**auth_header(), "X-Request-ID": "req-500"})

    assert response.status_code == 500
    assert response.json() == {"code": "internal_error", "message": "Something went wrong", "request_id": "req-500"}
    assert response.headers["X-Request-ID"] == "req-500"
    assert "on fire" not in response.text
