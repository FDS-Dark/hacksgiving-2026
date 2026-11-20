# Auth0 tenant

OpenTofu for Hacksgiving's own Auth0 tenant (create it by hand first, then
bootstrap below):

- The tenant's display name, **Hacksgiving**, shown on the Universal Login pages.

- **Hacksgiving API** (resource server). RS256, offline access, identifier
  `https://api.hacksgiving.app`.
- **Hacksgiving Mobile** (Native app), for builds. Auth code + PKCE, no client
  secret, rotating refresh tokens. Callback `hacksgiving://auth` only.
- **Hacksgiving Mobile (dev)**, the same for Expo Go, whose `exp://` callbacks
  point at a developer's machine. Kept apart so no build accepts them.
- The `Username-Password-Authentication` connection, enabled for the app.
- **Hacksgiving E2E**, a machine-to-machine app the post-deploy smoke test signs
  in with (client credentials, Hacksgiving API audience only).
- A post-login **Action** that puts the user's name in the access token
  (`https://hacksgiving.app/name`), so the API knows it on the first request.
  It never uses the email address: Hacksgiving stores none.

The k8s deploy (`terraform/`) has its own state. This root uses the
GitLab-managed state `hacksgiving-auth0`, so tenant changes don't need the
cluster.

## How it runs

Only in CI. `auth0-plan` runs on `main` when files here change, and on any
other branch while it differs from `main` here. `auth0-apply` is a manual
job on the same branches. Both sign in to Auth0 as the **Hacksgiving
Terraform** Machine-to-Machine app. They read its credentials from Vault
`secret/deployments/hacksgiving/auth0-terraform` (`domain`, `client_id`,
`client_secret`) as `gitlab-hacksgiving-ci`. If that role can't read the path, the
job says so. Grant the read in `infra/vault-config`, not here.

The provider asks for one Management API token per job.

### Bootstrap (done once, with the Auth0 CLI)

```bash
auth0 apps create --name "Hacksgiving Terraform" --type m2m
auth0 client-grants create --client-id <id> \
  --audience "https://<tenant>/api/v2/" \
  --scopes "read:clients,create:clients,update:clients,delete:clients,read:client_keys,read:resource_servers,create:resource_servers,update:resource_servers,delete:resource_servers,read:connections,update:connections,read:actions,create:actions,update:actions,delete:actions,read:tenant_settings,update:tenant_settings,read:client_grants,create:client_grants,update:client_grants,delete:client_grants"
vault kv put secret/deployments/hacksgiving/auth0-terraform domain=<tenant> client_id=<id> \
  client_secret="$(auth0 apps show <id> --reveal-secrets --json | jq -r .client_secret)"
```

Everything else in the tenant (the API, the mobile app, the Action, the
display name) is created by this root. Auth0's own Default App and the
default Google connection are left alone; the mobile app only enables
email + password.

## Feeding the values to the app and API

None of these values are secret.

```bash
tofu output -raw mobile_dev_env  # → apps/mobile/.env.local (Expo Go), then restart Expo
tofu output -raw mobile_env      # → apps/mobile/.env.production (builds)
tofu output -raw api_env      # → api/.env, then restart uvicorn
tofu output -raw domain       # → terraform/variables.tf var.auth0_domain default (production API)
```

Once the local API uses RS256, the dev token from `api/scripts/dev_token.py`
stops working. To go back to it, set `APP__JWT__ALGORITHM=HS256` and clear
`APP__JWT__JWKS_URL`.

## Changing things

- **New Metro host or IP:** override `dev_callback_urls` (the dev client
  only). The sign-in screen shows the exact URL in dev.
- **Google or Apple sign-in:** add an `auth0_connection` plus an
  `auth0_connection_client` for `auth0_client.mobile` and
  `auth0_client.mobile_dev`.
- **`api_identifier`:** keep it in sync with `terraform/` var.auth0_audience
  and `EXPO_PUBLIC_AUTH0_AUDIENCE`. Changing it signs everyone out.

## E2E smoke test identity

After `auth0-apply` creates **Hacksgiving E2E**, copy its credentials into Vault
once (the secret never goes through CI logs or state outputs):

```bash
id=$(tofu output -raw e2e_client_id)
auth0 apps show "$id" --reveal-secrets --json | jq '{domain: "<tenant>", client_id, client_secret, audience: "https://api.hacksgiving.app"}'   | vault kv put secret/deployments/hacksgiving/e2e -
```

`gitlab-hacksgiving-ci` may read that path (`ci_read` in infra/vault-config).
