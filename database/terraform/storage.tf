# Supabase Storage for Phantom's voice debriefs, with nothing set up by hand.
#
# Per environment: a secret API key the API and worker use with Supabase
# Storage's own API (sign one-time upload URLs, read, delete, list). It goes
# into the runtime secret at <vault_prefix>/db (main.tf, as storage_*) with
# the project URL and bucket name; CI's Vault role may write only that path
# and /db-migration. ../../terraform/storage.tf reads it into the pods.
#
# The bucket itself (private, audio only, size-capped) is created by the API
# and the worker on startup (APP__STORAGE__CREATE_BUCKET); the provider has no
# bucket resource, and creating it is safe to repeat.
#
# Secret keys bypass row level security, like the service_role key they
# replace; they never leave the server side (Vault -> k8s Secret -> pod env).

variable "storage_bucket" {
  type    = string
  default = "phantom-audio"
}

resource "supabase_apikey" "storage" {
  for_each    = var.environments
  project_ref = each.value.project_ref
  name        = "hacksgiving_storage"
  description = "API and worker (server only): Phantom audio in Supabase Storage. Managed by database/terraform."

  # The provider picks the type (read-only); make sure it's a secret key, the
  # kind Storage needs to manage a private bucket.
  lifecycle {
    postcondition {
      condition     = self.type == "secret"
      error_message = "supabase_apikey.storage must be a secret key (sb_secret_...)."
    }
  }
}
