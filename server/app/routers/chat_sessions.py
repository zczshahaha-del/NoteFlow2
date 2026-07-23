from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.deps import CurrentUser, get_current_user
from app.models.db import AgentCheckpoint, ChatMessage, ChatSession
from app.schemas.agent import ChatSessionCreatePayload, ChatSessionUpdatePayload


router = APIRouter(prefix="/chat-sessions", tags=["chat-sessions"])


def _session_out(session: ChatSession) -> dict:
    return {
        "id": session.id,
        "title": session.title,
        "status": session.status,
        "currentNoteId": session.current_note_id,
        "createdAt": session.created_at.isoformat() if session.created_at else None,
        "updatedAt": session.updated_at.isoformat() if session.updated_at else None,
        "lastMessageAt": session.last_message_at.isoformat() if session.last_message_at else None,
    }


def _draft_card_out(checkpoint: AgentCheckpoint) -> dict:
    payload = dict(checkpoint.payload or {})
    return {
        "seed": str(payload.get("seed") or "AI 笔记草稿"),
        "checkpointId": checkpoint.id,
        "draftId": payload.get("draftId"),
        "status": checkpoint.status,
    }


def _message_out(message: ChatMessage, draft_cards_by_run_id: dict[str, dict] | None = None) -> dict:
    metadata = dict(message.metadata_json or {})
    persisted_card = metadata.get("draftCard") if isinstance(metadata.get("draftCard"), dict) else None
    checkpoint_card = (draft_cards_by_run_id or {}).get(message.run_id or "")
    draft_card = (
        {**(persisted_card or {}), **checkpoint_card}
        if persisted_card or checkpoint_card
        else None
    )
    return {
        "id": message.id,
        "role": message.role,
        "text": message.text,
        "chatMode": metadata.get("chatMode"),
        "attachedSelection": metadata.get("attachedSelection"),
        "contextMode": message.context_mode,
        "sources": list(message.sources or []),
        "agentSessionId": message.session_id,
        "agentRunId": message.run_id,
        "draftCard": draft_card,
        "createdAt": message.created_at.isoformat() if message.created_at else None,
    }


async def _owned_session(user_id: str, session_id: str) -> ChatSession:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(ChatSession).where(
                ChatSession.id == session_id,
                ChatSession.user_id == user_id,
                ChatSession.archived_at.is_(None),
            )
        )
        session = result.scalar_one_or_none()
        if session is None:
            raise HTTPException(status_code=404, detail="chat session not found")
        return session


@router.get("")
async def list_chat_sessions(
    limit: int = 60,
    user: CurrentUser = Depends(get_current_user),
):
    safe_limit = max(1, min(limit, 200))
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(ChatSession)
            .where(
                ChatSession.user_id == user.id,
                ChatSession.archived_at.is_(None),
            )
            .order_by(ChatSession.last_message_at.desc(), ChatSession.updated_at.desc())
            .limit(safe_limit)
        )
        return {"sessions": [_session_out(item) for item in result.scalars().all()]}


@router.post("")
async def create_chat_session(
    payload: ChatSessionCreatePayload,
    user: CurrentUser = Depends(get_current_user),
):
    now = datetime.utcnow()
    session = ChatSession(
        id=uuid.uuid4().hex,
        user_id=user.id,
        title="新对话",
        status="active",
        current_note_id=payload.currentNoteId,
        created_at=now,
        updated_at=now,
    )
    async with AsyncSessionLocal() as db:
        db.add(session)
        await db.commit()
        await db.refresh(session)
    return {"session": _session_out(session)}


@router.get("/{session_id}/messages")
async def list_chat_messages(
    session_id: str,
    before: Optional[datetime] = None,
    limit: int = 300,
    user: CurrentUser = Depends(get_current_user),
):
    await _owned_session(user.id, session_id)
    safe_limit = max(1, min(limit, 500))
    async with AsyncSessionLocal() as db:
        statement = select(ChatMessage).where(
            ChatMessage.session_id == session_id,
            ChatMessage.user_id == user.id,
        )
        if before is not None:
            statement = statement.where(ChatMessage.created_at < before)
        result = await db.execute(
            statement.order_by(ChatMessage.created_at.desc()).limit(safe_limit)
        )
        messages = list(reversed(result.scalars().all()))
        run_ids = [message.run_id for message in messages if message.run_id]
        draft_cards_by_run_id: dict[str, dict] = {}
        if run_ids:
            checkpoint_result = await db.execute(
                select(AgentCheckpoint)
                .where(
                    AgentCheckpoint.session_id == session_id,
                    AgentCheckpoint.user_id == user.id,
                    AgentCheckpoint.run_id.in_(run_ids),
                    AgentCheckpoint.checkpoint_type == "draft_workspace",
                )
                .order_by(AgentCheckpoint.created_at)
            )
            for checkpoint in checkpoint_result.scalars().all():
                draft_cards_by_run_id[checkpoint.run_id] = _draft_card_out(checkpoint)
    return {
        "messages": [_message_out(message, draft_cards_by_run_id) for message in messages],
        "hasMore": len(messages) == safe_limit,
    }


@router.patch("/{session_id}")
async def update_chat_session(
    session_id: str,
    payload: ChatSessionUpdatePayload,
    user: CurrentUser = Depends(get_current_user),
):
    title = " ".join(payload.title.split()).strip()
    if not title:
        raise HTTPException(status_code=422, detail="chat title is required")
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(ChatSession).where(
                ChatSession.id == session_id,
                ChatSession.user_id == user.id,
                ChatSession.archived_at.is_(None),
            )
        )
        session = result.scalar_one_or_none()
        if session is None:
            raise HTTPException(status_code=404, detail="chat session not found")
        session.title = title[:255]
        session.updated_at = datetime.utcnow()
        await db.commit()
        await db.refresh(session)
        return {"session": _session_out(session)}


@router.delete("/{session_id}")
async def delete_chat_session(
    session_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(ChatSession).where(
                ChatSession.id == session_id,
                ChatSession.user_id == user.id,
                ChatSession.archived_at.is_(None),
            )
        )
        session = result.scalar_one_or_none()
        if session is None:
            raise HTTPException(status_code=404, detail="chat session not found")
        session.status = "archived"
        session.archived_at = datetime.utcnow()
        session.updated_at = session.archived_at
        await db.commit()
    return {"deleted": True}
