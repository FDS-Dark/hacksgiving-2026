"""What a deploy must not break. Each test names the layer it proves; a
failure points there. See conftest.py for how these run."""


async def test_the_api_is_up_behind_the_tunnel(api):
    """Cloudflare tunnel -> Traefik -> pod, and the /v1 prefix."""
    response = await api.get("/health")
    assert (response.status_code, response.json()) == (200, {"status": "healthy"})


async def test_auth0_tokens_are_accepted(api):
    """JWKS, issuer and audience match the tenant; the user is provisioned."""
    response = await api.get("/me")
    assert response.status_code == 200, response.text
    assert response.json()["auth0_sub"].endswith("@clients")
