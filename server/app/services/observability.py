from __future__ import annotations

import logging
import time
import uuid
from collections import defaultdict, deque
import statistics
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from app.observability.context import new_trace_id, structured_log, trace_scope

logger = logging.getLogger("noteflow.http")

_request_counts: dict[str, int] = defaultdict(int)
_status_counts: dict[str, int] = defaultdict(int)
_duration_totals_ms: dict[str, float] = defaultdict(float)
_route_duration_samples_ms: dict[str, deque[float]] = defaultdict(lambda: deque(maxlen=2000))
_domain_counts: dict[str, int] = defaultdict(int)
_domain_failures: dict[str, int] = defaultdict(int)
_domain_duration_ms: dict[str, float] = defaultdict(float)
_domain_duration_samples_ms: dict[str, deque[float]] = defaultdict(lambda: deque(maxlen=2000))
_provider_usage: dict[str, dict[str, float | int]] = defaultdict(
    lambda: {
        "calls": 0,
        "cacheHits": 0,
        "failures": 0,
        "inputTokens": 0,
        "outputTokens": 0,
        "estimatedCostUsd": 0.0,
    }
)


def _percentile(values: list[float], ratio: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, round((len(ordered) - 1) * ratio)))
    return round(ordered[index], 2)


def _latency_summary(samples: deque[float]) -> dict[str, float | int]:
    values = list(samples)
    return {
        "samples": len(values),
        "p50Ms": round(statistics.median(values), 2) if values else 0.0,
        "p95Ms": _percentile(values, 0.95),
    }


def record_metric(domain: str, operation: str, *, status: str = "success", duration_ms: float = 0) -> None:
    key = f"{domain}.{operation}"
    _domain_counts[key] += 1
    _domain_duration_ms[key] += max(0, duration_ms)
    _domain_duration_samples_ms[key].append(max(0, duration_ms))
    if status not in {"success", "ok", "completed"}:
        _domain_failures[key] += 1


def record_provider_usage(
    provider: str,
    operation: str,
    *,
    input_tokens: int = 0,
    output_tokens: int = 0,
    estimated_cost_usd: float = 0.0,
    cache_hit: bool = False,
    failed: bool = False,
) -> None:
    key = f"{provider}.{operation}"
    usage = _provider_usage[key]
    usage["calls"] += 0 if cache_hit else 1
    usage["cacheHits"] += 1 if cache_hit else 0
    usage["failures"] += 1 if failed else 0
    usage["inputTokens"] += max(0, input_tokens)
    usage["outputTokens"] += max(0, output_tokens)
    usage["estimatedCostUsd"] = round(float(usage["estimatedCostUsd"]) + max(0.0, estimated_cost_usd), 8)


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
    trace_id = getattr(request.state, "trace_id", "")
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {"code": code or _error_code(status_code), "message": message},
            "requestId": request_id,
            "traceId": trace_id,
        },
    )


def metrics_snapshot() -> dict[str, Any]:
    routes = {}
    for route, count in _request_counts.items():
        routes[route] = {
            "requests": count,
            "averageDurationMs": round(_duration_totals_ms[route] / count, 2) if count else 0,
            **_latency_summary(_route_duration_samples_ms[route]),
        }
    return {
        "routes": routes,
        "statuses": dict(_status_counts),
        "totalRequests": sum(_request_counts.values()),
        "domains": {
            key: {
                "operations": count,
                "failures": _domain_failures[key],
                "averageDurationMs": round(_domain_duration_ms[key] / count, 2) if count else 0,
                **_latency_summary(_domain_duration_samples_ms[key]),
            }
            for key, count in _domain_counts.items()
        },
        "providerUsage": {key: dict(value) for key, value in _provider_usage.items()},
    }


def install_observability(app: FastAPI) -> None:
    @app.middleware("http")
    async def observe_request(request: Request, call_next):
        supplied = request.headers.get("x-request-id", "")
        request_id = supplied[:80] if supplied and supplied.replace("-", "").isalnum() else uuid.uuid4().hex
        supplied_trace = request.headers.get("x-trace-id", "")
        trace_id = supplied_trace[:80] if supplied_trace and supplied_trace.replace("-", "").isalnum() else new_trace_id()
        request.state.request_id = request_id
        request.state.trace_id = trace_id
        started = time.perf_counter()
        with trace_scope(request_id=request_id, trace_id=trace_id):
            try:
                response = await call_next(request)
            except Exception:
                duration_ms = (time.perf_counter() - started) * 1000
                record_metric("api", "request", status="failed", duration_ms=duration_ms)
                structured_log(logger, logging.ERROR, "http_request_failed", method=request.method, path=request.url.path, durationMs=round(duration_ms, 2))
                raise

        duration_ms = (time.perf_counter() - started) * 1000
        route = getattr(request.scope.get("route"), "path", request.url.path)
        route_key = f"{request.method} {route}"
        _request_counts[route_key] += 1
        _status_counts[str(response.status_code)] += 1
        _duration_totals_ms[route_key] += duration_ms
        _route_duration_samples_ms[route_key].append(duration_ms)
        record_metric("api", "request", status="success" if response.status_code < 500 else "failed", duration_ms=duration_ms)
        response.headers["X-Request-Id"] = request_id
        response.headers["X-Trace-Id"] = trace_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), geolocation=(), payment=()"
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
        response.headers["Cross-Origin-Resource-Policy"] = "same-site"
        with trace_scope(request_id=request_id, trace_id=trace_id):
            structured_log(logger, logging.INFO, "http_request", method=request.method, route=route, status=response.status_code, durationMs=round(duration_ms, 2))
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
