# The background worker (api/worker, `python -m worker`): runs Phantom's
# pipeline from the job queue in Postgres (app.jobs). Same image as the API,
# its own Deployment so it scales and restarts on its own. It serves no
# traffic: no Service, no ingress. Several replicas are safe (jobs are
# claimed with SKIP LOCKED).
#
# Needs `openai_api_key` in the app secret in Vault (var.app_secret_path),
# beside jwt_secret. Until it's there, this ExternalSecret can't render and
# the worker doesn't start; the API is unaffected.

locals {
  worker_name = local.is_production ? "hacksgiving-worker" : "hacksgiving-worker-${var.environment}"
}

resource "kubernetes_manifest" "hacksgiving_openai_es" {
  manifest = {
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "${local.worker_name}-openai"
      namespace = local.namespace
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef  = { name = local.secret_store_name, kind = "SecretStore" }
      target = {
        name = "${local.worker_name}-openai"
        template = {
          engineVersion = "v2"
          data = {
            APP__OPENAI__API_KEY = "{{ .openai_api_key }}"
          }
        }
      }
      dataFrom = [{ extract = { key = var.app_secret_path } }]
    }
  }
}

resource "kubernetes_deployment" "hacksgiving_worker" {
  metadata {
    name      = local.worker_name
    namespace = local.namespace
  }
  # Don't hold the whole apply on the worker: it serves no traffic, and until
  # openai_api_key is in Vault its pod waits for the Secret. It starts on its
  # own once the key is there (External Secrets refreshes hourly).
  wait_for_rollout = false
  spec {
    replicas = var.worker_replicas
    selector { match_labels = { app = local.worker_name } }
    template {
      metadata { labels = { app = local.worker_name } }
      spec {
        image_pull_secrets { name = local.registry_secret_name }
        automount_service_account_token = false
        # SIGTERM stops claiming; running jobs get this long to finish. Longer
        # work is claimed again by another replica once its lease ends.
        termination_grace_period_seconds = 120

        security_context {
          run_as_non_root = true
          run_as_user     = 10001
          run_as_group    = 10001
          seccomp_profile { type = "RuntimeDefault" }
        }

        container {
          name    = local.worker_name
          image   = var.api_image
          command = ["python", "-m", "worker"]

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
          env_from {
            secret_ref { name = "${local.worker_name}-openai" }
          }
          env_from {
            secret_ref {
              name     = local.storage_secret_name
              optional = true
            }
          }
          dynamic "env" {
            for_each = merge(local.api_env, local.storage_env, {
              APP__WORKER__CONCURRENCY = tostring(var.worker_concurrency)
              APP__WORKER__HEALTH_PORT = "8081"
            })
            content {
              name  = env.key
              value = env.value
            }
          }
          # 503 once the poll loop has been stuck for two minutes.
          liveness_probe {
            http_get {
              path = "/"
              port = 8081
            }
            initial_delay_seconds = 15
            period_seconds        = 20
            failure_threshold     = 3
          }
          resources {
            requests = { cpu = "50m", memory = "192Mi" }
            limits   = { memory = "256Mi" }
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
  depends_on = [
    kubernetes_manifest.hacksgiving_db_es,
    kubernetes_manifest.hacksgiving_openai_es,
  ]
}
