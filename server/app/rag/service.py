from __future__ import annotations

from dataclasses import dataclass
import hashlib
import time
from typing import Protocol

from app.database import AsyncSessionLocal
from app.services.note_library import build_library_context, build_note_context, source_to_dict
from app.repositories.notes import NoteRepository
from app.models.db import RagQueryLog
from app.observability.context import current_trace
from app.services.observability import record_metric
from app.utils import random_id


@dataclass(frozen=True)
class RagRequest:
    user_id: str
    question: str
    note_id: str | None = None
    fallback_query: str = ""
    selected_text: str = ""
    current_section_id: str | None = None
    unsaved_content: str = ""


@dataclass(frozen=True)
class RagResult:
    context_mode: str
    context_text: str
    sources: list[dict]


class RagService(Protocol):
    async def retrieve(self, request: RagRequest) -> RagResult: ...


class LegacyRagService:
    async def retrieve(self, request: RagRequest) -> RagResult:
        started = time.perf_counter()
        try:
            async with AsyncSessionLocal() as session:
                if request.note_id:
                    note = await NoteRepository(session).get_active(request.user_id, request.note_id)
                    if note is None:
                        raise LookupError("note not found")
                    context = await build_note_context(
                        session, request.user_id, note, question=request.question,
                        selected_text=request.selected_text, unsaved_content=request.unsaved_content,
                        current_section_id=request.current_section_id,
                    )
                else:
                    context = await build_library_context(
                        session, request.user_id, question=request.question,
                        fallback_query=request.fallback_query,
                    )
                sources = [source_to_dict(source) for source in context.sources]
                trace = current_trace()
                session.add(RagQueryLog(
                    id=random_id(), user_id=request.user_id,
                    query_hash=hashlib.sha256(request.question.encode()).hexdigest(),
                    query_preview=" ".join(request.question.split())[:300],
                    provider="legacy", mode=context.context_mode,
                    candidate_count=len(sources), result_count=len(sources),
                    latency_ms=int((time.perf_counter() - started) * 1000),
                    trace_id=trace.trace_id or None, run_id=trace.run_id or None,
                ))
                await session.commit()
            record_metric("rag", "retrieve", duration_ms=(time.perf_counter() - started) * 1000)
            return RagResult(context_mode=context.context_mode, context_text=context.context_text, sources=sources)
        except Exception:
            record_metric("rag", "retrieve", status="failed", duration_ms=(time.perf_counter() - started) * 1000)
            raise


def configured_rag_service() -> RagService:
    """Return the selected provider without changing the default legacy path."""

    from app.config import cfg

    if cfg.RAG_PROVIDER == "legacy":
        return LegacyRagService()
    if cfg.RAG_PROVIDER == "llamaindex":
        from app.rag.v2.service import LlamaIndexRagService

        return LlamaIndexRagService()
    raise RuntimeError(f"unsupported RAG_PROVIDER: {cfg.RAG_PROVIDER}")
