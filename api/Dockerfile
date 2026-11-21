# Two stages on the same pinned Python: build installs the locked
# dependencies into a virtualenv; runtime copies that virtualenv and the
# code, and runs as an unprivileged user. Every dependency ships a wheel, so
# no compiler is needed.

FROM python:3.13.18-slim-trixie AS build

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never

# A pinned uv binary instead of an install script fetched at build time.
COPY --from=ghcr.io/astral-sh/uv:0.12.13 /uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project


FROM python:3.13.18-slim-trixie AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/app/.venv/bin:$PATH

RUN groupadd --system --gid 10001 hacksgiving \
    && useradd --system --uid 10001 --gid hacksgiving --no-create-home hacksgiving

WORKDIR /app
COPY --from=build /app/.venv /app/.venv
COPY --chown=root:root . .

USER 10001:10001
EXPOSE 8443

# --proxy-headers: the client address comes from the ingress's
# X-Forwarded-For (services/rate_limit.py limits by it). The pod is only
# reachable through the ingress.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8443", "--proxy-headers", "--forwarded-allow-ips", "*"]
