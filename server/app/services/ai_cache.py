from __future__ import annotations

import asyncio
import hashlib
import json
import time
from collections import OrderedDict
from contextlib import asynccontextmanager
from typing import AsyncIterator

from app import database as db
from app.config import cfg

MAX_MEMORY_CACHE_ITEMS = 256

_memory_cache: OrderedDict[str, tuple[float, str]] = OrderedDict()
_locks: dict[str, asyncio.Lock] = {}


def _enabled() -> bool:
    return cfg.AI_CACHE_ENABLED and cfg.AI_CACHE_TTL_SECONDS > 0


def _canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def ai_cache_key(namespace: str, body: dict) -> str:
    digest = hashlib.sha256(_canonical_json(body).encode("utf-8")).hexdigest()
    return f"noteflow:ai-cache:{namespace}:{digest}"


def _prune_memory_cache(now: float | None = None):
    current = time.time() if now is None else now
    expired = [key for key, (expires_at, _) in _memory_cache.items() if expires_at <= current]
    for key in expired:
        _memory_cache.pop(key, None)
    while len(_memory_cache) > MAX_MEMORY_CACHE_ITEMS:
        _memory_cache.popitem(last=False)


async def get_cached_ai_text(key: str) -> str | None:
    if not _enabled():
        return None

    if db.redis_client is not None:
        value = await db.redis_client.get(key)
        return str(value) if value else None

    now = time.time()
    cached = _memory_cache.get(key)
    if cached is None:
        _prune_memory_cache(now)
        return None
    expires_at, text = cached
    if expires_at <= now:
        _memory_cache.pop(key, None)
        return None
    _memory_cache.move_to_end(key)
    return text


async def set_cached_ai_text(key: str, text: str):
    if not _enabled() or not text:
        return

    ttl = max(1, cfg.AI_CACHE_TTL_SECONDS)
    if db.redis_client is not None:
        await db.redis_client.set(key, text, ex=ttl)
        return

    _memory_cache[key] = (time.time() + ttl, text)
    _memory_cache.move_to_end(key)
    _prune_memory_cache()


@asynccontextmanager
async def ai_cache_lock(key: str) -> AsyncIterator[None]:
    lock = _locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _locks[key] = lock
    await lock.acquire()
    try:
        yield
    finally:
        lock.release()
        waiters = getattr(lock, "_waiters", None)
        if not lock.locked() and not waiters:
            _locks.pop(key, None)


def cached_delta(text: str) -> dict:
    return {
        "cached": True,
        "choices": [
            {
                "delta": {"content": text},
                "finish_reason": None,
            }
        ],
    }


def cached_stop_delta() -> dict:
    return {
        "cached": True,
        "choices": [
            {
                "delta": {},
                "finish_reason": "stop",
            }
        ],
    }


def clear_ai_memory_cache_for_tests():
    _memory_cache.clear()
    _locks.clear()
