from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from app.config import cfg
from app.deps import CurrentUser, get_current_user, redis_rate_limit
from app.memory.rollout import effective_memory_provider, mem0_shadow_selected
from app.models.db import UserMemory
from app.services.ai import ChatMessage
from app.services.memory import (
    memory_canonical_key,
    memory_layer,
    memory_value,
)
from app.services.memory_llm import extract_memory_candidates_smart
from app.services.memory_service import MemoryService

router = APIRouter(tags=["memories"])
memory_user = redis_rate_limit("memory", cfg.MEMORY_RATE_LIMIT)


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


@router.get("/memories")
async def list_memories(
    includeDeleted: bool = Query(False),
    memoryTypes: list[str] = Query(default=[]),
    user: CurrentUser = Depends(memory_user),
):
    memories = await MemoryService().list(user.id, memory_types=memoryTypes, include_deleted=includeDeleted)
    return {"memories": [_memory_out(memory) for memory in memories]}


@router.post("/memories/search")
async def search_memories(
    payload: MemorySearchPayload,
    user: CurrentUser = Depends(memory_user),
):
    memories = await MemoryService().search(
            user.id,
            query=payload.query,
            memory_types=payload.memoryTypes,
            scopes=payload.scopes,
            limit=payload.limit,
    )
    return {"memories": [_memory_out(memory) for memory in memories]}


@router.post("/memories/extract")
async def extract_memory(
    payload: MemoryExtractPayload,
    user: CurrentUser = Depends(memory_user),
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
    user: CurrentUser = Depends(memory_user),
):
    try:
        memory = await MemoryService().create(user.id, payload)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"memory": _memory_out(memory)}


@router.put("/memories/{memory_id}")
async def update_memory(
    memory_id: str,
    payload: MemoryUpdatePayload,
    user: CurrentUser = Depends(memory_user),
):
    try:
        memory = await MemoryService().update(user.id, memory_id, payload)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"memory": _memory_out(memory)}


@router.delete("/memories/{memory_id}")
async def delete_memory(
    memory_id: str,
    user: CurrentUser = Depends(memory_user),
):
    try:
        memory = await MemoryService().delete(user.id, memory_id)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return {"memory": _memory_out(memory)}


@router.get("/memories/context")
async def get_memory_context(
    query: str = "",
    scopes: list[str] = Query(default=[]),
    user: CurrentUser = Depends(memory_user),
):
    context = await MemoryService().context(user.id, query=query, scopes=scopes)
    return {"context": context}


@router.get("/memories/provider")
async def get_memory_provider(user: CurrentUser = Depends(memory_user)):
    return {
        "provider": effective_memory_provider(user.id),
        "configuredProvider": cfg.MEMORY_PROVIDER,
        "shadow": mem0_shadow_selected(user.id),
        "memoryEnabledByDefault": True,
    }
