from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Protocol

import httpx

from app.config import cfg
from app.rag.v2.retrieval import RetrievalCandidate


def _reranker_endpoint(base_url: str, model: str) -> str:
    base = base_url.rstrip("/")
    if base.endswith(("/rerank", "/reranks")):
        return base
    suffix = "reranks" if model.strip().lower().startswith("qwen3-rerank") else "rerank"
    return f"{base}/{suffix}"


class CandidateReranker(Protocol):
    name: str

    async def rerank(
        self,
        query: str,
        candidates: list[RetrievalCandidate],
        limit: int,
    ) -> list[RetrievalCandidate]: ...


@dataclass
class HttpReranker:
    base_url: str
    api_key: str
    model: str
    name: str = "http"

    async def rerank(
        self,
        query: str,
        candidates: list[RetrievalCandidate],
        limit: int,
    ) -> list[RetrievalCandidate]:
        if not self.base_url or not self.api_key or not self.model:
            raise RuntimeError("reranker endpoint is not configured")
        documents = [candidate.content for candidate in candidates[: cfg.RERANKER_BATCH_SIZE]]
        payload = {"model": self.model, "query": query, "documents": documents, "top_n": min(limit, len(documents))}
        async with httpx.AsyncClient(timeout=cfg.RAG_RERANK_TIMEOUT_SECONDS) as client:
            response = await client.post(
                _reranker_endpoint(self.base_url, self.model),
                headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
        ranked: list[RetrievalCandidate] = []
        for item in data.get("results", []):
            index = int(item.get("index", -1))
            if index < 0 or index >= len(documents):
                continue
            candidate = candidates[index]
            score = float(item.get("relevance_score", item.get("score", 0.0)))
            candidate.scores["reranker"] = score
            candidate.score = score
            ranked.append(candidate)
        if not ranked:
            raise RuntimeError("reranker returned no valid candidates")
        return ranked[:limit]


def configured_reranker() -> CandidateReranker | None:
    if not cfg.RAG_RERANK_ENABLED or cfg.RERANKER_PROVIDER in {"legacy", "none"}:
        return None
    if cfg.RERANKER_PROVIDER in {"http", "llamaindex"}:
        return HttpReranker(cfg.RERANKER_BASE_URL, cfg.RERANKER_API_KEY, cfg.RERANKER_MODEL)
    raise RuntimeError(f"unsupported RERANKER_PROVIDER: {cfg.RERANKER_PROVIDER}")


async def rerank_with_fallback(
    query: str,
    candidates: list[RetrievalCandidate],
    *,
    limit: int,
    provider: CandidateReranker | None = None,
) -> tuple[list[RetrievalCandidate], dict]:
    selected = provider if provider is not None else configured_reranker()
    if selected is None:
        return candidates[:limit], {"status": "disabled", "provider": "rrf", "fallback": False}
    started = time.perf_counter()
    try:
        reranked = await asyncio.wait_for(
            selected.rerank(query, candidates[: cfg.RAG_CANDIDATE_K], limit),
            timeout=cfg.RAG_RERANK_TIMEOUT_SECONDS,
        )
        return reranked, {
            "status": "ok",
            "provider": selected.name,
            "fallback": False,
            "durationMs": round((time.perf_counter() - started) * 1000, 2),
        }
    except asyncio.TimeoutError:
        return candidates[:limit], {
            "status": "timeout",
            "provider": selected.name,
            "fallback": True,
            "durationMs": round((time.perf_counter() - started) * 1000, 2),
        }
    except Exception as exc:
        return candidates[:limit], {
            "status": "failed",
            "provider": selected.name,
            "fallback": True,
            "error": type(exc).__name__,
            "durationMs": round((time.perf_counter() - started) * 1000, 2),
        }
