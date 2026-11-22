from pathlib import Path
from typing import Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from dotenv import load_dotenv

# api/.env, wherever the process starts. Variables already set win.
load_dotenv(dotenv_path=Path(__file__).parent / ".env")


class PostgresDatabaseConfig(BaseModel):
    host: str = Field(default="localhost")
    port: int = Field(default=5432)
    name: str = Field(default="hacksgiving")
    username: str | None = Field(default=None)
    password: str | None = Field(default=None)
    ssl: str = Field(default="disable")  # "require" for Supabase
    # Supabase's transaction pooler (port 6543) can't keep prepared
    # statements between transactions; set false when connecting through it.
    prepared_statements: bool = Field(default=True)


# Signs and verifies local dev tokens only. Production refuses to start with
# it (AppConfig._production_is_not_dev).
DEV_JWT_SECRET = "dev-only-hs256-secret-change-me-0000"


class JWTConfig(BaseModel):
    """
    Access-token verification settings.

    Production (Auth0): set `jwks_url` to https://<tenant>/.well-known/jwks.json,
    `algorithm` to RS256, `issuer` to https://<tenant>/ (trailing slash) and
    `audience` to the Auth0 API identifier. Only access tokens for that
    audience are accepted; ID tokens are not API credentials.

    Local dev and tests: leave `jwks_url` empty and tokens are verified with
    the shared HS256 `secret` instead.
    """

    secret: str = Field(default=DEV_JWT_SECRET)
    algorithm: str = Field(default="HS256")
    jwks_url: str | None = Field(default=None)
    audience: str | None = Field(default=None)
    issuer: str | None = Field(default=None)
    # Leeway for clock skew between Auth0 and this host, in seconds.
    leeway: int = Field(default=30)
    # Claim holding the user's display name. Auth0 only puts profile data in
    # access tokens through an Action, under a namespaced key such as
    # https://hacksgiving.app/name; plain `name` is the fallback.
    name_claim: str = Field(default="https://hacksgiving.app/name")

    @field_validator("jwks_url", "audience", "issuer", mode="before")
    @classmethod
    def _blank_is_unset(cls, value: Any) -> Any:
        # example.env leaves these as `KEY=`. PyJWT treats "" as a value it
        # must match, so a blank issuer would reject every dev token.
        return None if isinstance(value, str) and not value.strip() else value


class EnvironmentConfig(BaseModel):
    name: str = Field(default="dev")


class LoggingConfig(BaseModel):
    # Python logging level for the app's own loggers. Third-party HTTP
    # clients stay at WARNING whatever this says (logging_setup.py).
    level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = Field(default="INFO")
    # "json" for production (one object per line), "text" for a terminal.
    format: Literal["json", "text"] = Field(default="text")


class OpenAIConfig(BaseModel):
    """The model that routes requests for help (services/routing.py)."""

    api_key: str | None = Field(default=None)
    model: str = Field(default="gpt-5.4-mini")
    # Seconds before a routing call gives up.
    timeout: float = Field(default=20.0)
    # Speech to text for voice debriefs (services/transcription.py).
    transcription_model: str = Field(default="gpt-4o-transcribe")


class StorageConfig(BaseModel):
    """Object storage for Phantom's audio (adapters/storage.py). Audio lives
    there only until it's transcribed.

    - `supabase` (production): Supabase Storage's own API, with a secret API
      key that database/terraform creates and writes to Vault.
    - `s3` (local): any S3-compatible store, here the `storage` container from
      database/compose.yaml.
    """

    backend: Literal["s3", "supabase"] = Field(default="s3")
    bucket: str = Field(default="phantom-audio")
    # Create the private bucket on startup if it's missing (safe to repeat).
    create_bucket: bool = Field(default=False)
    # How long a signed upload URL works (S3; Supabase's last two hours,
    # which the sweeper covers).
    upload_url_seconds: int = Field(default=540, ge=60, le=3600)
    # OpenAI's transcription limit is 25 MB; a 10-minute debrief at 64 kbps is ~5 MB.
    max_audio_bytes: int = Field(default=24 * 1024 * 1024, ge=1024)
    # The sweeper deletes any audio older than this, whatever its record says.
    max_audio_age_seconds: int = Field(default=3600, ge=300)

    # supabase: https://<project_ref>.supabase.co and a secret key (sb_secret_...).
    supabase_url: str | None = Field(default=None)
    supabase_secret_key: str | None = Field(default=None)

    # s3: where the API and worker reach it, and where the phone uploads to
    # when that differs (locally: this PC's Tailscale address).
    endpoint_url: str | None = Field(default=None)
    public_endpoint_url: str | None = Field(default=None)
    region: str = Field(default="us-east-1")
    access_key_id: str | None = Field(default=None)
    secret_access_key: str | None = Field(default=None)

    @property
    def configured(self) -> bool:
        if self.backend == "supabase":
            return bool(self.supabase_url and self.supabase_secret_key)
        return bool(self.endpoint_url and self.access_key_id and self.secret_access_key)


class WorkerConfig(BaseModel):
    """The background worker (python -m worker): how many jobs it runs at
    once, how long it holds a job, and its liveness port for k8s."""

    concurrency: int = Field(default=4, ge=1, le=64)
    # Longer than the slowest stage's timeout (services/pipeline.py).
    lease_seconds: int = Field(default=150, ge=30, le=3600)
    # Not 8081: that is Expo's dev server port. k8s sets APP__WORKER__HEALTH_PORT.
    health_port: int = Field(default=8090)
    # Records stuck in processing with no live job this long are failed.
    stalled_record_seconds: int = Field(default=600, ge=60)
    # Finished jobs are kept this many days (dead ones 4x longer).
    keep_jobs_days: int = Field(default=7, ge=1)
    # Inbox notifications are kept this many days.
    keep_notifications_days: int = Field(default=90, ge=1)
    # Push devices not seen this many days, and push deliveries older than
    # this, are deleted.
    keep_push_devices_days: int = Field(default=60, ge=1)
    keep_push_deliveries_days: int = Field(default=30, ge=1)
    # Place cases for Insights (services/place.py). The geocoder sends only
    # a block or intersection to the City of Milwaukee's locator; off, cases
    # are placed from their coordinates and neighborhood names alone.
    place_cases: bool = Field(default=True)
    geocode_cases: bool = Field(default=True)


class SmsConfig(BaseModel):
    """Texts to requesters who chose "text me" and said it's safe
    (adapters/sms.py, services/text.py). Off unless a provider is set."""

    provider: Literal["off", "fake", "twilio"] = Field(default="off")
    twilio_account_sid: str = Field(default="")
    twilio_auth_token: str = Field(default="")
    # Either a number on the account (E.164) or a Messaging Service.
    from_number: str = Field(default="")
    twilio_messaging_service_sid: str = Field(default="")
    # At most one text per case in this many minutes; later updates in the
    # window are skipped (the text only says "there's an update").
    coalesce_minutes: int = Field(default=30, ge=0, le=24 * 60)


class VoiceConfig(BaseModel):
    """Server-only credentials for anonymous voice entry points."""

    elevenlabs_webhook_secret: str = Field(default="")
    tool_secret: str = Field(default="")
    # A phone request Ava marks urgent goes in at high priority, which pages
    # on call (D3). False keeps every phone request at medium: the urgency is
    # still recorded on the call, but nobody is paged.
    urgent_pages_on_call: bool = Field(default=True)


class OncallConfig(BaseModel):
    """On call (services/oncall.py)."""

    # The org's time zone: the "On call" switch ends by default at the next
    # 07:00, 17:00 or 23:00 here.
    timezone: str = Field(default="America/Chicago")
    # Urgent escalation (services/oncall_jobs.py): how long each step of the
    # ladder has to accept, then how often admins are reminded when nobody
    # did, and how many times.
    offer_seconds: int = Field(default=300, ge=10, le=3600)
    remind_seconds: int = Field(default=600, ge=10, le=24 * 3600)
    max_reminders: int = Field(default=3, ge=0, le=10)

    @field_validator("timezone")
    @classmethod
    def _known_zone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError(f"Unknown time zone: {value!r}")
        return value


class PushConfig(BaseModel):
    """Push notifications, sent by the worker straight to Apple
    (adapters/push.py, D4 of docs/design/on-call-and-push.md).

    - `off` (default): inbox only; push jobs finish without sending.
    - `fake`: pretend every push was accepted (local runs, tests).
    - `apns`: Apple Push Notification service, with the team's .p8 auth key:
      inline (`apns_key`, the file's contents) or from `apns_key_path`. The
      worker treats push as off, with a warning, when the key is missing.
    """

    provider: Literal["off", "fake", "apns"] = Field(default="off")
    apns_key: str | None = Field(default=None)
    apns_key_path: str | None = Field(default=None)
    apns_key_id: str | None = Field(default=None)
    apns_team_id: str | None = Field(default=None)
    # The app's bundle ID (staging's variant has its own).
    apns_topic: str = Field(default="com.austinkoske.hacksgiving")

    @field_validator("apns_key", "apns_key_path", "apns_key_id", "apns_team_id", mode="before")
    @classmethod
    def _blank_is_unset(cls, value: Any) -> Any:
        return None if isinstance(value, str) and not value.strip() else value

    def signing_key(self) -> str | None:
        """The .p8 key's PEM text, or None when neither setting gives one. An
        inline key may arrive with its newlines escaped (a literal `\\n`)."""
        key = self.apns_key
        if key is None and self.apns_key_path:
            path = Path(self.apns_key_path).expanduser()
            key = path.read_text(encoding="utf-8") if path.is_file() else None
        if key is None:
            return None
        if "\\n" in key and "\n" not in key:
            key = key.replace("\\n", "\n")
        return key.strip() + "\n"


class AppConfig(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="APP__", env_nested_delimiter="__", extra="ignore"
    )

    # default_factory (not just a default instance) so each submodel is
    # built fresh from its own field defaults when no matching APP__*__*
    # env vars are set at all — e.g. running tests without a .env file.
    database: PostgresDatabaseConfig = Field(default_factory=PostgresDatabaseConfig)
    jwt: JWTConfig = Field(default_factory=JWTConfig)
    environment: EnvironmentConfig = Field(default_factory=EnvironmentConfig)
    logging: LoggingConfig = Field(default_factory=LoggingConfig)
    openai: OpenAIConfig = Field(default_factory=OpenAIConfig)
    voice: VoiceConfig = Field(default_factory=VoiceConfig)
    sms: SmsConfig = Field(default_factory=SmsConfig)
    worker: WorkerConfig = Field(default_factory=WorkerConfig)
    storage: StorageConfig = Field(default_factory=StorageConfig)
    oncall: OncallConfig = Field(default_factory=OncallConfig)
    push: PushConfig = Field(default_factory=PushConfig)
    # Browser origins allowed to call the API. The native app doesn't need
    # CORS; this is for Expo web / local tooling.
    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:3000", "http://localhost:8081"]
    )

    @model_validator(mode="after")
    def _production_is_not_dev(self) -> "AppConfig":
        """Production must verify real tokens: Auth0 JWKS, or HS256 with a
        secret from Vault. Never the dev secret anyone can read here."""
        if self.environment.name == "production" and not self.jwt.jwks_url:
            if self.jwt.algorithm != "HS256" or self.jwt.secret == DEV_JWT_SECRET or len(self.jwt.secret) < 32:
                raise ValueError(
                    "Production needs APP__JWT__JWKS_URL (Auth0), or HS256 with a real APP__JWT__SECRET "
                    "of at least 32 characters"
                )
        return self


config = AppConfig()
