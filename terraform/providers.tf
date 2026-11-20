provider "kubernetes" {
  config_path = var.kubeconfig_path
}

# Token from CLOUDFLARE_API_TOKEN, read in CI from Vault
# secret/platform/cloudflare/ci (policy cloudflare-ci-read).
provider "cloudflare" {}
