terraform {
  required_version = ">= 1.11.5"

  required_providers {
    auth0 = {
      source  = "auth0/auth0"
      version = "~> 1.60"
    }
  }

  backend "http" {}
}
