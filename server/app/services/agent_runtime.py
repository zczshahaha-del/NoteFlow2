from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.db import (
    AgentRun,
    AgentStep,
    AgentToolTrace,
    ChatMessage as DbChatMessage,
    ChatSession,
)
from app.schemas.agent import AgentChatPayload
from app.observability.context import current_trace
from app.services.observability import record_metric


def _new_id() -> str:
    return uuid.uuid4().hex


def _short(text: str, limit: int = 180) -> str:
    normalized = " ".join((text or "").split())
    return normalized if len(normalized) <= limit else normalized[:limit].rstrip() + "..."


def _session_title(question: str) -> str:
    return _short(question, 36) or "新对话"


async def start_agent_run(payload: AgentChatPayload, user_id: str, intent: str) -> dict:
    now = datetime.utcnow()
    trace = current_trace()
    async with AsyncSessionLocal() as db:
        chat_session: Optional[ChatSession] = None
        if payload.sessionId:
            result = await db.execute(
                select(ChatSession).where(
                    ChatSession.id == payload.sessionId,
                    ChatSession.user_id == user_id,
                    ChatSession.archived_at.is_(None),
                )
            )
            chat_session = result.scalar_one_or_none()

        if chat_session is None:
            chat_session = ChatSession(
                id=_new_id(),
                user_id=user_id,
                title=_session_title(payload.question),
                current_note_id=payload.pageState.currentNoteId if payload.pageState else None,
                last_message_at=now,
            )
            db.add(chat_session)
        else:
            chat_session.current_note_id = payload.pageState.currentNoteId if payload.pageState else None
            if chat_session.title == "新对话":
                chat_session.title = _session_title(payload.question)
            chat_session.last_message_at = now
            chat_session.updated_at = now

        run = AgentRun(
            id=_new_id(),
            session_id=chat_session.id,
            user_id=user_id,
            intent=intent,
            status="running",
            input_text=payload.question,
            started_at=now,
            request_id=trace.request_id or None,
            trace_id=trace.trace_id or None,
        )
        user_message = DbChatMessage(
            id=_new_id(),
            session_id=chat_session.id,
            user_id=user_id,
            run_id=run.id,
            role="user",
            text=payload.question,
            context_mode=payload.mode,
            metadata_json={
                "chatMode": payload.mode,
                "attachedSelection": {
                    "text": payload.pageState.selectedText,
                    "noteId": payload.pageState.currentNoteId,
                    "noteTitle": payload.documentTitle,
                }
                if payload.pageState and payload.pageState.selectedText
                else None,
            },
            created_at=now,
        )
        route_step = AgentStep(
            id=_new_id(),
            run_id=run.id,
            user_id=user_id,
            step_index=1,
            name="agent_router",
            status="success",
            input_summary=_short(payload.question),
            output_summary=f"intent={intent}",
            started_at=now,
            finished_at=now,
            trace_id=trace.trace_id or None,
        )
        db.add_all([run, user_message, route_step])
        await db.commit()
        record_metric("agent", "run_started")
        return {"session_id": chat_session.id, "run_id": run.id, "route_step_id": route_step.id, "trace_id": trace.trace_id}


async def record_tool_trace(
    *,
    user_id: str,
    run_id: str,
    step_id: Optional[str],
    tool_name: str,
    action: str,
    status: str,
    duration_ms: int,
    input_summary: str = "",
    output_summary: str = "",
    metadata: Optional[dict] = None,
) -> dict:
    context = current_trace()
    record_id = _new_id()
    async with AsyncSessionLocal() as db:
        db.add(
            AgentToolTrace(
                id=record_id,
                run_id=run_id,
                step_id=step_id,
                user_id=user_id,
                tool_name=tool_name,
                action=action,
                status=status,
                duration_ms=max(0, duration_ms),
                input_summary=_short(input_summary),
                output_summary=_short(output_summary),
                metadata_json=metadata or {},
                trace_id=context.trace_id or None,
            )
        )
        await db.commit()
    return {
        "type": "tool_trace",
        "id": record_id,
        "runId": run_id,
        "toolName": tool_name,
        "action": action,
        "status": status,
        "durationMs": max(0, duration_ms),
        "inputSummary": _short(input_summary),
        "outputSummary": _short(output_summary),
        "metadata": metadata or {},
        "traceId": context.trace_id or None,
    }


async def update_agent_run_intent(
    *,
    user_id: str,
    run_id: str,
    step_id: str,
    intent: str,
) -> None:
    async with AsyncSessionLocal() as db:
        run = await db.get(AgentRun, run_id)
        if run is not None and run.user_id == user_id:
            run.intent = intent
        step = await db.get(AgentStep, step_id)
        if step is not None and step.user_id == user_id:
            step.output_summary = f"intent={intent}"
        await db.commit()


async def finish_agent_run(
    *,
    user_id: str,
    session_id: str,
    run_id: str,
    status: str,
    answer: str,
    context_mode: Optional[str] = None,
    sources: Optional[list[dict]] = None,
    error_message: Optional[str] = None,
    message_metadata: Optional[dict] = None,
) -> None:
    now = datetime.utcnow()
    async with AsyncSessionLocal() as db:
        run = await db.get(AgentRun, run_id)
        if run is not None and run.user_id == user_id and run.status != "cancelled":
            run.status = status
            run.output_text = answer
            run.error_message = error_message
            run.finished_at = now

        result = await db.execute(
            select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == user_id)
        )
        chat_session = result.scalar_one_or_none()
        if chat_session is not None:
            chat_session.last_message_at = now
            chat_session.updated_at = now

        db.add(
            DbChatMessage(
                id=_new_id(),
                session_id=session_id,
                user_id=user_id,
                run_id=run_id,
                role="assistant",
                text=answer,
                context_mode=context_mode,
                sources=sources or [],
                metadata_json=message_metadata or {},
                created_at=now,
            )
        )
        await db.commit()
    record_metric("agent", "run_finished", status=status)
