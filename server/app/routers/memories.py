from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.deps import CurrentUser, get_current_user
from app.models.db import UserMemory
from app.services.ai import ChatMessage
from app.services.memory import (
    add_memory_event,
    build_memory_context,
    clamp_importance,
    extract_memory_candidates,
    find_memories,
    mark_memories_used,
    memory_canonical_key,
    memory_layer,
    memory_layer_tags,
    memory_value,
    normalize_memory_layer,
    normalize_memory_type,
    normalize_scope,
)
from app.services.memory_llm import extract_memory_candidates_smart
from app.utils import random_id

router = APIRouter(tags=["memories"])


class MemoryPayload(BaseModel):
    memoryType: str = "preference"
    content: str
    importance: int = 3
    confidence: Optional[float] = None
    source: str = "user_explicit"
    scope: str = "global"
    tags: list[str] = []


class MemoryUpdatePayload(BaseModel):
    memoryType: Optional[str] = None
    content: Optional[str] = None
    importance: Optional[int] = None
    confidence: Optional[float] = None
    source: Optional[str] = None
    scope: Optional[str] = None
    tags: Optional[list[str]] = None
    status: Optional[str] = None
    reason: str = "user_update"


class MemorySearchPayload(BaseModel):
    query: str = ""
    memoryTypes: list[str] = []
    scopes: list[str] = []
    limit: int = 8


class MemoryExtractPayload(BaseModel):
    text: str
    context: str = "global"
    history: list[dict] = []


def _dt(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _memory_out(memory: UserMemory) -> dict:
    return {
        "id": memory.id,
        "memoryType": memory.memory_type,
        "content": memory.content,
        "canonicalKey": memory_canonical_key(memory),
        "value": memory_value(memory),
        "layer": memory_layer(memory),
        "importance": memory.importance,
        "confidence": memory.confidence,
        "source": memory.source,
        "scope": memory.scope,
        "tags": memory.tags or [],
        "status": memory.status,
        "lastUsedAt": _dt(memory.last_used_at),
        "accessCount": memory.access_count,
        "createdAt": _dt(memory.created_at),
        "updatedAt": _dt(memory.updated_at),
        "deletedAt": _dt(memory.deleted_at),
    }


def _candidate_out(candidate) -> dict:
    return {
        "memoryType": candidate.memory_type,
        "content": candidate.content,
        "canonicalKey": candidate.canonical_key,
        "value": candidate.value,
        "layer": candidate.layer,
        "importance": candidate.importance,
        "confidence": candidate.confidence,
        "shouldSave": candidate.should_save,
        "source": candidate.source,
        "scope": candidate.scope,
        "tags": candidate.tags,
        "stability": getattr(candidate, "stability", ""),
        "subject": getattr(candidate, "subject", ""),
        "temporalScope": getattr(candidate, "temporal_scope", ""),
        "operation": getattr(candidate, "operation", ""),
        "reason": getattr(candidate, "reason", ""),
    }


async def _get_memory(session, user_id: str, memory_id: str) -> UserMemory:
    result = await session.execute(
        select(UserMemory).where(UserMemory.id == memory_id, UserMemory.user_id == user_id)
    )
    memory = result.scalar_one_or_none()
    if memory is None:
        raise HTTPException(status_code=404, detail="memory not found")
    return memory


@router.get("/memories")
async def list_memories(
    includeDeleted: bool = Query(False),
    memoryTypes: list[str] = Query(default=[]),
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        memories = await find_memories(
            session,
            user.id,
            memory_types=memoryTypes,
            include_deleted=includeDeleted,
            limit=50,
        )
        return {"memories": [_memory_out(memory) for memory in memories]}


@router.post("/memories/search")
async def search_memories(
    payload: MemorySearchPayload,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        memories = await find_memories(
            session,
            user.id,
            query=payload.query,
            memory_types=payload.memoryTypes,
            scopes=payload.scopes,
            limit=payload.limit,
        )
        active_memories = [memory for memory in memories if memory.status == "active"]
        await mark_memories_used(session, user.id, active_memories, reason="search_memory")
        await session.commit()
        return {"memories": [_memory_out(memory) for memory in active_memories]}


@router.post("/memories/extract")
async def extract_memory(
    payload: MemoryExtractPayload,
    user: CurrentUser = Depends(get_current_user),
):
    history = [
        ChatMessage(role=str(item.get("role") or "user"), text=str(item.get("text") or ""))
        for item in payload.history[-8:]
        if isinstance(item, dict)
    ]
    candidates = await extract_memory_candidates_smart(payload.text, payload.context, history)
    return {
        "candidates": [_candidate_out(candidate) for candidate in candidates],
        "reason": "" if candidates else "这更像临时要求或普通聊天，不适合作为长期记忆",
    }


@router.post("/memories")
async def create_memory(
    payload: MemoryPayload,
    user: CurrentUser = Depends(get_current_user),
):
    content = payload.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="content is required")

    async with AsyncSessionLocal() as session:
        memory_type = normalize_memory_type(payload.memoryType)
        memory = UserMemory(
            id=random_id(),
            user_id=user.id,
            memory_type=memory_type,
            content=content[:2000],
            importance=clamp_importance(payload.importance),
            confidence=payload.confidence,
            source=(payload.source or "user_explicit")[:50],
            scope=normalize_scope(payload.scope),
            tags=memory_layer_tags(normalize_memory_layer(None, memory_type), payload.tags),
            status="active",
        )
        session.add(memory)
        add_memory_event(
            session,
            memory=memory,
            user_id=user.id,
            event_type="created",
            new_content=memory.content,
            reason="save_memory",
        )
        await session.commit()
        await session.refresh(memory)
        return {"memory": _memory_out(memory)}


@router.put("/memories/{memory_id}")
async def update_memory(
    memory_id: str,
    payload: MemoryUpdatePayload,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        memory = await _get_memory(session, user.id, memory_id)
        old_content = memory.content

        if payload.memoryType is not None:
            memory.memory_type = normalize_memory_type(payload.memoryType)
        if payload.content is not None:
            content = payload.content.strip()
            if not content:
                raise HTTPException(status_code=400, detail="content is required")
            memory.content = content[:2000]
        if payload.importance is not None:
            memory.importance = clamp_importance(payload.importance)
        if payload.confidence is not None:
            memory.confidence = payload.confidence
        if payload.source is not None:
            memory.source = (payload.source or "user_explicit")[:50]
        if payload.scope is not None:
            memory.scope = normalize_scope(payload.scope)
        if payload.tags is not None:
            memory.tags = memory_layer_tags(normalize_memory_layer(None, memory.memory_type), payload.tags)
        elif payload.memoryType is not None:
            memory.tags = memory_layer_tags(normalize_memory_layer(None, memory.memory_type), memory.tags or [])
        if payload.status is not None:
            status = payload.status.strip()
            if status not in {"active", "pending", "archived", "deleted"}:
                raise HTTPException(status_code=400, detail="invalid status")
            memory.status = status
            memory.deleted_at = datetime.utcnow() if status == "deleted" else None

        add_memory_event(
            session,
            memory=memory,
            user_id=user.id,
            event_type="updated" if memory.status != "deleted" else "deleted",
            old_content=old_content,
            new_content=memory.content,
            reason=payload.reason,
        )
        await session.commit()
        await session.refresh(memory)
        return {"memory": _memory_out(memory)}


@router.delete("/memories/{memory_id}")
async def delete_memory(
    memory_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        memory = await _get_memory(session, user.id, memory_id)
        memory.status = "deleted"
        memory.deleted_at = datetime.utcnow()
        add_memory_event(
            session,
            memory=memory,
            user_id=user.id,
            event_type="deleted",
            old_content=memory.content,
            reason="delete_memory",
        )
        await session.commit()
        await session.refresh(memory)
        return {"memory": _memory_out(memory)}


@router.get("/memories/context")
async def get_memory_context(
    query: str = "",
    scopes: list[str] = Query(default=[]),
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        context = await build_memory_context(
            session,
            user.id,
            query=query,
            scopes=scopes,
        )
        return {"context": context}
