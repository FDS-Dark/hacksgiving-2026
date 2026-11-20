from uuid import uuid4

from tests.helpers import auth_header


def _sub() -> str:
    return f"auth0|{uuid4().hex}"


async def test_first_request_provisions_the_user_once(api):
    headers = auth_header(_sub(), name="Casey")

    me = await api.get("/v1/me", headers=headers)
    again = await api.get("/v1/me", headers=headers)

    assert me.status_code == 200
    assert me.json()["display_name"] == "Casey"
    assert me.json()["timezone"] == "UTC"
    assert again.json()["id"] == me.json()["id"]


async def test_update_me(api):
    headers = auth_header(_sub())
    await api.get("/v1/me", headers=headers)

    body = {"display_name": " Robin ", "timezone": "America/Chicago"}
    updated = await api.patch("/v1/me", json=body, headers=headers)
    renamed_only = await api.patch("/v1/me", json={"display_name": "Rob"}, headers=headers)

    assert updated.status_code == 200
    assert (updated.json()["display_name"], updated.json()["timezone"]) == ("Robin", "America/Chicago")
    assert (renamed_only.json()["display_name"], renamed_only.json()["timezone"]) == ("Rob", "America/Chicago")


async def test_users_only_ever_see_themselves(api):
    a, b = _sub(), _sub()

    me_a = await api.get("/v1/me", headers=auth_header(a))
    me_b = await api.get("/v1/me", headers=auth_header(b))

    assert me_a.json()["id"] != me_b.json()["id"]
    assert (me_a.json()["auth0_sub"], me_b.json()["auth0_sub"]) == (a, b)
