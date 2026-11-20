# Supabase-hosted Postgres for hacksgiving: one project per
# environment. Schema and the app role are Alembic's job
# (../migrations); this root enforces SSL and writes the connection secrets
# that the migrate job and the API's ExternalSecret read.
#
#   <vault_prefix>/db-migration  session pooler (5432) as postgres, plus the
#                                app role's name and password for Alembic
#   <vault_prefix>/db            transaction pooler (6543) as the app role

data "vault_kv_secret_v2" "admin" {
  for_each = var.environments
  mount    = "secret"
  name     = "${each.value.vault_prefix}/supabase-admin"
}

data "supabase_pooler" "this" {
  for_each    = var.environments
  project_ref = each.value.project_ref
}

resource "supabase_settings" "this" {
  for_each        = var.environments
  project_ref     = each.value.project_ref
  ssl_enforcement = true

  # Data API off: no schemas exposed, so none of the auto-generated REST
  # endpoints answer. The app reaches the database only through FastAPI.
  # (Same value the Supabase CLI sends for [api] enabled = false.)
  api = jsonencode({
    db_schema            = ""
    db_extra_search_path = ""
    max_rows             = 1000
  })
}

# Alphanumeric so it survives URL and connection-string handling unescaped.
resource "random_password" "app" {
  for_each = var.environments
  length   = 32
  special  = false
  lifecycle { prevent_destroy = true }
}

locals {
  # Supavisor serves session mode on 5432 and transaction mode on 6543 on the
  # same regional host, and expects user names as <role>.<project_ref>.
  pooler_host = {
    for env, p in data.supabase_pooler.this :
    env => regex("@([^:/@]+)", values(p.url)[0])[0]
  }
}

resource "vault_kv_secret_v2" "migration" {
  for_each            = var.environments
  mount               = "secret"
  name                = "${each.value.vault_prefix}/db-migration"
  delete_all_versions = false
  data_json = jsonencode({
    host         = local.pooler_host[each.key]
    port         = "5432"
    database     = var.database_name
    username     = "postgres.${each.value.project_ref}"
    password     = data.vault_kv_secret_v2.admin[each.key].data["password"]
    sslmode      = "require"
    app_username = var.app_role
    app_password = random_password.app[each.key].result
  })
}

resource "vault_kv_secret_v2" "runtime" {
  for_each            = var.environments
  mount               = "secret"
  name                = "${each.value.vault_prefix}/db"
  delete_all_versions = false
  data_json = jsonencode({
    host     = local.pooler_host[each.key]
    port     = "6543"
    database = var.database_name
    username = "${var.app_role}.${each.value.project_ref}"
    password = random_password.app[each.key].result
  })
}
