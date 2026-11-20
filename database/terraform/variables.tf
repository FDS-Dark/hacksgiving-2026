variable "vault_addr" {
  type    = string
  default = "http://10.10.20.11:8200"
}

# One entry per Supabase project. The projects themselves are created by hand
# (their admin passwords are in Vault at <vault_prefix>/supabase-admin); this
# root only configures them and publishes connection secrets. Both are in the
# "Milwaukee School of Engineering" org (created 2026-11-19).
variable "environments" {
  type = map(object({
    project_ref  = string
    vault_prefix = string
  }))
  default = {
    production = {
      project_ref  = "hdxumncrbngpwaedmonr"
      vault_prefix = "deployments/hacksgiving"
    }
    staging = {
      project_ref  = "lkclzkolfiegzhejsagd"
      vault_prefix = "deployments/hacksgiving/staging"
    }
  }
}

variable "database_name" {
  type    = string
  default = "postgres"
}

variable "app_role" {
  type        = string
  description = "The API's least-privileged role. Alembic revision 0002 creates it (HACKSGIVING_APP_ROLE)."
  default     = "hacksgiving"
}
