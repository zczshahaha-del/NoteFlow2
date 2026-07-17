from __future__ import annotations

import time
from typing import Any

from sqlalchemy import text

from app import database as db
from app.config import cfg


def _elapsed_ms(start: float) -> int:
    return max(0, int((time.perf_counter() - start) * 1000))


def _check_result(
    *,
    name: str,
    label: str,
    status: str,
    required: bool,
    message: str,
    latency_ms: int = 0,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "name": name,
        "label": label,
        "status": status,
        "required": required,
        "message": message,
        "latencyMs": latency_ms,
        "details": details or {},
    }


async def check_postgres() -> dict[str, Any]:
    start = time.perf_counter()
    try:
        async with db.engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return _check_result(
            name="postgres",
            label="PostgreSQL",
            status="ok",
            required=True,
            message="数据库连接正常。",
            latency_ms=_elapsed_ms(start),
            details={"database": cfg.DB_NAME, "host": cfg.DB_HOST, "port": cfg.DB_PORT},
        )
    except Exception as exc:
        return _check_result(
            name="postgres",
            label="PostgreSQL",
            status="failed",
            required=True,
            message="数据库不可用，登录、笔记、记忆都会受影响。",
            latency_ms=_elapsed_ms(start),
            details={"error": type(exc).__name__, "database": cfg.DB_NAME, "host": cfg.DB_HOST, "port": cfg.DB_PORT},
        )


async def check_redis() -> dict[str, Any]:
    start = time.perf_counter()
    if db.redis_client is None:
        return _check_result(
            name="redis",
            label="Redis",
            status="degraded",
            required=False,
            message="Redis 未连接，系统仍可使用，但限流和 AI 缓存会降级。",
            latency_ms=0,
            details={"configured": bool(cfg.REDIS_ADDR), "address": cfg.REDIS_ADDR},
        )
    try:
        await db.redis_client.ping()
        return _check_result(
            name="redis",
            label="Redis",
            status="ok",
            required=False,
            message="Redis 连接正常。",
            latency_ms=_elapsed_ms(start),
            details={"configured": bool(cfg.REDIS_ADDR), "address": cfg.REDIS_ADDR, "db": cfg.REDIS_DB},
        )
    except Exception as exc:
        return _check_result(
            name="redis",
            label="Redis",
            status="degraded",
            required=False,
            message="Redis 当前不可用，系统仍可使用，但限流和 AI 缓存会降级。",
            latency_ms=_elapsed_ms(start),
            details={"error": type(exc).__name__, "configured": bool(cfg.REDIS_ADDR), "address": cfg.REDIS_ADDR},
        )


def check_ai_config() -> dict[str, Any]:
    ready = bool((cfg.DEEPSEEK_API_KEY or "").strip())
    return _check_result(
        name="ai",
        label="AI 模型",
        status="ok" if ready else "degraded",
        required=False,
        message="AI Key 已配置。" if ready else "AI Key 未配置，聊天和笔记生成会返回配置提示。",
        details={
            "configured": ready,
            "provider": "DeepSeek compatible API",
            "baseURL": cfg.DEEPSEEK_BASE_URL,
            "model": cfg.DEEPSEEK_MODEL,
        },
    )


def check_ai_cache_config() -> dict[str, Any]:
    enabled = bool(cfg.AI_CACHE_ENABLED and cfg.AI_CACHE_TTL_SECONDS > 0)
    redis_backed = db.redis_client is not None
    return _check_result(
        name="ai_cache",
        label="AI 缓存",
        status="ok" if enabled else "disabled",
        required=False,
        message=(
            "AI 缓存已开启，当前使用 Redis。"
            if enabled and redis_backed
            else "AI 缓存已开启，当前使用进程内缓存。"
            if enabled
            else "AI 缓存未开启。"
        ),
        details={
            "enabled": enabled,
            "ttlSeconds": cfg.AI_CACHE_TTL_SECONDS,
            "backend": "redis" if enabled and redis_backed else "memory" if enabled else "none",
        },
    )


def public_config_snapshot() -> dict[str, Any]:
    return {
        "port": cfg.PORT,
        "corsOrigins": cfg.CORS_ORIGINS,
        "database": {"name": cfg.DB_NAME, "host": cfg.DB_HOST, "port": cfg.DB_PORT},
        "redis": {"configured": bool(cfg.REDIS_ADDR), "address": cfg.REDIS_ADDR, "db": cfg.REDIS_DB},
        "ai": {
            "configured": bool((cfg.DEEPSEEK_API_KEY or "").strip()),
            "baseURL": cfg.DEEPSEEK_BASE_URL,
            "model": cfg.DEEPSEEK_MODEL,
            "cacheEnabled": bool(cfg.AI_CACHE_ENABLED),
            "cacheTtlSeconds": cfg.AI_CACHE_TTL_SECONDS,
            "rateLimitPerMinute": cfg.AI_RATE_LIMIT,
        },
    }


async def build_diagnostics() -> dict[str, Any]:
    checks = [
        await check_postgres(),
        await check_redis(),
        check_ai_config(),
        check_ai_cache_config(),
    ]
    required_failed = any(check["required"] and check["status"] != "ok" for check in checks)
    degraded = any(check["status"] == "degraded" for check in checks)
    status = "unhealthy" if required_failed else "degraded" if degraded else "healthy"
    return {
        "ok": not required_failed,
        "status": status,
        "checks": checks,
        "config": public_config_snapshot(),
    }
