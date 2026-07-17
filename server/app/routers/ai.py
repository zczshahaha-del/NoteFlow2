from __future__ import annotations

import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select

from app.config import cfg
from app.database import AsyncSessionLocal
from app.deps import CurrentUser, redis_rate_limit
from app.models.db import Note
from app.services.ai import ChatRequest, ChatMessage, stream_chat, stream_note_generate
from app.services.note_library import (
    build_library_context,
    build_note_context,
    is_library_search_query,
    source_to_dict,
)
from app.services.memory import build_memory_context
from app.services.prompts import NoteGenerateRequest
from app.services.runtime_errors import public_error_message
from app.services.user_settings import is_user_memory_enabled

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["ai"])


class ChatMessageIn(BaseModel):
    role: str
    text: str


class ChatPageState(BaseModel):
    currentNoteId: Optional[str] = None
    selectedText: str = ""
    currentSectionId: Optional[str] = None
    dirty: bool = False
    unsavedContent: str = ""


class ChatPayload(BaseModel):
    question: str
    documentTitle: str = ""
    documentContent: str = ""
    history: list[ChatMessageIn] = []
    maxTokens: int = 0
    temperature: Optional[float] = None
    pageState: Optional[ChatPageState] = None
    memoryEnabled: bool = True


class NoteGeneratePayload(BaseModel):
    mode: str = "generate"
    topic: str = ""
    noteType: str = ""
    writingTone: str = ""
    noteFormat: str = ""
    headingLevel: str = ""
    includeCode: bool = False
    includeExercises: bool = False
    extraRequest: str = ""
    markdown: str = ""
    outlinePlan: str = ""
    maxTokens: int = 0
    temperature: Optional[float] = None
    memoryEnabled: bool = True


def _sse_format(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def _stream_error_event(message: str, code: str = "ai_stream_failed") -> dict:
    return {
        "type": "stream_error",
        "status": "failed",
        "code": code,
        "message": message,
    }


async def _effective_memory_enabled(user_id: str, requested: bool) -> bool:
    if not requested:
        return False
    async with AsyncSessionLocal() as session:
        return await is_user_memory_enabled(session, user_id)


@router.post("/chat")
async def chat(
    payload: ChatPayload,
    user: CurrentUser = Depends(redis_rate_limit("ai-chat", cfg.AI_RATE_LIMIT)),
):
    try:
        context_event: Optional[dict] = None
        document_title = payload.documentTitle
        document_content = payload.documentContent
        memory_context = ""
        memory_enabled = await _effective_memory_enabled(user.id, payload.memoryEnabled)

        if memory_enabled:
            async with AsyncSessionLocal() as session:
                memory_context = await build_memory_context(
                    session,
                    user.id,
                    query=payload.question,
                    scopes=["note_search", "note_generation", "note_editing", "learning"],
                    memory_types=["identity", "personal_info", "interest", "preference", "goal", "writing_style", "constraint", "workflow", "skill"],
                )

        page_state = payload.pageState
        if is_library_search_query(payload.question):
            async with AsyncSessionLocal() as session:
                fallback_query = ""
                if page_state and page_state.currentNoteId:
                    result = await session.execute(
                        select(Note).where(
                            Note.id == page_state.currentNoteId,
                            Note.user_id == user.id,
                            Note.deleted_at.is_(None),
                        )
                    )
                    note = result.scalar_one_or_none()
                    if note is not None:
                        fallback_query = note.title
                context = await build_library_context(
                    session,
                    user.id,
                    question=payload.question,
                    fallback_query=fallback_query,
                )
                document_title = "NoteFlow 本地笔记库"
                document_content = context.context_text
                context_event = {
                    "type": "context",
                    "contextMode": context.context_mode,
                    "sources": [source_to_dict(source) for source in context.sources],
                }
        elif page_state and page_state.currentNoteId:
            async with AsyncSessionLocal() as session:
                result = await session.execute(
                    select(Note).where(
                        Note.id == page_state.currentNoteId,
                        Note.user_id == user.id,
                        Note.deleted_at.is_(None),
                    )
                )
                note = result.scalar_one_or_none()
                if note is None:
                    raise HTTPException(status_code=404, detail="note not found")
                context = await build_note_context(
                    session,
                    user.id,
                    note,
                    question=payload.question,
                    selected_text=page_state.selectedText,
                    unsaved_content=page_state.unsavedContent if page_state.dirty else "",
                    current_section_id=page_state.currentSectionId,
                )
                document_title = note.title
                document_content = context.context_text
                context_event = {
                    "type": "context",
                    "contextMode": context.context_mode,
                    "sources": [source_to_dict(source) for source in context.sources],
                }

        chat_req = ChatRequest(
            question=payload.question,
            documentTitle=document_title,
            documentContent=document_content,
            memoryContext=memory_context,
            history=[ChatMessage(role=m.role, text=m.text) for m in payload.history],
            maxTokens=payload.maxTokens,
            temperature=payload.temperature,
        )

        async def _stream():
            if context_event:
                yield _sse_format(context_event)
            try:
                async for chunk in stream_chat(chat_req):
                    yield _sse_format(chunk)
            except ValueError as e:
                if "not configured" in str(e).lower():
                    yield _sse_format(_stream_error_event("AI 服务还没有配置好，暂时不能生成回复。", "ai_not_configured"))
                else:
                    yield _sse_format(_stream_error_event(public_error_message(e)))
                yield "data: [DONE]\n\n"
                return
            except Exception as e:
                yield _sse_format(_stream_error_event(public_error_message(e)))
                yield "data: [DONE]\n\n"
                return
            yield "data: [DONE]\n\n"

        return StreamingResponse(
            _stream(),
            media_type="text/event-stream; charset=utf-8",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )
    except ValueError as e:
        if "not configured" in str(e).lower():
            raise HTTPException(status_code=503, detail=public_error_message(e))
        raise HTTPException(status_code=400, detail=public_error_message(e))


@router.post("/notes/generate")
async def generate_note(
    payload: NoteGeneratePayload,
    user: CurrentUser = Depends(redis_rate_limit("ai-note", cfg.AI_RATE_LIMIT)),
):
    try:
        memory_context = ""
        memory_enabled = await _effective_memory_enabled(user.id, payload.memoryEnabled)
        if memory_enabled:
            async with AsyncSessionLocal() as session:
                memory_context = await build_memory_context(
                    session,
                    user.id,
                    query=f"{payload.topic} {payload.extraRequest}",
                    scopes=["note_generation", "learning"],
                    memory_types=["identity", "personal_info", "interest", "preference", "goal", "writing_style", "constraint", "workflow", "skill"],
                )

        note_req = NoteGenerateRequest(
            mode=payload.mode,
            topic=payload.topic,
            noteType=payload.noteType,
            writingTone=payload.writingTone,
            noteFormat=payload.noteFormat,
            headingLevel=payload.headingLevel,
            includeCode=payload.includeCode,
            includeExercises=payload.includeExercises,
            extraRequest=payload.extraRequest,
            memoryContext=memory_context,
            markdown=payload.markdown,
            outlinePlan=payload.outlinePlan,
            maxTokens=payload.maxTokens,
            temperature=payload.temperature,
        )

        async def _stream():
            try:
                async for chunk in stream_note_generate(note_req):
                    yield _sse_format(chunk)
            except ValueError as e:
                if "not configured" in str(e).lower():
                    yield _sse_format(_stream_error_event("AI 服务还没有配置好，暂时不能生成回复。", "ai_not_configured"))
                else:
                    yield _sse_format(_stream_error_event(public_error_message(e)))
                yield "data: [DONE]\n\n"
                return
            except Exception as e:
                yield _sse_format(_stream_error_event(public_error_message(e)))
                yield "data: [DONE]\n\n"
                return
            yield "data: [DONE]\n\n"

        return StreamingResponse(
            _stream(),
            media_type="text/event-stream; charset=utf-8",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )
    except ValueError as e:
        if "not configured" in str(e).lower():
            raise HTTPException(status_code=503, detail=public_error_message(e))
        raise HTTPException(status_code=400, detail=public_error_message(e))
