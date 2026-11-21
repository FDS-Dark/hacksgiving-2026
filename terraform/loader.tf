# ── Data loader ──────────────────────────────────────────────────────────
#
# CronJobs that keep imported opportunities, resources and public data current
# (api/loader, docs/data-loader.md). It runs the API's image and connects as
# the API's database role, through the same stored functions.

locals {
  loader_name = "${local.api_name}-loader"

  # Two jobs from one template: the nightly run, and the live sources
  # (dispatch calls, transit and weather alerts) every few minutes. MPD's
  # calls page allows 10 requests per 30 minutes per address, so keep the
  # live schedule at 5 minutes or slower.
  loader_jobs = {
    daily = {
      schedule = var.loader_schedule
      cadence  = "daily"
      # The GTFS feed's stop_times is tens of megabytes.
      memory   = "768Mi"
      deadline = 1800
    }
    # A live run also catches up any daily source that hasn't succeeded in
    # a day (api/loader/schedule.py), so a fresh deploy seeds itself within
    # minutes: it needs the daily job's memory and more time.
    live = {
      schedule = var.loader_live_schedule
      cadence  = "live"
      memory   = "768Mi"
      deadline = 600
    }
  }
}

# The sources' credentials, seeded by hand in Vault under
# var.loader_secret_path. Each Vault key is the environment variable itself
# (APP__LOADER__USAJOBS_API_KEY, APP__LOADER__USAJOBS_EMAIL,
# APP__LOADER__CAREERONESTOP_USER_ID, APP__LOADER__CAREERONESTOP_TOKEN), so
# any of them may be missing: the loader skips a source without credentials.
resource "kubernetes_manifest" "hacksgiving_loader_es" {
  manifest = {
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = local.loader_name
      namespace = local.namespace
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef  = { name = local.secret_store_name, kind = "SecretStore" }
      target          = { name = local.loader_name }
      dataFrom        = [{ extract = { key = var.loader_secret_path } }]
    }
  }
}

resource "kubernetes_cron_job_v1" "hacksgiving_loader" {
  for_each = local.loader_jobs

  metadata {
    name      = "${local.loader_name}-${each.key}"
    namespace = local.namespace
  }
  spec {
    schedule                      = each.value.schedule
    timezone                      = "America/Chicago"
    concurrency_policy            = "Forbid"
    successful_jobs_history_limit = 3
    failed_jobs_history_limit     = 3
    # A run that couldn't start in time waits for the next one.
    starting_deadline_seconds = each.value.deadline

    job_template {
      metadata {
        labels = { app = local.loader_name, cadence = each.key }
      }
      spec {
        # One retry: the sources are public sites that sometimes time out.
        backoff_limit              = each.key == "daily" ? 1 : 0
        active_deadline_seconds    = each.value.deadline
        ttl_seconds_after_finished = each.key == "daily" ? 86400 : 3600

        template {
          metadata {
            labels = { app = local.loader_name, cadence = each.key }
          }
          spec {
            restart_policy = "Never"
            image_pull_secrets { name = local.registry_secret_name }
            automount_service_account_token = false

            security_context {
              run_as_non_root = true
              run_as_user     = 10001
              run_as_group    = 10001
              seccomp_profile { type = "RuntimeDefault" }
            }

            container {
              name    = "loader"
              image   = var.api_image
              command = ["python", "-m", "loader", "--cadence", each.value.cadence]

              security_context {
                allow_privilege_escalation = false
                read_only_root_filesystem  = true
                capabilities { drop = ["ALL"] }
              }
              volume_mount {
                name       = "tmp"
                mount_path = "/tmp"
              }

              env_from {
                secret_ref { name = "${local.api_name}-db" }
              }
              # Optional: without it the keyless sources still run.
              env_from {
                secret_ref {
                  name     = local.loader_name
                  optional = true
                }
              }
              env {
                name  = "APP__ENVIRONMENT__NAME"
                value = var.environment
              }
              env {
                name  = "APP__LOGGING__FORMAT"
                value = "json"
              }
              resources {
                requests = { cpu = "100m", memory = "256Mi" }
                limits   = { memory = each.value.memory }
              }
            }

            volume {
              name = "tmp"
              empty_dir {
                medium     = "Memory"
                size_limit = "64Mi"
              }
            }
          }
        }
      }
    }
  }
  depends_on = [kubernetes_manifest.hacksgiving_db_es]
}
