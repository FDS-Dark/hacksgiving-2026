"""The loader's settings, from the environment (and dataloader/.env locally).

The names are the API's (APP__DATABASE__*, APP__LOGGING__*, APP__LOADER__*),
so the same Kubernetes secrets and Vault keys work for both: see
terraform/loader.tf. Other APP__* variables are ignored."""

from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# dataloader/.env, wherever the process starts. Variables already set win.
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


class EnvironmentConfig(BaseModel):
    name: str = Field(default="dev")


class LoggingConfig(BaseModel):
    # Python logging level for the loader's own loggers. Third-party HTTP
    # clients stay at WARNING whatever this says (utils/logging_config.py).
    level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = Field(default="INFO")
    # "json" for production (one object per line), "text" for a terminal.
    format: Literal["json", "text"] = Field(default="text")


class LoaderConfig(BaseModel):
    """Where to look, the sources' credentials, and how often the
    rate-limited source may be asked (docs/data-loader.md). A source without
    credentials is skipped."""

    # Job and training searches: a "City, ST" place and a radius in miles.
    location: str = Field(default="Milwaukee, WI")
    radius_miles: int = Field(default=25, ge=1, le=100)
    # Directory downloads (no search): keep rows in this state whose ZIP code
    # starts with one of these. 530-532 is the Milwaukee metro.
    state: str = Field(default="WI")
    zip_prefixes: list[str] = Field(default_factory=lambda: ["530", "531", "532"])
    # Postings older than this many days aren't fetched.
    max_age_days: int = Field(default=30, ge=1, le=60)
    # At most this many rows per source and run.
    max_per_source: int = Field(default=500, ge=1, le=2000)
    timeout: float = Field(default=30.0)

    # USAJOBS (developer.usajobs.gov): an API key and the email address it
    # was requested with, which USAJOBS wants as the User-Agent.
    usajobs_api_key: str = Field(default="")
    usajobs_email: str = Field(default="")
    # CareerOneStop Web API (careeronestop.org/Developers): the user id and
    # token from registration. Jobs and training programs need them; the
    # American Job Center and reentry directories are public downloads.
    careeronestop_user_id: str = Field(default="")
    careeronestop_token: str = Field(default="")
    # Job search terms; "0" means every job in the area.
    careeronestop_job_keywords: list[str] = Field(default_factory=lambda: ["0"])

    # Public data (docs/real-data-sources.md). NIBRS: how many days back each
    # nightly run refreshes (the source edits records for weeks).
    nibrs_window_days: int = Field(default=90, ge=7, le=730)
    # Dispatch calls (MPD, MFD) are kept this long, then deleted.
    signal_ttl_hours: int = Field(default=24, ge=1, le=168)
    # NWS forecast zones: Milwaukee County and its lakeshore zone.
    nws_zones: list[str] = Field(default_factory=lambda: ["WIC079", "WIZ066"])
    # CDC PLACES: Milwaukee County.
    county_fips: str = Field(default="55079")
    # FBI Crime Data Explorer: an api.data.gov key (optional; it answers
    # without one), and how many months back.
    fbi_api_key: str = Field(default="")
    fbi_months: int = Field(default=24, ge=1, le=120)
    # Seconds between live runs in --watch mode (MPD/MFD calls, alerts).
    live_every_seconds: int = Field(default=300, ge=60)

    # MPD's calls page allows 10 requests per 30 minutes per IP address, and
    # production, staging and every laptop share one address. Each
    # environment asks at most this often, whatever its schedule says:
    # production 300, staging 3600, local 900 (6 + 0.5 + 2 per 30 minutes).
    mpd_min_interval_seconds: int = Field(default=900, ge=60)
    # After MPD refuses, no loader sharing this database asks again for this
    # long: every refused request counts against the limit too.
    mpd_backoff_seconds: int = Field(default=1800, ge=60)


class AppConfig(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="APP__", env_nested_delimiter="__", extra="ignore")

    # default_factory, so each part is built from its own field defaults
    # when no APP__*__* variable is set at all (tests, --list in the image).
    database: PostgresDatabaseConfig = Field(default_factory=PostgresDatabaseConfig)
    environment: EnvironmentConfig = Field(default_factory=EnvironmentConfig)
    logging: LoggingConfig = Field(default_factory=LoggingConfig)
    loader: LoaderConfig = Field(default_factory=LoaderConfig)


config = AppConfig()
