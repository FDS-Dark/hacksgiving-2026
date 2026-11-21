# Supabase Storage for Phantom's voice debriefs. Nothing is set up by hand:
# database/terraform creates a secret API key per environment and writes it to
# Vault at var.storage_secret_path ({supabase_url, secret_key, bucket}); this
# ExternalSecret copies it into the pods, and the API and worker create the
# private bucket on startup. The audio lives there only until it's
# transcribed.
#
# optional = true on the pods' env_from: until database/terraform has run for
# an environment the Secret is missing, the pods start anyway, and voice
# answers 503 "type it instead".

variable "storage_secret_path" {
  type        = string
  description = "Vault KV path (under secret/) written by database/terraform's vault_kv_secret_v2.storage."
  default     = "deployments/hacksgiving/storage"
}

locals {
  storage_secret_name = "${local.api_name}-storage"
  # Plain settings for the API and the worker; the key comes from Vault.
  storage_env = {
    APP__STORAGE__BACKEND       = "supabase"
    APP__STORAGE__CREATE_BUCKET = "true"
  }
}

resource "kubernetes_manifest" "hacksgiving_storage_es" {
  manifest = {
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = local.storage_secret_name
      namespace = local.namespace
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef  = { name = local.secret_store_name, kind = "SecretStore" }
      target = {
        name = local.storage_secret_name
        template = {
          engineVersion = "v2"
          data = {
            APP__STORAGE__SUPABASE_URL        = "{{ .supabase_url }}"
            APP__STORAGE__SUPABASE_SECRET_KEY = "{{ .secret_key }}"
            APP__STORAGE__BUCKET              = "{{ .bucket }}"
          }
        }
      }
      dataFrom = [{ extract = { key = var.storage_secret_path } }]
    }
  }
}
