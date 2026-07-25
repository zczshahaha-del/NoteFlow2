from __future__ import annotations

import hashlib
import time

from app.database import AsyncSessionLocal
from app.models.db import RagQueryLog
from app.observability.context import current_trace
from app.rag.service import RagRequest, RagResult
from app.rag.pipeline.context import build_context, citation_to_dict
from app.rag.pipeline.reranker import rerank_with_fallback
from app.rag.pipeline.retrieval import retrieve_candidates
from app.services.observability import record_metric
from app.utils import random_id


class LlamaIndexRagService:
    """Production RAG facade backed by NoteFlow-owned, versioned storage."""

    async def retrieve(self, request: RagRequest) -> RagResult:
        transient_context: list[str] = []
        if request.selected_text.strip():
            transient_context.append(f"用户当前选中的正文：\n{request.selected_text.strip()}")
        if request.unsaved_content.strip():
            transient_context.append(f"当前编辑器尚未保存的正文：\n{request.unsaved_content.strip()}")
        if transient_context:
            return RagResult(
                context_mode="editor_transient",
                context_text="\n\n".join(transient_context),
                sources=[],
            )

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
