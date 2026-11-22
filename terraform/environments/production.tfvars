# The defaults in variables.tf are production's; this file says so explicitly.
environment = "production"
# The website (web.tf; CI sets web_image for production from build-web-production).
web_hostname = "hacksgiving.austinkoske.com"
cors_origins = ["https://hacksgiving.austinkoske.com"]
# The live sources every 5 minutes, and MPD's calls at most every 5 minutes:
# 6 of MPD's 10 requests per 30 minutes per IP, leaving staging and local dev
# the rest.
loader_live_schedule            = "*/5 * * * *"
loader_mpd_min_interval_seconds = 300
