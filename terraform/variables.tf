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

variable "dataloader_image" {
  type        = string
  description = "Full image ref for the data loader (dataloader/Dockerfile), e.g. registry.gitlab.com/group/hacksgiving/dataloader:abc1234"
}

variable "api_replicas" {
  type    = number
  default = 1
}

variable "api_hostname" {
  type    = string
  default = "hacksgiving-api.austinkoske.com"
}

variable "web_image" {
  type        = string
  description = "Full image ref for the website (apps/mobile/web.Dockerfile). Empty turns the website off (web.tf)."
  default     = ""
}

variable "web_hostname" {
  type        = string
  description = "Public hostname for the website. Must be listed in auth0/terraform dev_web_origins (as https://<host>) and in cors_origins."
  default     = "hacksgiving.austinkoske.com"
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
  description = "Browser origins the API accepts cross-origin requests from: the website and, on staging, the Expo web dev server."
  default     = []
}

variable "worker_replicas" {
  type        = number
  default     = 1
  description = "Background worker pods (api/worker). Safe to raise: jobs are claimed with SKIP LOCKED."
}

variable "worker_concurrency" {
  type        = number
  default     = 4
  description = "Jobs each worker pod runs at once."
}

# The data loader (loader.tf, docs/data-loader.md).
variable "loader_schedule" {
  type        = string
  description = "Cron schedule for the data loader, in America/Chicago time."
  default     = "30 3 * * *"
}

variable "loader_live_schedule" {
  type        = string
  description = "Cron schedule for the loader's live sources (dispatch calls, alerts), in America/Chicago time."
  default     = "*/5 * * * *"
}

variable "loader_mpd_min_interval_seconds" {
  type        = number
  description = "Least seconds between two requests to MPD's calls page from this environment. MPD allows 10 per 30 minutes per IP, shared by production (300), staging (3600) and local dev (900)."
  default     = 300

  validation {
    condition     = var.loader_mpd_min_interval_seconds >= 300
    error_message = "MPD allows 10 requests per 30 minutes per IP, shared across environments: ask at most every 300 seconds."
  }
}

variable "loader_secret_path" {
  type        = string
  description = "Vault KV path (under secret/) for the loader's source credentials, keyed by environment variable name (APP__LOADER__*). Optional: seed it by hand when you have keys."
  default     = "deployments/hacksgiving/loader"
}
