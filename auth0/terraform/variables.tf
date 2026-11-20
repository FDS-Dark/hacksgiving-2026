variable "api_identifier" {
  type        = string
  description = "Auth0 API identifier, i.e. the access-token audience. The mobile app (EXPO_PUBLIC_AUTH0_AUDIENCE) and the API (APP__JWT__AUDIENCE, terraform/ var.auth0_audience) must use the same value. Changing it after users sign in invalidates their tokens."
  default     = "https://api.hacksgiving.app"
}

variable "native_callback_urls" {
  type        = list(string)
  description = "Redirect URIs for builds (expo-auth-session makeRedirectUri, path auth): hacksgiving for the production app, hacksgiving-staging for the staging app (apps/mobile/app.config.ts). Hacksgiving Mobile only."
  default     = ["hacksgiving://auth", "hacksgiving-staging://auth"]
}

variable "dev_callback_urls" {
  type        = list(string)
  description = "Expo Go redirect URIs, exp://<metro host>:8081/--/auth, for Hacksgiving Mobile (dev) only. The sign-in screen shows the exact value in dev."
  default     = ["exp://100.102.172.1:8081/--/auth"]
}

variable "name_claim" {
  type        = string
  description = "Namespaced access-token claim the post-login Action fills with the user's name. Must match the API's APP__JWT__NAME_CLAIM (default in api/settings.py)."
  default     = "https://hacksgiving.app/name"
}
