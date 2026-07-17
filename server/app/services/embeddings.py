from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from typing import Iterable

import httpx

from app.config import cfg


@dataclass
class EmbeddingBatchResult:
    embeddings: list[list[float]]
    provider: str
    model: str
    dimensions: int


def embedding_enabled() -> bool:
    return bool(cfg.EMBEDDING_PROVIDER and cfg.EMBEDDING_PROVIDER != "none" and cfg.EMBEDDING_API_KEY)


def content_hash(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def chunk_embedding_text(
    *,
    note_title: str,
    section_title: str,
    chunk_content: str,
    tags: Iterable[str] | None = None,
) -> str:
    tag_text = "、".join([tag for tag in (tags or []) if tag])
    parts = [
        f"笔记标题：{note_title or '未命名笔记'}",
        f"章节路径：{section_title or '正文'}",
    ]
    if tag_text:
        parts.append(f"标签：{tag_text}")
    parts.append(f"内容：\n{chunk_content or ''}")
    return "\n".join(parts).strip()


async def embed_texts(texts: list[str]) -> EmbeddingBatchResult:
    if not embedding_enabled():
        raise RuntimeError("embedding provider is not configured")
    if not texts:
        return EmbeddingBatchResult([], cfg.EMBEDDING_PROVIDER, cfg.EMBEDDING_MODEL, cfg.EMBEDDING_DIMENSIONS)

    payload: dict = {
        "model": cfg.EMBEDDING_MODEL,
        "input": texts,
    }
    if cfg.EMBEDDING_DIMENSIONS > 0:
        payload["dimensions"] = cfg.EMBEDDING_DIMENSIONS

    url = f"{cfg.EMBEDDING_BASE_URL}/embeddings"
    timeout = httpx.Timeout(float(cfg.EMBEDDING_TIMEOUT_SECONDS))
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            url,
            headers={
                "Authorization": f"Bearer {cfg.EMBEDDING_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        response.raise_for_status()
        data = response.json()

    rows = sorted(data.get("data", []), key=lambda item: item.get("index", 0))
    vectors = [row.get("embedding") for row in rows]
    if len(vectors) != len(texts) or any(not isinstance(vector, list) for vector in vectors):
        raise RuntimeError("embedding provider returned an invalid response")

    dimensions = len(vectors[0]) if vectors else cfg.EMBEDDING_DIMENSIONS
    return EmbeddingBatchResult(
        embeddings=vectors,
        provider=cfg.EMBEDDING_PROVIDER,
        model=cfg.EMBEDDING_MODEL,
        dimensions=dimensions,
    )


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = 0.0
    left_norm = 0.0
    right_norm = 0.0
    for a, b in zip(left, right):
        dot += a * b
        left_norm += a * a
        right_norm += b * b
    if left_norm <= 0 or right_norm <= 0:
        return 0.0
    return dot / (math.sqrt(left_norm) * math.sqrt(right_norm))
