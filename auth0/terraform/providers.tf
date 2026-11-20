# Credentials come from the environment, never from tfvars:
#   AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET
# They belong to the "Hacksgiving Terraform" Machine-to-Machine app (see README.md).
provider "auth0" {}
