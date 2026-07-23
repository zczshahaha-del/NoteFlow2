from __future__ import annotations

import hashlib
import json
from datetime import datetime

from app.database import AsyncSessionLocal
from app.models.db import UserMemory
from app.repositories.memories import MemoryRepository
from app.services.memory import (
    add_memory_event,
    build_memory_context,
    clamp_importance,
    find_memories,
    mark_memories_used,
    memory_layer_tags,
    normalize_memory_layer,
    normalize_memory_type,
    normalize_scope,
)
from app.utils import random_id
from app.services.outbox import enqueue_memory_sync
from app.workers.outbox_worker import notify_outbox_worker
from app.services.observability import record_metric
from app.memory.policy import classify_memory_content


class MemoryService:
    @staticmethod
    def _sync_version(memory: UserMemory) -> str:
        value = {
            "status": memory.status, "content": memory.content,
            "type": memory.memory_type, "importance": memory.importance,
            "confidence": memory.confidence, "scope": memory.scope,
            "tags": memory.tags or [], "canonicalKey": memory.canonical_key,
            "layer": memory.memory_layer,
            "expiresAt": memory.expires_at.isoformat() if memory.expires_at else None,
        }
        return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:32]

    async def list(self, user_id: str, *, memory_types: list[str], include_deleted: bool) -> list[UserMemory]:
        async with AsyncSessionLocal() as session:
            return await find_memories(
                session,
                user_id,
                memory_types=memory_types,
                include_deleted=include_deleted,
                limit=50,
            )

    async def search(
        self,
        user_id: str,
        *,
        query: str,
        memory_types: list[str],
        scopes: list[str],
        limit: int,
    ) -> list[UserMemory]:
        async with AsyncSessionLocal() as session:
            memories = await find_memories(
                session,
                user_id,
                query=query,
                memory_types=memory_types,
                scopes=scopes,
                limit=limit,
            )
            active = [memory for memory in memories if memory.status == "active"]
            await mark_memories_used(session, user_id, active, reason="search_memory")
            await session.commit()
            return active

    async def create(self, user_id: str, payload) -> UserMemory:
        content = payload.content.strip()
        if not content:
            raise ValueError("content is required")
        decision = classify_memory_content(content)
        if not decision.allowed:
            raise ValueError(f"memory rejected by safety policy: {decision.reason}")
        async with AsyncSessionLocal() as session:
            memory_type = normalize_memory_type(payload.memoryType)
            memory = UserMemory(
                id=random_id(),
                user_id=user_id,
                memory_type=memory_type,
                content=content[:2000],
                importance=clamp_importance(payload.importance),
                confidence=payload.confidence,
                source=(payload.source or "user_explicit")[:50],
                scope=normalize_scope(payload.scope),
                tags=memory_layer_tags(normalize_memory_layer(None, memory_type), payload.tags),
                status="active",
                memory_layer=normalize_memory_layer(None, memory_type),
                canonical_key=f"{memory_type}.general",
            )
            session.add(memory)
            add_memory_event(session, memory=memory, user_id=user_id, event_type="created", new_content=memory.content, reason="save_memory")
            await session.flush()
            await enqueue_memory_sync(
                session, memory_id=memory.id, user_id=user_id,
                operation="upsert", version=self._sync_version(memory),
            )
            await session.commit()
            notify_outbox_worker()
            record_metric("memory", "create")
            await session.refresh(memory)
            return memory

    async def update(self, user_id: str, memory_id: str, payload) -> UserMemory:
        async with AsyncSessionLocal() as session:
            memory = await MemoryRepository(session).get(user_id, memory_id)
            if memory is None:
                raise LookupError("memory not found")
            old_content = memory.content
            if payload.memoryType is not None:
                memory.memory_type = normalize_memory_type(payload.memoryType)
            if payload.content is not None:
                content = payload.content.strip()
                if not content:
                    raise ValueError("content is required")
                decision = classify_memory_content(content)
                if not decision.allowed:
                    raise ValueError(f"memory rejected by safety policy: {decision.reason}")
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
            memory.memory_layer = normalize_memory_layer(None, memory.memory_type)
            memory.canonical_key = memory.canonical_key or f"{memory.memory_type}.general"
            if payload.status is not None:
                status = payload.status.strip()
                if status not in {"active", "pending", "archived", "deleted"}:
                    raise ValueError("invalid status")
                memory.status = status
                memory.deleted_at = datetime.utcnow() if status == "deleted" else None
            add_memory_event(
                session,
                memory=memory,
                user_id=user_id,
                event_type="updated" if memory.status != "deleted" else "deleted",
                old_content=old_content,
                new_content=memory.content,
                reason=payload.reason,
            )
            await enqueue_memory_sync(
                session, memory_id=memory.id, user_id=user_id,
                operation="delete" if memory.status == "deleted" else "upsert",
                version=self._sync_version(memory),
            )
            await session.commit()
            notify_outbox_worker()
            record_metric("memory", "update")
            await session.refresh(memory)
            return memory

    async def delete(self, user_id: str, memory_id: str) -> UserMemory:
        async with AsyncSessionLocal() as session:
            memory = await MemoryRepository(session).get(user_id, memory_id)
            if memory is None:
                raise LookupError("memory not found")
            memory.status = "deleted"
            memory.deleted_at = datetime.utcnow()
            add_memory_event(
                session,
                memory=memory,
                user_id=user_id,
                event_type="deleted",
                old_content=memory.content,
                reason="delete_memory",
            )
            await enqueue_memory_sync(
                session, memory_id=memory.id, user_id=user_id,
                operation="delete", version=self._sync_version(memory),
            )
            await session.commit()
            notify_outbox_worker()
            record_metric("memory", "delete")
            await session.refresh(memory)
            return memory

    async def context(self, user_id: str, *, query: str, scopes: list[str]) -> str:
        async with AsyncSessionLocal() as session:
            return await build_memory_context(session, user_id, query=query, scopes=scopes)
