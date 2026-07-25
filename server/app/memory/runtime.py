from __future__ import annotations

import hashlib
import time

from app.config import cfg
from app.memory.policy import filter_eligible_memories
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
    candidate_memories: list[UserMemory],
    limit: int,
) -> list[UserMemory]:
    candidates = filter_eligible_memories(candidate_memories, limit=limit)
    candidate_ids = [memory.id for memory in candidates]
    metadata_filters: dict[str, str] = {}
    if len(candidate_ids) == 1:
        # The structured read planner has already narrowed this request to one
        # policy-approved record (for example identity.name). Restrict Mem0 to
        # that projection so unrelated episodic memories cannot crowd it out.
        metadata_filters["noteflow_memory_id"] = candidate_ids[0]
    else:
        canonical_keys = {
            str(memory.canonical_key or "").strip()
            for memory in candidates
            if str(memory.canonical_key or "").strip()
        }
        if len(canonical_keys) == 1:
            metadata_filters["canonical_key"] = next(iter(canonical_keys))

    started = time.perf_counter()
    status, error_code = "success", None
    mem0_rows: list[dict] = []
    try:
        if candidate_ids:
            mem0_rows = await get_mem0_provider().search(
                user_id=user_id,
                query=query,
                limit=limit,
                metadata_filters=metadata_filters,
            )
    except Exception as exc:
        status, error_code = "failed", type(exc).__name__
        record_metric("memory", "mem0_read", status="failed")

    mem0_ids = [memory_id for row in mem0_rows if (memory_id := _noteflow_id(row))]
    allowed_ids = set(candidate_ids)
    hard_violation = any(memory_id not in allowed_ids for memory_id in mem0_ids)
    overlap = len(allowed_ids.intersection(mem0_ids)) / max(1, len(allowed_ids.union(mem0_ids)))
    session.add(
        MemoryShadowRun(
            id=random_id(),
            user_id=user_id,
            operation="read",
            query_hash=hashlib.sha256(query.encode()).hexdigest(),
            legacy_ids=candidate_ids,
            mem0_ids=mem0_ids,
            overlap_ratio=overlap,
            latency_ms=int((time.perf_counter() - started) * 1000),
            hard_violation=hard_violation,
            status=status,
            error_code=error_code,
            details={"effectiveProvider": "mem0", "shadow": False, "resultCount": len(mem0_rows)},
        )
    )
    record_metric("memory", "mem0_read", status=status)

    # Mem0 ranks the already policy-approved relational projection. It must
    # never turn a safe, structured read into "no memory" merely because an
    # embedding query ranked unrelated records above the requested fields.
    mapped = {memory.id: memory for memory in candidates}
    ordered_ids = []
    if status == "success":
        ordered_ids = [
            memory_id
            for memory_id in mem0_ids
            if memory_id in allowed_ids and memory_id not in ordered_ids
        ]
    ordered_ids.extend(memory_id for memory_id in candidate_ids if memory_id not in ordered_ids)
    if not ordered_ids:
        return []
    if status != "success" or not allowed_ids.intersection(mem0_ids):
        record_metric("memory", "mem0_read_fallback", status="success")
    return filter_eligible_memories(
        [mapped[memory_id] for memory_id in ordered_ids if memory_id in mapped],
        limit=limit,
    )
