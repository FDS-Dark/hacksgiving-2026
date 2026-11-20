"""One logging configuration for the whole API, applied at startup.

Everything logs through the standard library (`logging.getLogger(__name__)`).
Production writes one JSON object per line; a terminal gets plain text.
"""

import json
import logging
from typing import Any

from settings import LoggingConfig

# HTTP clients log full request URLs at INFO. Keep them quiet so a URL (and
# anything a third-party API wants in its query string) never reaches the
# logs, whatever the app's own level is.
QUIET_LOGGERS = ("httpx", "httpcore")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "time": self.formatTime(record),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry)


def configure_logging(settings: LoggingConfig) -> None:
    handler = logging.StreamHandler()
    if settings.format == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(settings.level)
    for name in QUIET_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)
