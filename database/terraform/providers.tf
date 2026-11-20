# Token from SUPABASE_ACCESS_TOKEN: a scoped personal access token stored in
# Vault at deployments/hacksgiving/supabase-terraform (see ../README.md).
provider "supabase" {}

# Token from VAULT_TOKEN (CI logs in as gitlab-hacksgiving-database-ci).
provider "vault" {
  address          = var.vault_addr
  skip_child_token = true
}
