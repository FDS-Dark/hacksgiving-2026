output "domain" {
  value = data.auth0_tenant.current.domain
}

output "mobile_client_id" {
  description = "Public client id (not a secret). EXPO_PUBLIC_AUTH0_CLIENT_ID."
  value       = auth0_client.mobile.client_id
}

output "api_identifier" {
  value = auth0_resource_server.api.identifier
}

output "mobile_dev_client_id" {
  description = "Public client id of Hacksgiving Mobile (dev), for Expo Go (not a secret)."
  value       = auth0_client.mobile_dev.client_id
}

# The Auth0 values for apps/mobile/.env.production (builds).
output "mobile_env" {
  value = <<-EOT
    EXPO_PUBLIC_AUTH0_DOMAIN=${data.auth0_tenant.current.domain}
    EXPO_PUBLIC_AUTH0_CLIENT_ID=${auth0_client.mobile.client_id}
    EXPO_PUBLIC_AUTH0_AUDIENCE=${auth0_resource_server.api.identifier}
  EOT
}

# Paste into apps/mobile/.env.local (Expo Go).
output "mobile_dev_env" {
  value = <<-EOT
    EXPO_PUBLIC_AUTH0_DOMAIN=${data.auth0_tenant.current.domain}
    EXPO_PUBLIC_AUTH0_CLIENT_ID=${auth0_client.mobile_dev.client_id}
    EXPO_PUBLIC_AUTH0_AUDIENCE=${auth0_resource_server.api.identifier}
  EOT
}

# Paste into api/.env (local). Production gets the same values through
# terraform/ var.auth0_domain and var.auth0_audience.
output "api_env" {
  value = <<-EOT
    APP__JWT__ALGORITHM=RS256
    APP__JWT__JWKS_URL=https://${data.auth0_tenant.current.domain}/.well-known/jwks.json
    APP__JWT__ISSUER=https://${data.auth0_tenant.current.domain}/
    APP__JWT__AUDIENCE=${auth0_resource_server.api.identifier}
  EOT
}

output "e2e_client_id" {
  description = "The smoke test's client id (not a secret). Vault secret/deployments/hacksgiving/e2e client_id."
  value       = auth0_client.e2e.client_id
}
