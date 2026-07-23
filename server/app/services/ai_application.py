from __future__ import annotations

from dataclasses import dataclass

from app.database import AsyncSessionLocal
from app.memory.service import LegacyMemoryService
from app.rag.service import RagRequest, configured_rag_service
from app.repositories.notes import NoteRepository
from app.services.note_library import is_library_search_query


MEMORY_TYPES = [
    "identity",
    "personal_info",
    "interest",
    "preference",
    "goal",
    "writing_style",
    "constraint",
    "workflow",
    "skill",
]


@dataclass(frozen=True)
class ChatContextInput:
    question: str
    document_title: str
    document_content: str
    memory_enabled: bool
    current_note_id: str | None = None
    selected_text: str = ""
    current_section_id: str | None = None
    dirty: bool = False
    unsaved_content: str = ""


@dataclass(frozen=True)
class PreparedChatContext:
    document_title: str
    document_content: str
    memory_context: str
    context_event: dict | None


class AIApplicationService:
    def __init__(self) -> None:
        self.rag = configured_rag_service()
        self.memory = LegacyMemoryService()

    async def prepare_chat(self, user_id: str, request: ChatContextInput) -> PreparedChatContext:
        memory_context = await self.memory.context(
            user_id=user_id,
            requested=request.memory_enabled,
            query=request.question,
            scopes=["note_search", "note_generation", "note_editing", "learning"],
            memory_types=MEMORY_TYPES,
        )
        document_title = request.document_title
        document_content = request.document_content
        context_event = None

        if is_library_search_query(request.question):
            fallback_query = ""
            if request.current_note_id:
                async with AsyncSessionLocal() as session:
                    note = await NoteRepository(session).get_active(user_id, request.current_note_id)
                    if note is not None:
                        fallback_query = note.title
            result = await self.rag.retrieve(
                RagRequest(user_id=user_id, question=request.question, fallback_query=fallback_query)
            )
            document_title = "NoteFlow 本地笔记库"
            document_content = result.context_text
            context_event = {
                "type": "context",
                "contextMode": result.context_mode,
                "sources": result.sources,
            }
        elif request.current_note_id:
            result = await self.rag.retrieve(
                RagRequest(
                    user_id=user_id,
                    question=request.question,
                    note_id=request.current_note_id,
                    selected_text=request.selected_text,
                    unsaved_content=request.unsaved_content if request.dirty else "",
                    current_section_id=request.current_section_id,
                )
            )
            async with AsyncSessionLocal() as session:
                note = await NoteRepository(session).get_active(user_id, request.current_note_id)
            if note is None:
                raise LookupError("note not found")
            document_title = note.title
            document_content = result.context_text
            context_event = {
                "type": "context",
                "contextMode": result.context_mode,
                "sources": result.sources,
            }

        return PreparedChatContext(document_title, document_content, memory_context, context_event)

    async def note_generation_memory(
        self,
        *,
        user_id: str,
        requested: bool,
        topic: str,
        extra_request: str,
    ) -> str:
        return await self.memory.context(
            user_id=user_id,
            requested=requested,
            query=f"{topic} {extra_request}",
            scopes=["note_generation", "learning"],
            memory_types=MEMORY_TYPES,
        )
