from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


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


def configured_rag_service() -> RagService:
    """Return NoteFlow's single supported RAG implementation."""
    from app.rag.pipeline.service import LlamaIndexRagService

    return LlamaIndexRagService()
