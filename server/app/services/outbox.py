from __future__ import annotations

import time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import cfg
from app.models.db import IntegrationOutbox, MemoryShadowRun, Note, UserMemory
from app.memory.policy import memory_is_eligible
from app.providers.mem0 import get_mem0_provider
from app.observability.context import current_trace
from app.repositories.outbox import OutboxRepository
from app.utils import random_id


async def enqueue_memory_sync(
    session: AsyncSession, *, memory_id: str, user_id: str, operation: str, version: str,
) -> IntegrationOutbox:
    trace = current_trace()
    return await OutboxRepository(session).enqueue(
        topic="memory.sync.requested",
        aggregate_type="user_memory",
        aggregate_id=memory_id,
        user_id=user_id,
        payload={"memoryId": memory_id, "operation": operation},
        idempotency_key=f"memory:{memory_id}:{operation}:{version}",
        trace_id=trace.trace_id or None,
        max_attempts=cfg.OUTBOX_MAX_ATTEMPTS,
    )


async def dispatch_outbox(session: AsyncSession, item: IntegrationOutbox) -> None:
    if item.topic == "memory.sync.requested":
        if not item.user_id:
            return
        memory = await session.scalar(
            select(UserMemory).where(
                UserMemory.id == item.aggregate_id,
                UserMemory.user_id == item.user_id,
            )
        )
        if memory is None:
            return
        provider = get_mem0_provider()
        operation = str((item.payload or {}).get("operation") or "upsert")
        started = time.perf_counter()
        old_external_id = memory.external_id if memory.external_provider == "mem0" else None
        should_delete = operation == "delete" or not memory_is_eligible(memory)
        if old_external_id and (should_delete or operation == "upsert"):
            await provider.delete(user_id=memory.user_id, memory_id=old_external_id)
            memory.external_id = None
            memory.external_provider = None
        external_id = None
        if not should_delete:
            result = await provider.add(
                user_id=memory.user_id,
                content=memory.content,
                metadata={
                    "noteflow_memory_id": memory.id,
                    "canonical_key": memory.canonical_key or "",
                    "memory_type": memory.memory_type,
                    "scope": memory.scope,
                    "source": memory.source,
                },
            )
            external_id = str(result.get("id") or "") or None
            memory.external_provider = "mem0" if external_id else None
            memory.external_id = external_id
            memory.provider_metadata = {
                **(memory.provider_metadata or {}),
                "mem0Event": result.get("event"),
                "mem0SyncedAt": int(time.time()),
            }
        session.add(
            MemoryShadowRun(
                id=random_id(),
                user_id=memory.user_id,
                memory_id=memory.id,
                operation="delete" if should_delete else "write",
                legacy_ids=[memory.id],
                mem0_ids=[external_id] if external_id else [],
                overlap_ratio=1.0 if external_id else 0.0,
                latency_ms=int((time.perf_counter() - started) * 1000),
                status="success",
                details={"shadow": False},
            )
        )
        return
    if item.topic == "index.note.requested":
        note = await session.scalar(select(Note).where(Note.id == item.aggregate_id, Note.deleted_at.is_(None)))
        if note is None:
            return
        from app.services.markdown_index import create_index_job
        await create_index_job(session, note)
        from app.rag.pipeline.indexer import create_rag_index_job

        await create_rag_index_job(session, note)
        return
    raise ValueError(f"unsupported outbox topic: {item.topic}")
