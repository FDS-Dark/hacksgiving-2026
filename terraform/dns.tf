# Public hostnames: proxied CNAMEs to the shared homelab Cloudflare tunnel.
# The tunnel's catch-all rule sends every hostname to Traefik, which routes
# by Host() (the IngressRoutes in main.tf), so no tunnel config change is
# needed. The zone's other records belong to austinkoske/personal/portfolio-com.

variable "cloudflare_zone_id" {
  type        = string
  description = "austinkoske.com"
  default     = "3b5d31fd3aac7e2b8d502e3744ea3f4d"
}

variable "cloudflare_tunnel_id" {
  type        = string
  description = "The shared homelab tunnel (edge/cloudflared)."
  default     = "2e4925f6-e91c-49ea-8b7d-95ae0c0be8c4"
}

resource "cloudflare_dns_record" "public" {
  for_each = merge(
    { api = var.api_hostname },
    var.web_image != "" ? { web = var.web_hostname } : {},
  )

  zone_id = var.cloudflare_zone_id
  name    = each.value
  type    = "CNAME"
  content = "${var.cloudflare_tunnel_id}.cfargotunnel.com"
  proxied = true
  ttl     = 1
  comment = "austinkoske/personal/hacksgiving-2026 terraform/dns.tf"
}
