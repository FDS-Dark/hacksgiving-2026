# The app as a website (apps/mobile/web.Dockerfile): a static Expo web export
# served by unprivileged nginx. Off unless web_image is set, which CI does for
# staging only (build-web-staging); production gets its own build, Auth0
# client and hostname when it's wanted.

locals {
  web_enabled = var.web_image != ""
  web_name    = local.is_production ? "hacksgiving-web" : "hacksgiving-web-${var.environment}"
}

resource "kubernetes_deployment" "hacksgiving_web" {
  count = local.web_enabled ? 1 : 0

  metadata {
    name      = local.web_name
    namespace = local.namespace
  }
  spec {
    replicas = 1
    selector { match_labels = { app = local.web_name } }
    template {
      metadata { labels = { app = local.web_name } }
      spec {
        image_pull_secrets { name = local.registry_secret_name }
        automount_service_account_token = false

        # nginx-unprivileged runs as uid 101 and listens on 8080.
        security_context {
          run_as_non_root = true
          run_as_user     = 101
          run_as_group    = 101
          seccomp_profile { type = "RuntimeDefault" }
        }

        container {
          name  = local.web_name
          image = var.web_image
          port { container_port = 8080 }

          security_context {
            allow_privilege_escalation = false
            read_only_root_filesystem  = true
            capabilities { drop = ["ALL"] }
          }
          # nginx writes its pid and temp files under /tmp.
          volume_mount {
            name       = "tmp"
            mount_path = "/tmp"
          }

          liveness_probe {
            http_get {
              path = "/healthz"
              port = 8080
            }
            period_seconds = 10
          }
          readiness_probe {
            http_get {
              path = "/healthz"
              port = 8080
            }
            period_seconds    = 5
            failure_threshold = 2
          }
          resources {
            requests = { cpu = "10m", memory = "32Mi" }
            limits   = { memory = "64Mi" }
          }
        }

        volume {
          name = "tmp"
          empty_dir {
            medium     = "Memory"
            size_limit = "16Mi"
          }
        }
      }
    }
  }
}

resource "kubernetes_service" "hacksgiving_web" {
  count = local.web_enabled ? 1 : 0

  metadata {
    name      = local.web_name
    namespace = local.namespace
  }
  spec {
    selector = { app = local.web_name }
    port {
      name        = "http"
      port        = 8080
      target_port = 8080
    }
  }
}

resource "kubernetes_manifest" "hacksgiving_web_cert" {
  count = local.web_enabled ? 1 : 0

  manifest = {
    apiVersion = "cert-manager.io/v1"
    kind       = "Certificate"
    metadata   = { name = "${local.web_name}-tls", namespace = local.namespace }
    spec = {
      secretName = "${local.web_name}-tls"
      dnsNames   = [var.web_hostname]
      issuerRef  = { name = "letsencrypt-prod", kind = "ClusterIssuer", group = "cert-manager.io" }
    }
  }
}

resource "kubernetes_manifest" "hacksgiving_web_ingressroute" {
  count = local.web_enabled ? 1 : 0

  manifest = {
    apiVersion = "traefik.io/v1alpha1"
    kind       = "IngressRoute"
    metadata   = { name = local.web_name, namespace = local.namespace }
    spec = {
      entryPoints = ["websecure"]
      routes = [{
        match    = "Host(`${var.web_hostname}`)"
        kind     = "Rule"
        services = [{ name = local.web_name, port = 8080 }]
      }]
      tls = { secretName = "${local.web_name}-tls" }
    }
  }
  depends_on = [kubernetes_manifest.hacksgiving_web_cert, kubernetes_service.hacksgiving_web]
}
