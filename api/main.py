from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import errors
from dependencies import get_executor
from logging_setup import configure_logging
from routers.case import router as cases
from routers.health import router as health
from routers.request import router as requests
from routers.resource import router as resources
from routers.routing import router as routing
from routers.public_request import router as public_requests
from routers.staff import router as staff
from routers.task import router as tasks
from routers.user import router as user
from routers.voice import router as voice
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
    allow_headers=["Content-Type", "Accept", "Authorization", "X-Request-ID", "X-Access-Code"],
    expose_headers=["X-Request-ID"],
    max_age=3600,
)

errors.install(app)

for router in (health, user, routing, requests, public_requests, cases, tasks, resources, staff, voice):
    app.include_router(router, prefix="/v1")


# Unversioned alias for the k8s probes in terraform/main.tf.
@app.get("/health", include_in_schema=False)
async def health_alias() -> dict[str, str]:
    return {"status": "healthy"}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
