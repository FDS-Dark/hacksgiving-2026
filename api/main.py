from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import errors
from dependencies import get_executor
from logging_setup import configure_logging
from routers.health import router as health
from routers.user import router as user
from settings import config

configure_logging(config.logging)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    if get_executor.cache_info().currsize:
        await get_executor().dispose()


app = FastAPI(
    title="Hacksgiving API",
    description="The Hacksgiving API.",
    version="0.1.0",
    docs_url=None if config.environment.name == "production" else "/docs",
    redoc_url=None if config.environment.name == "production" else "/redoc",
    lifespan=lifespan,
)

# The native app doesn't need CORS; the default origins cover Expo web and
# local tooling. Production sets APP__CORS_ORIGINS to [].
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.cors_origins,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Accept", "Authorization", "X-Request-ID"],
    expose_headers=["X-Request-ID"],
    max_age=3600,
)

errors.install(app)

for router in (health, user):
    app.include_router(router, prefix="/v1")


# Unversioned alias for the k8s probes in terraform/main.tf.
@app.get("/health", include_in_schema=False)
async def health_alias() -> dict[str, str]:
    return {"status": "healthy"}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
