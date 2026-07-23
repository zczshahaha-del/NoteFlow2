from __future__ import annotations

import hashlib
import time

from sqlalchemy import select

from app.config import cfg
from app.memory.policy import filter_eligible_memories
from app.memory.rollout import effective_memory_provider, mem0_shadow_selected
from app.models.db import MemoryShadowRun, UserMemory
from app.providers.mem0 import get_mem0_provider
from app.services.observability import record_metric
from app.utils import random_id


def _noteflow_id(item: dict) -> str:
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    return str(
        metadata.get("noteflow_memory_id")
        or item.get("noteflow_memory_id")
        or item.get("noteflowMemoryId")
        or ""
    )


async def resolve_memory_read(
    session,
    *,
    user_id: str,
    query: str,
    legacy_memories: list[UserMemory],
    limit: int,
) -> list[UserMemory]:
    legacy = filter_eligible_memories(legacy_memories, limit=limit)
    provider = effective_memory_provider(user_id)
    shadow = mem0_shadow_selected(user_id)
    if provider != "mem0" and not shadow:
        return legacy

    started = time.perf_counter()
    status, error_code = "success", None
    mem0_rows: list[dict] = []
    try:
        mem0_rows = await get_mem0_provider().search(user_id=user_id, query=query, limit=limit)
    except Exception as exc:
        status, error_code = "failed", type(exc).__name__
        record_metric("memory", "mem0_read", status="failed")

    legacy_ids = [memory.id for memory in legacy]
    mem0_ids = [memory_id for row in mem0_rows if (memory_id := _noteflow_id(row))]
    allowed_ids = set(legacy_ids)
    hard_violation = any(memory_id not in allowed_ids for memory_id in mem0_ids)
    overlap = len(allowed_ids.intersection(mem0_ids)) / max(1, len(allowed_ids.union(mem0_ids)))
    session.add(
        MemoryShadowRun(
            id=random_id(),
            user_id=user_id,
            operation="read",
            query_hash=hashlib.sha256(query.encode()).hexdigest(),
            legacy_ids=legacy_ids,
            mem0_ids=mem0_ids,
            overlap_ratio=overlap,
            latency_ms=int((time.perf_counter() - started) * 1000),
            hard_violation=hard_violation,
            status=status,
            error_code=error_code,
            details={"effectiveProvider": provider, "shadow": shadow, "resultCount": len(mem0_rows)},
        )
    )
    record_metric("memory", "mem0_read", status=status)

    # Shadow never changes the user-visible answer. A Mem0 canary may only select
    # rows that remain active and eligible in NoteFlow's own projection.
    if provider != "mem0":
        return legacy
    if status != "success":
        return []
    ordered_ids = [memory_id for memory_id in mem0_ids if memory_id in allowed_ids]
    if not ordered_ids:
        return []
    rows = await session.execute(
        select(UserMemory).where(UserMemory.user_id == user_id, UserMemory.id.in_(ordered_ids))
    )
    mapped = {memory.id: memory for memory in rows.scalars().all()}
    return filter_eligible_memories([mapped[item] for item in ordered_ids if item in mapped], limit=limit)
