data "auth0_tenant" "current" {}

# The name Universal Login shows ("Sign up to Hacksgiving to continue"). The
# tenant is Hacksgiving's own, so this root may own its settings.
resource "auth0_tenant" "tenant" {
  friendly_name = var.tenant_name
}

# ── API (resource server) ────────────────────────────────────────────────
# The FastAPI service verifies RS256 access tokens for this audience against
# the tenant's JWKS. Refresh tokens (offline_access) keep people signed in.
resource "auth0_resource_server" "api" {
  name        = "Hacksgiving API"
  identifier  = var.api_identifier
  signing_alg = "RS256"

  allow_offline_access                            = true
  skip_consent_for_verifiable_first_party_clients = true
  token_lifetime                                  = 86400
  token_dialect                                   = "access_token"
}

# ── Mobile app (Native, public client, PKCE) ─────────────────────────────
resource "auth0_client" "mobile" {
  name            = "Hacksgiving Mobile"
  description     = "Hacksgiving iOS/Android app (Expo). Universal Login in the system browser, auth code + PKCE."
  app_type        = "native"
  is_first_party  = true
  oidc_conformant = true

  # Builds only. Expo Go's exp:// callbacks belong to Hacksgiving Mobile (dev).
  callbacks   = var.native_callback_urls
  grant_types = ["authorization_code", "refresh_token"]

  jwt_configuration {
    alg = "RS256"
  }

  # Rotating refresh tokens: each refresh returns a new one and the old one
  # stops working after the leeway. 30-day absolute, 15-day idle lifetime.
  refresh_token {
    rotation_type                = "rotating"
    expiration_type              = "expiring"
    leeway                       = 60
    token_lifetime               = 2592000
    infinite_token_lifetime      = false
    idle_token_lifetime          = 1296000
    infinite_idle_token_lifetime = false
  }
}

# Public client: no secret, the app proves possession with PKCE.
resource "auth0_client_credentials" "mobile" {
  client_id             = auth0_client.mobile.client_id
  authentication_method = "none"
}

# ── Mobile app in development (Expo Go) ──────────────────────────────────
# A separate client for Expo Go, whose callback is an exp:// URL on a
# developer's LAN or Tailscale address. Keeping those URLs off the
# production client means no build ever accepts a redirect to a developer
# machine. Same settings otherwise; .env.local uses this client's id
# (output mobile_dev_env).
resource "auth0_client" "mobile_dev" {
  name            = "Hacksgiving Mobile (dev)"
  description     = "Hacksgiving in Expo Go during development. Universal Login in the system browser, auth code + PKCE."
  app_type        = "native"
  is_first_party  = true
  oidc_conformant = true

  callbacks   = var.dev_callback_urls
  grant_types = ["authorization_code", "refresh_token"]

  jwt_configuration {
    alg = "RS256"
  }

  refresh_token {
    rotation_type                = "rotating"
    expiration_type              = "expiring"
    leeway                       = 60
    token_lifetime               = 2592000
    infinite_token_lifetime      = false
    idle_token_lifetime          = 1296000
    infinite_idle_token_lifetime = false
  }
}

resource "auth0_client_credentials" "mobile_dev" {
  client_id             = auth0_client.mobile_dev.client_id
  authentication_method = "none"
}

# Email + password sign-up and sign-in. Add social connections (Google,
# Apple) the same way when wanted.
data "auth0_connection" "database" {
  name = "Username-Password-Authentication"
}

resource "auth0_connection_client" "mobile_database" {
  connection_id = data.auth0_connection.database.id
  client_id     = auth0_client.mobile.client_id
}

resource "auth0_connection_client" "mobile_dev_database" {
  connection_id = data.auth0_connection.database.id
  client_id     = auth0_client.mobile_dev.client_id
}

# ── Post-login Action: name in the access token ──────────────────────────
# The API creates users on first request and needs a display name before the
# app's PATCH /me runs. Access tokens carry no profile claims by default.
resource "auth0_action" "name_claim" {
  name    = "hacksgiving-access-token-name"
  runtime = "node22"
  deploy  = true
  code    = <<-JS
    exports.onExecutePostLogin = async (event, api) => {
      // Hacksgiving keeps no email addresses, and Auth0 sets a password user's
      // name to their email. Skip anything that looks like one.
      const name = [event.user.name, event.user.nickname].find((n) => n && !n.includes("@"));
      if (name) api.accessToken.setCustomClaim(${jsonencode(var.name_claim)}, name);
    };
  JS

  supported_triggers {
    id      = "post-login"
    version = "v3"
  }
}

# Adds this one binding; leaves other post-login Actions in the tenant alone.
resource "auth0_trigger_action" "name_claim" {
  trigger   = "post-login"
  action_id = auth0_action.name_claim.id
}

# ── E2E test identity (machine-to-machine) ───────────────────────────────
# The post-deploy smoke test (api/tests/smoke) signs in to the Hacksgiving API as
# this app with the client-credentials grant. To the API it's an ordinary
# user, "<client id>@clients". Its secret is copied
# by hand into Vault secret/deployments/hacksgiving/e2e (README.md).
resource "auth0_client" "e2e" {
  name           = "Hacksgiving E2E"
  description    = "Post-deploy smoke test identity for the Hacksgiving API (hacksgiving-2026 CI). No user login."
  app_type       = "non_interactive"
  is_first_party = true
  grant_types    = ["client_credentials"]

  jwt_configuration {
    alg = "RS256"
  }
}

resource "auth0_client_credentials" "e2e" {
  client_id             = auth0_client.e2e.client_id
  authentication_method = "client_secret_post"
}

# Access tokens for the Hacksgiving API only. The API has no scopes; the token's
# audience is what grants access.
resource "auth0_client_grant" "e2e" {
  client_id = auth0_client.e2e.client_id
  audience  = auth0_resource_server.api.identifier
  scopes    = []
}
