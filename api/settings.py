from pathlib import Path
from typing import Any, Literal

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


class VoiceConfig(BaseModel):
    """Server-only credentials for anonymous voice entry points."""

    elevenlabs_webhook_secret: str = Field(default="")
    tool_secret: str = Field(default="")


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
    worker: WorkerConfig = Field(default_factory=WorkerConfig)
    storage: StorageConfig = Field(default_factory=StorageConfig)
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
