terraform {
  required_version = ">= 1.11.5"

  required_providers {
    supabase = {
      source  = "supabase/supabase"
      version = "~> 1.11"
    }
    vault = {
      source  = "hashicorp/vault"
      version = "~> 5.9.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }

  # GitLab-managed state (hacksgiving-database-prod), rendered by CI.
  backend "http" {}
}
