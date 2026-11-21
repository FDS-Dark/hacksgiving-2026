# Production and staging are two states of this root (TF_STATE_NAME
# hacksgiving-k8s-prod / hacksgiving-k8s-staging) in the one hacksgiving namespace, because
# infra/vault-config gives a project one namespace and one ci-deployer.
# Staging's objects carry a -staging suffix. The namespace-wide objects (the
# vault-secrets service account, the SecretStore and the registry pull
# secret) belong to the production state; staging uses them by name.
locals {
  namespace     = "hacksgiving"
  is_production = var.environment == "production"
  api_name      = local.is_production ? "hacksgiving-api" : "hacksgiving-api-${var.environment}"

  # eso-hacksgiving is bound to the service account name vault-secrets.
  secret_store_name    = "vault"
  registry_secret_name = "gitlab-registry"
}

# The namespace, and the ci-deployer account CI deploys with, are created by
# infra/vault-config (vault-app-projects.tf). CI can only touch this namespace.

# Project-scoped secret store. It authenticates as Vault Kubernetes role
# eso-<namespace> (infra/vault-config/vault-app-projects.tf), which can read only
# secret/deployments/<namespace>/*. Don't use the shared ClusterSecretStore: it
# can read every platform secret.
resource "kubernetes_service_account" "vault_secrets" {
  count = local.is_production ? 1 : 0

  metadata {
    name      = "vault-secrets"
    namespace = local.namespace
  }
  automount_service_account_token = false
}

resource "kubernetes_manifest" "vault_secret_store" {
  count = local.is_production ? 1 : 0

  manifest = {
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "SecretStore"
    metadata   = { name = local.secret_store_name, namespace = local.namespace }
    spec = {
      provider = {
        vault = {
          server  = "http://10.10.20.11:8200"
          path    = "secret"
          version = "v2"
          auth = {
            kubernetes = {
              mountPath         = "kubernetes"
              role              = "eso-${local.namespace}"
              serviceAccountRef = { name = kubernetes_service_account.vault_secrets[0].metadata[0].name }
            }
          }
        }
      }
    }
  }
}

resource "kubernetes_secret" "registry" {
  count = local.is_production ? 1 : 0

  metadata {
    name      = local.registry_secret_name
    namespace = local.namespace
  }
  type = "kubernetes.io/dockerconfigjson"
  data = {
    ".dockerconfigjson" = jsonencode({
      auths = {
        "registry.gitlab.com" = {
          username = var.registry_username
          password = var.registry_password
          auth     = base64encode("${var.registry_username}:${var.registry_password}")
        }
      }
    })
  }
}

# Pulls the DB credentials database/terraform published into env var names
# settings.py:AppConfig already expects (APP__DATABASE__*).
resource "kubernetes_manifest" "hacksgiving_db_es" {
  manifest = {
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "${local.api_name}-db"
      namespace = local.namespace
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef  = { name = local.secret_store_name, kind = "SecretStore" }
      target = {
        name = "${local.api_name}-db"
        template = {
          engineVersion = "v2"
          data = {
            APP__DATABASE__HOST     = "{{ .host }}"
            APP__DATABASE__PORT     = "{{ .port }}"
            APP__DATABASE__NAME     = "{{ .database }}"
            APP__DATABASE__USERNAME = "{{ .username }}"
            APP__DATABASE__PASSWORD = "{{ .password }}"
            # Supabase transaction pooler (6543): TLS, and no prepared statements
            # because each transaction may land on a different server connection.
            APP__DATABASE__SSL                 = "require"
            APP__DATABASE__PREPARED_STATEMENTS = "false"
          }
        }
      }
      dataFrom = [{ extract = { key = var.db_secret_path } }]
    }
  }
}

# Seed manually with jwt_secret plus independent voice secrets. The JWT value
# is unused once auth0_domain is set, but all keys must still exist so External
# Secrets can render the deployment Secret.
resource "kubernetes_manifest" "hacksgiving_jwt_es" {
  manifest = {
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ExternalSecret"
    metadata = {
      name      = "${local.api_name}-jwt"
      namespace = local.namespace
    }
    spec = {
      refreshInterval = "1h"
      secretStoreRef  = { name = local.secret_store_name, kind = "SecretStore" }
      target = {
        name = "${local.api_name}-jwt"
        template = {
          engineVersion = "v2"
          data = {
            APP__JWT__SECRET                      = "{{ .jwt_secret }}"
            APP__VOICE__ELEVENLABS_WEBHOOK_SECRET = "{{ .elevenlabs_webhook_secret }}"
            APP__VOICE__TOOL_SECRET               = "{{ .voice_tool_secret }}"
          }
        }
      }
      dataFrom = [{ extract = { key = var.app_secret_path } }]
    }
  }
}

locals {
  # Plain (non-secret) API settings.
  api_env = merge(
    {
      APP__ENVIRONMENT__NAME = var.environment
      APP__LOGGING__FORMAT   = "json"
      # Browser origins allowed to call the API (var.cors_origins): none in
      # production (the clients are native); staging allows the Expo web
      # dev server, for the worker portal on a laptop.
      APP__CORS_ORIGINS = jsonencode(var.cors_origins)
      # The API scrapes MPD's 911-call page itself (services/mpd_scheduler.py).
      # The city allows 10 requests per 30 minutes per IP and both environments
      # leave the cluster from the same address: 6 + 3 per 30 minutes.
      APP__MPD_INGEST__INTERVAL_SECONDS = local.is_production ? "300" : "600"
    },
    var.auth0_domain == "" ? {} : {
      APP__JWT__ALGORITHM = "RS256"
      APP__JWT__JWKS_URL  = "https://${var.auth0_domain}/.well-known/jwks.json"
      APP__JWT__ISSUER    = "https://${var.auth0_domain}/"
      APP__JWT__AUDIENCE  = var.auth0_audience
    },
  )
}

# ── API ──────────────────────────────────────────────────────────────────

resource "kubernetes_deployment" "hacksgiving_api" {
  metadata {
    name      = local.api_name
    namespace = local.namespace
  }
  spec {
    replicas = var.api_replicas
    selector { match_labels = { app = local.api_name } }
    template {
      metadata { labels = { app = local.api_name } }
      spec {
        image_pull_secrets { name = local.registry_secret_name }
        # The API needs no Kubernetes API access.
        automount_service_account_token = false

        # The image runs as uid 10001 (api/Dockerfile).
        security_context {
          run_as_non_root = true
          run_as_user     = 10001
          run_as_group    = 10001
          seccomp_profile { type = "RuntimeDefault" }
        }

        container {
          name  = local.api_name
          image = var.api_image
          port { container_port = 8443 }

          security_context {
            allow_privilege_escalation = false
            read_only_root_filesystem  = true
            capabilities { drop = ["ALL"] }
          }
          # Scratch space for libraries that write temp files; the root
          # filesystem is read-only.
          volume_mount {
            name       = "tmp"
            mount_path = "/tmp"
          }

          env_from {
            secret_ref { name = "${local.api_name}-db" }
          }
          env_from {
            secret_ref { name = "${local.api_name}-jwt" }
          }
          dynamic "env" {
            for_each = local.api_env
            content {
              name  = env.key
              value = env.value
            }
          }
          liveness_probe {
            http_get {
              path = "/health"
              port = 8443
            }
            initial_delay_seconds = 10
            period_seconds        = 10
          }
          # No traffic until the app is serving, so a rollout never routes to
          # a pod that is still starting.
          readiness_probe {
            http_get {
              path = "/health"
              port = 8443
            }
            period_seconds    = 5
            failure_threshold = 2
          }
          resources {
            requests = { cpu = "100m", memory = "256Mi" }
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
  # Every Secret the pod reads through env_from must exist first.
  depends_on = [
    kubernetes_manifest.hacksgiving_db_es,
    kubernetes_manifest.hacksgiving_jwt_es,
  ]
}

resource "kubernetes_service" "hacksgiving_api" {
  metadata {
    name      = local.api_name
    namespace = local.namespace
  }
  spec {
    selector = { app = local.api_name }
    port {
      name        = "http"
      port        = 8443
      target_port = 8443
    }
  }
}

resource "kubernetes_manifest" "hacksgiving_api_cert" {
  manifest = {
    apiVersion = "cert-manager.io/v1"
    kind       = "Certificate"
    metadata   = { name = "${local.api_name}-tls", namespace = local.namespace }
    spec = {
      secretName = "${local.api_name}-tls"
      dnsNames   = [var.api_hostname]
      issuerRef  = { name = "letsencrypt-prod", kind = "ClusterIssuer", group = "cert-manager.io" }
    }
  }
}

resource "kubernetes_manifest" "hacksgiving_api_ingressroute" {
  manifest = {
    apiVersion = "traefik.io/v1alpha1"
    kind       = "IngressRoute"
    metadata   = { name = local.api_name, namespace = local.namespace }
    spec = {
      entryPoints = ["websecure"]
      routes = [{
        match    = "Host(`${var.api_hostname}`)"
        kind     = "Rule"
        services = [{ name = local.api_name, port = 8443 }]
      }]
      tls = { secretName = "${local.api_name}-tls" }
    }
  }
  depends_on = [kubernetes_manifest.hacksgiving_api_cert, kubernetes_service.hacksgiving_api]
}
