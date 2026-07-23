from __future__ import annotations

import hashlib
import time

from app.database import AsyncSessionLocal
from app.models.db import RagQueryLog
from app.observability.context import current_trace
from app.rag.service import RagRequest, RagResult
from app.rag.v2.context import build_context, citation_to_dict
from app.rag.v2.reranker import rerank_with_fallback
from app.rag.v2.retrieval import retrieve_candidates
from app.services.observability import record_metric
from app.utils import random_id


class LlamaIndexRagService:
    """RAG v2 facade; the storage model remains NoteFlow-owned and versioned."""

    async def retrieve(self, request: RagRequest) -> RagResult:
        # Selection and dirty-editor context are not persisted and deliberately
        # remain on the established path until the Agent rollout step.
        if request.selected_text.strip() or request.unsaved_content.strip():
            from app.rag.service import LegacyRagService

            return await LegacyRagService().retrieve(request)

        started = time.perf_counter()
        retrieval = await retrieve_candidates(
            request.user_id,
            request.question,
            note_id=request.note_id,
        )
        reranked, rerank_trace = await rerank_with_fallback(
            request.question,
            retrieval.candidates,
            limit=8,
        )
        context = build_context(request.question, reranked)
        sources = [citation_to_dict(citation) for citation in context.citations]
        trace = {**retrieval.trace, "reranker": rerank_trace, "context": {
            "citationCount": len(context.citations),
            "tokenCount": context.token_count,
            "droppedCount": context.dropped_count,
        }}
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        active_trace = current_trace()
        async with AsyncSessionLocal() as session:
            session.add(
                RagQueryLog(
                    id=random_id(),
                    user_id=request.user_id,
                    query_hash=hashlib.sha256(request.question.encode()).hexdigest(),
                    query_preview=" ".join(request.question.split())[:300],
                    provider="llamaindex",
                    mode="rag_v2_hybrid",
                    candidate_count=len(retrieval.candidates),
                    result_count=len(sources),
                    latency_ms=elapsed_ms,
                    trace_id=active_trace.trace_id or None,
                    run_id=active_trace.run_id or None,
                    metrics=trace,
                )
            )
            await session.commit()
        record_metric("rag_v2", "retrieve", duration_ms=elapsed_ms)
        return RagResult(
            context_mode="rag_v2_note" if request.note_id else "rag_v2_library",
            context_text=context.text,
            sources=sources,
        )
