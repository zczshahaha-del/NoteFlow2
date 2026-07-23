from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from app.config import cfg
from app.deps import CurrentUser, redis_rate_limit
from app.providers.contracts import ChatProviderRequest, ProviderChatMessage
from app.providers.registry import legacy_provider_registry
from app.services.ai import stream_note_generate
from app.services.ai_application import AIApplicationService, ChatContextInput
from app.services.prompts import NoteGenerateRequest
from app.services.runtime_errors import public_error_message
from app.agent.sse import encode_event

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
    return encode_event(data)


def _stream_error_event(message: str, code: str = "ai_stream_failed") -> dict:
    return {
        "type": "stream_error",
        "status": "failed",
        "code": code,
        "message": message,
    }


@router.post("/chat")
async def chat(
    payload: ChatPayload,
    user: CurrentUser = Depends(redis_rate_limit("ai-chat", cfg.AI_RATE_LIMIT)),
):
    try:
        page_state = payload.pageState
        prepared = await AIApplicationService().prepare_chat(
            user.id,
            ChatContextInput(
                question=payload.question,
                document_title=payload.documentTitle,
                document_content=payload.documentContent,
                memory_enabled=payload.memoryEnabled,
                current_note_id=page_state.currentNoteId if page_state else None,
                selected_text=page_state.selectedText if page_state else "",
                current_section_id=page_state.currentSectionId if page_state else None,
                dirty=page_state.dirty if page_state else False,
                unsaved_content=page_state.unsavedContent if page_state else "",
            ),
        )
        chat_req = ChatProviderRequest(
            question=payload.question,
            document_title=prepared.document_title,
            document_content=prepared.document_content,
            memory_context=prepared.memory_context,
            history=[ProviderChatMessage(role=m.role, text=m.text) for m in payload.history],
            max_tokens=payload.maxTokens,
            temperature=payload.temperature,
        )
        chat_provider = legacy_provider_registry().chat

        async def _stream():
            if prepared.context_event:
                yield _sse_format(prepared.context_event)
            try:
                async for chunk in chat_provider.stream(chat_req):
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
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
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
        memory_context = await AIApplicationService().note_generation_memory(
            user_id=user.id,
            requested=payload.memoryEnabled,
            topic=payload.topic,
            extra_request=payload.extraRequest,
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
