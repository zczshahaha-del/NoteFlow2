from __future__ import annotations

import asyncio

from app import database as db
from app.config import cfg
from app.services import diagnostics


def _assert(condition: bool, message: str):
    if not condition:
        raise AssertionError(message)


async def main_async():
    old_redis = db.redis_client
    old_key = cfg.DEEPSEEK_API_KEY
    old_cache_enabled = cfg.AI_CACHE_ENABLED
    old_cache_ttl = cfg.AI_CACHE_TTL_SECONDS

    try:
        db.redis_client = None
        cfg.DEEPSEEK_API_KEY = "test-secret-key"
        cfg.AI_CACHE_ENABLED = True
        cfg.AI_CACHE_TTL_SECONDS = 60

        redis_check = await diagnostics.check_redis()
        _assert(redis_check["name"] == "redis", "redis check should be named redis")
        _assert(redis_check["status"] == "degraded", "missing redis should be degraded, not fatal")
        _assert(redis_check["required"] is False, "redis should be optional")

        ai_check = diagnostics.check_ai_config()
        _assert(ai_check["status"] == "ok", "configured AI key should make AI check ok")
        _assert("test-secret-key" not in str(ai_check), "diagnostics must not expose AI key")

        cache_check = diagnostics.check_ai_cache_config()
        _assert(cache_check["status"] == "ok", "enabled AI cache should be ok")
        _assert(cache_check["details"]["backend"] == "memory", "without redis, cache should fall back to memory")

        public_config = diagnostics.public_config_snapshot()
        _assert(public_config["ai"]["configured"] is True, "public config should expose key presence only")
        _assert("test-secret-key" not in str(public_config), "public config must not expose secret values")

        cfg.DEEPSEEK_API_KEY = ""
        ai_missing = diagnostics.check_ai_config()
        _assert(ai_missing["status"] == "degraded", "missing AI key should be degraded")
        _assert(ai_missing["required"] is False, "AI should be optional for core app health")
    finally:
        db.redis_client = old_redis
        cfg.DEEPSEEK_API_KEY = old_key
        cfg.AI_CACHE_ENABLED = old_cache_enabled
        cfg.AI_CACHE_TTL_SECONDS = old_cache_ttl


def main():
    asyncio.run(main_async())
    print("diagnostics checks passed")


if __name__ == "__main__":
    main()
