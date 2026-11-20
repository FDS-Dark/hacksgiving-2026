"""Structured API errors: every failure body is
`{"code": ..., "message": ..., "request_id": ...}`, and every
response, failures included, carries `X-Request-ID`."""

import logging
from collections.abc import Awaitable, Callable
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

REQUEST_ID_HEADER = "X-Request-ID"


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def not_found(resource: str) -> ApiError:
    return ApiError(404, f"{resource}_not_found", f"{resource.replace('_', ' ').capitalize()} not found")


def _body(request: Request, code: str, message: str, **extra: Any) -> dict[str, Any]:
    return {
        "code": code,
        "message": message,
        "request_id": getattr(request.state, "request_id", None),
        **extra,
    }


_HTTP_CODES = {401: "unauthenticated", 403: "forbidden", 404: "not_found", 405: "method_not_allowed"}


def install(app: FastAPI) -> None:
    @app.middleware("http")
    async def request_id(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        # Accept a caller-supplied ID only if it looks sane; otherwise mint one.
        supplied = request.headers.get(REQUEST_ID_HEADER, "")
        request.state.request_id = supplied if 0 < len(supplied) <= 64 and supplied.isprintable() else str(uuid4())
        try:
            response = await call_next(request)
        except Exception:
            # Unhandled errors are answered here, not by an exception
            # handler: Starlette runs those outside this middleware, so their
            # response would miss the request id.
            logger.exception("Unhandled error (request_id=%s)", request.state.request_id)
            response = JSONResponse(_body(request, "internal_error", "Something went wrong"), status_code=500)
        response.headers[REQUEST_ID_HEADER] = request.state.request_id
        return response

    @app.exception_handler(ApiError)
    async def api_error(request: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(_body(request, exc.code, exc.message), status_code=exc.status_code)

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
        code = _HTTP_CODES.get(exc.status_code, "http_error")
        return JSONResponse(
            _body(request, code, str(exc.detail)),
            status_code=exc.status_code,
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        fields = [{"loc": list(e.get("loc", [])), "message": e.get("msg", "")} for e in exc.errors()]
        return JSONResponse(
            _body(request, "validation_error", "Request validation failed", fields=fields),
            status_code=422,
        )
