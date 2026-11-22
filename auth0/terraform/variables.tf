variable "api_identifier" {
  type        = string
  description = "Auth0 API identifier, i.e. the access-token audience. The mobile app (EXPO_PUBLIC_AUTH0_AUDIENCE) and the API (APP__JWT__AUDIENCE, terraform/ var.auth0_audience) must use the same value. Changing it after users sign in invalidates their tokens."
  default     = "https://api.hacksgiving.app"
}

variable "native_callback_urls" {
  type        = list(string)
  description = "Redirect URIs for builds (expo-auth-session makeRedirectUri, path auth): hacksgiving for the production app, hacksgiving-staging for the staging app (apps/mobile/app.config.ts). The build client (auth0_client.mobile) only."
  default     = ["hacksgiving://auth", "hacksgiving-staging://auth"]
}

variable "dev_callback_urls" {
  type        = list(string)
  description = "Expo Go redirect URIs, exp://<metro host>:8081/--/auth, for the dev client (auth0_client.mobile_dev) only. The sign-in screen shows the exact value in dev."
  # One per teammate's Tailscale address. Auth0 has no wildcard for IPs.
  default = [
    "exp://100.102.172.1:8081/--/auth",
    "exp://100.107.6.4:8081/--/auth",
    "exp://100.70.127.16:8081/--/auth",
    "exp://100.120.66.97:8081/--/auth",
  ]
}

variable "dev_web_origins" {
  type        = list(string)
  description = "Origins the Expo web build runs on in development (npx expo start --web). Each gets <origin>/auth as a callback on the dev client (auth0_client.mobile_dev), and is allowed to call Auth0's token endpoint from the browser."
  # Plus the staging website (terraform/web.tf), which uses this client too:
  # it's a dev/staging surface, and production builds keep their own client.
  default = ["http://localhost:8081", "https://hacksgiving-staging.austinkoske.com"]
}

variable "name_claim" {
  type        = string
  description = "Namespaced access-token claim the post-login Action fills with the user's name. Must match the API's APP__JWT__NAME_CLAIM (default in api/settings.py)."
  default     = "https://hacksgiving.app/name"
}
