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


class VoiceConfig(BaseModel):
    """Secrets for anonymous telephony entry points.

    Empty means the corresponding entry point is disabled. Production values
    come from Vault; they are never shipped to the mobile app.
    """

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
    voice: VoiceConfig = Field(default_factory=VoiceConfig)
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
