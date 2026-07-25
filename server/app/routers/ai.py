from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from app.config import cfg
from app.deps import CurrentUser, redis_rate_limit
from app.services.ai import stream_note_generate
from app.services.ai_application import AIApplicationService
from app.services.prompts import NoteGenerateRequest
from app.services.runtime_errors import public_error_message
from app.agent.sse import encode_event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["ai"])


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
