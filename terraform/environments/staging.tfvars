# Staging: the staging Supabase project (database/terraform publishes its
# secrets under deployments/hacksgiving/staging/) and its own hostname. The same
# Auth0 tenant and API audience as production, so the same app and E2E
# client sign in to both.
environment    = "staging"
api_hostname   = "hacksgiving-api-staging.austinkoske.com"
db_secret_path = "deployments/hacksgiving/staging/db"
# Seeded by hand like production's: jwt_secret, elevenlabs_webhook_secret,
# and voice_tool_secret.
app_secret_path = "deployments/hacksgiving/staging/app"
