variable "environment" {
  type        = string
  description = "\"production\" or \"staging\". Each has its own state; see environments/*.tfvars."
  default     = "production"
  validation {
    condition     = contains(["production", "staging"], var.environment)
    error_message = "environment must be \"production\" or \"staging\"."
  }
}

variable "kubeconfig_path" {
  type    = string
  default = "~/.kube/config"
}

variable "api_image" {
  type        = string
  description = "Full image ref for the api service, e.g. registry.gitlab.com/group/hacksgiving/api:abc1234"
}

variable "api_replicas" {
  type    = number
  default = 1
}

variable "api_hostname" {
  type    = string
  default = "hacksgiving-api.austinkoske.com"
}

variable "registry_username" {
  type      = string
  sensitive = true
  default   = ""
}

variable "registry_password" {
  type      = string
  sensitive = true
  default   = ""
}

variable "db_secret_path" {
  type        = string
  description = "Vault KV path (under secret/) for DB credentials: host, port, database, username, password. Written by database/terraform's vault_kv_secret_v2.runtime — keep both in sync."
  default     = "deployments/hacksgiving/db"
}

variable "app_secret_path" {
  type        = string
  description = "Vault KV path (under secret/) for app secrets: jwt_secret. Seed manually — see ../database/README.md and homelab/docs/DEPLOYMENT.md's 'First-Time Secrets Required in Vault'."
  default     = "deployments/hacksgiving/app"
}

# Auth0 access-token verification (see api/settings.py:JWTConfig and
# ../auth0/terraform, which manages the tenant). Not secrets. While
# auth0_domain is empty the API verifies HS256 tokens with jwt_secret from
# app_secret_path instead.
variable "auth0_domain" {
  type        = string
  description = "Auth0 tenant domain (auth0/terraform output domain). Empty falls back to HS256 with jwt_secret."
  # Cooli's tenant, which Hacksgiving shares (auth0/terraform).
  default = "dev-3wpn13zh30l6orpi.us.auth0.com"
}

variable "auth0_audience" {
  type        = string
  description = "Auth0 API identifier. Must match auth0/terraform var.api_identifier."
  default     = "https://api.hacksgiving.app"
}

variable "cors_origins" {
  type        = list(string)
  description = "Browser origins the API accepts cross-origin requests from. Empty in production."
  default     = []
}
