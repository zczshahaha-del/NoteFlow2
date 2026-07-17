from __future__ import annotations

import json
import logging
import time
import uuid
from collections import defaultdict
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

logger = logging.getLogger("noteflow.http")

_request_counts: dict[str, int] = defaultdict(int)
_status_counts: dict[str, int] = defaultdict(int)
_duration_totals_ms: dict[str, float] = defaultdict(float)


def _error_code(status_code: int) -> str:
    return {
        400: "BAD_REQUEST",
        401: "AUTH_REQUIRED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        409: "CONFLICT",
        413: "PAYLOAD_TOO_LARGE",
        422: "VALIDATION_ERROR",
        429: "RATE_LIMITED",
        500: "INTERNAL_ERROR",
        502: "UPSTREAM_ERROR",
        503: "SERVICE_UNAVAILABLE",
    }.get(status_code, f"HTTP_{status_code}")


def _error_response(request: Request, status_code: int, message: str, code: str | None = None) -> JSONResponse:
    request_id = getattr(request.state, "request_id", "")
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {"code": code or _error_code(status_code), "message": message},
            "requestId": request_id,
        },
    )


def metrics_snapshot() -> dict[str, Any]:
    routes = {}
    for route, count in _request_counts.items():
        routes[route] = {
            "requests": count,
            "averageDurationMs": round(_duration_totals_ms[route] / count, 2) if count else 0,
        }
    return {
        "routes": routes,
        "statuses": dict(_status_counts),
        "totalRequests": sum(_request_counts.values()),
    }


def install_observability(app: FastAPI) -> None:
    @app.middleware("http")
    async def observe_request(request: Request, call_next):
        supplied = request.headers.get("x-request-id", "")
        request_id = supplied[:80] if supplied and supplied.replace("-", "").isalnum() else uuid.uuid4().hex
        request.state.request_id = request_id
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            duration_ms = (time.perf_counter() - started) * 1000
            logger.exception(json.dumps({
                "event": "http_request_failed",
                "requestId": request_id,
                "method": request.method,
                "path": request.url.path,
                "durationMs": round(duration_ms, 2),
            }, ensure_ascii=False))
            raise

        duration_ms = (time.perf_counter() - started) * 1000
        route = getattr(request.scope.get("route"), "path", request.url.path)
        route_key = f"{request.method} {route}"
        _request_counts[route_key] += 1
        _status_counts[str(response.status_code)] += 1
        _duration_totals_ms[route_key] += duration_ms
        response.headers["X-Request-Id"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), geolocation=(), payment=()"
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
        response.headers["Cross-Origin-Resource-Policy"] = "same-site"
        logger.info(json.dumps({
            "event": "http_request",
            "requestId": request_id,
            "method": request.method,
            "route": route,
            "status": response.status_code,
            "durationMs": round(duration_ms, 2),
        }, ensure_ascii=False))
        return response

    @app.exception_handler(HTTPException)
    async def handle_http_exception(request: Request, error: HTTPException):
        if isinstance(error.detail, dict):
            message = str(error.detail.get("message") or error.detail.get("detail") or "request failed")
            code = str(error.detail.get("code") or _error_code(error.status_code))
        else:
            message = str(error.detail)
            code = _error_code(error.status_code)
        return _error_response(request, error.status_code, message, code)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, error: RequestValidationError):
        fields = [".".join(str(part) for part in item.get("loc", [])[1:]) for item in error.errors()]
        suffix = f": {', '.join(item for item in fields if item)}" if fields else ""
        return _error_response(request, 422, f"请求参数有误{suffix}", "VALIDATION_ERROR")

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, error: Exception):
        logger.exception("unhandled request error", exc_info=error)
        return _error_response(request, 500, "服务器暂时无法完成请求", "INTERNAL_ERROR")
