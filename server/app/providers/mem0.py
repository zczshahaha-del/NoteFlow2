from __future__ import annotations

import asyncio
import re
import threading
from typing import Any, Callable

from app.config import cfg
from app.providers.resilience import AsyncCircuitBreaker


def _results(value: Any) -> list[dict]:
    if isinstance(value, dict):
        value = value.get("results", [])
    return [item for item in (value or []) if isinstance(item, dict)]


class Mem0Provider:
    """Lazy Mem0 OSS adapter. NoteFlow remains the policy and audit source of truth."""

    name = "mem0"

    def __init__(self, *, client_factory: Callable[[], Any] | None = None) -> None:
        self._client_factory = client_factory or self._build_client
        self._client: Any | None = None
        self._lock = threading.Lock()
        self._breaker = AsyncCircuitBreaker(
            cfg.MEM0_ERROR_THRESHOLD,
            cfg.MEM0_ERROR_WINDOW_SECONDS,
            cfg.MEM0_CIRCUIT_COOLDOWN_SECONDS,
        )

    def _build_client(self):
        try:
            from mem0 import Memory
        except ImportError as exc:
            raise RuntimeError("mem0ai==2.0.0 is required when Mem0 is enabled") from exc
        if not cfg.EMBEDDING_API_KEY:
            raise RuntimeError("EMBEDDING_API_KEY is required when Mem0 is enabled")
        if not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_]{0,62}", cfg.MEM0_COLLECTION_NAME):
            raise RuntimeError("MEM0_COLLECTION_NAME must be a safe PostgreSQL identifier")
        return Memory.from_config(
            {
                "version": "v1.1",
                "history_db_path": cfg.MEM0_HISTORY_DB_PATH,
                "vector_store": {
                    "provider": "pgvector",
                    "config": {
                        "dbname": cfg.DB_NAME,
                        "collection_name": cfg.MEM0_COLLECTION_NAME,
                        "embedding_model_dims": cfg.EMBEDDING_DIMENSIONS,
                        "user": cfg.DB_USER,
                        "password": cfg.DB_PASSWORD,
                        "host": cfg.DB_HOST,
                        "port": int(cfg.DB_PORT),
                        "diskann": False,
                        "hnsw": True,
                    },
                },
                "embedder": {
                    "provider": "openai",
                    "config": {
                        "model": cfg.EMBEDDING_MODEL,
                        "api_key": cfg.EMBEDDING_API_KEY,
                        "openai_base_url": cfg.EMBEDDING_BASE_URL,
                        "embedding_dims": cfg.EMBEDDING_DIMENSIONS,
                    },
                },
                "llm": {
                    "provider": "deepseek",
                    "config": {
                        "model": cfg.DEEPSEEK_MODEL,
                        "api_key": cfg.DEEPSEEK_API_KEY,
                        "deepseek_base_url": cfg.DEEPSEEK_BASE_URL,
                    },
                },
                "custom_instructions": (
                    "Only store durable facts about the authenticated user. Never store secrets, "
                    "credentials, third-party personal data, temporary instructions, or medical/financial identifiers."
                ),
            }
        )

    def _get_client(self):
        if self._client is None:
            with self._lock:
                if self._client is None:
                    self._client = self._client_factory()
        return self._client

    async def _call(self, function: Callable[[], Any]):
        return await self._breaker.call(
            lambda: asyncio.to_thread(function),
            timeout_ms=cfg.MEM0_TIMEOUT_MS,
        )

    async def search(self, *, user_id: str, query: str, limit: int = 8) -> list[dict]:
        result = await self._call(
            lambda: self._get_client().search(
                query,
                top_k=max(1, min(limit, 20)),
                filters={"user_id": user_id},
            )
        )
        return _results(result)

    async def add(self, *, user_id: str, content: str, metadata: dict | None = None) -> dict:
        result = await self._call(
            lambda: self._get_client().add(
                content,
                user_id=user_id,
                metadata=metadata or {},
                infer=False,
            )
        )
        rows = _results(result)
        if not rows or not rows[0].get("id"):
            raise RuntimeError("Mem0 add returned no external id")
        return rows[0]

    async def delete(self, *, user_id: str, memory_id: str) -> bool:
        # Ownership is verified against NoteFlow's projection before this method is called.
        del user_id
        try:
            await self._call(lambda: self._get_client().delete(memory_id))
        except ValueError as exc:
            if "not found" not in str(exc).lower():
                raise
        return True


_provider: Mem0Provider | None = None


def get_mem0_provider() -> Mem0Provider:
    global _provider
    if _provider is None:
        _provider = Mem0Provider()
    return _provider
