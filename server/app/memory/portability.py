"""Prepare an account's governed Hindsight facts for NoteFlow-owned storage."""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.memory.control import lock_owner
from app.memory.domain import normalize_memory_layer, normalize_memory_type, normalize_scope
from app.memory.engine import MemoryEngine, MemoryRecord
from app.memory.gateway import record
from app.memory.policy import classify_memory_content
from app.models.db import IntegrationOutbox, MemorySource, User, UserMemory


def is_hindsight_copy(memory: UserMemory) -> bool:
    return memory.id.startswith("hsp-")


@dataclass(frozen=True)
class MemoryTransferReport:
    fingerprint: str
    active: int
    archived: int
    pending: int
    already_staged: int
    legacy_conflicts: int
    ignored_facts: int
    staged: int


def _portable_id(user_id: str, source_id: str, fact_id: str) -> str:
    key = json.dumps([user_id, source_id, fact_id], ensure_ascii=False)
    return "hsp-" + hashlib.sha256(key.encode("utf-8")).hexdigest()[:60]


def _utc(value: datetime | None) -> datetime | None:
    if value is None or value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _matches(row: UserMemory, fact: MemoryRecord) -> bool:
    return (
        row.content == fact.content
        and row.status == fact.status
        and row.deleted_at is None
        and row.source_ref == fact.source_ref
        and row.memory_type == fact.memory_type
        and row.scope == fact.scope
        and row.source == fact.source
        and row.canonical_key == fact.canonical_key
        and row.memory_layer == fact.memory_layer
        and row.tags == fact.tags
    )


async def stage_hindsight_memories(
    session: AsyncSession,
    *,
    user_id: str,
    engine: MemoryEngine,
    expected_fingerprint: str | None = None,
) -> MemoryTransferReport:
    """Without a fingerprint, read only. The caller owns the transaction."""
    if engine.name != "hindsight":
        raise ValueError("Hindsight is required as the source")
    if not user_id or await session.get(User, user_id) is None:
        raise LookupError("Memory account not found")

    # Keep managed writes, curation and source deletion out of this snapshot.
    await lock_owner(session, user_id)
    pending = await session.scalar(
        select(IntegrationOutbox.id).where(
            IntegrationOutbox.user_id == user_id,
            IntegrationOutbox.topic.in_(["memory.retain.requested", "memory.source.delete"]),
            IntegrationOutbox.status.in_(["pending", "processing", "memory_pending", "memory_processing", "dead"]),
        ).limit(1)
    )
    if pending is not None:
        raise ValueError("Finish or resolve outstanding Hindsight memory jobs before staging")

    sources = {
        source.id: source for source in (await session.scalars(
            select(MemorySource).where(
                MemorySource.user_id == user_id, MemorySource.status == "stored",
                MemorySource.engine == engine.name,
            )
        )).all()
    }
    records: dict[str, MemoryRecord] = {}
    seen_sources: set[str] = set()
    ignored = 0
    for fact in (await engine.list(user_id) if sources else []):
        source = sources.get(fact.source_id)
        if source is None or fact.derived:
            ignored += 1
            continue
        seen_sources.add(source.id)
        if fact.id in (source.metadata_json or {}).get("hiddenIds", []):
            ignored += 1
            continue
        if not fact.id or fact.status not in {"active", "archived"}:
            raise ValueError("Hindsight returned a published fact with an unknown ID or state")
        if not classify_memory_content(fact.content).allowed:
            ignored += 1
            continue
        item = record(fact, source, provider=engine.name)
        item.id = _portable_id(user_id, source.id, fact.id)
        item.memory_type = normalize_memory_type(item.memory_type)
        if normalize_scope(item.scope) != item.scope:
            raise ValueError("A memory uses an unknown scope; review it before staging")
        item.memory_layer = normalize_memory_layer(item.memory_layer, item.memory_type)
        item.created_at = _utc(item.created_at)
        item.updated_at = _utc(item.updated_at)
        if item.id in records and records[item.id] != item:
            raise ValueError("Hindsight returned conflicting versions of a published fact")
        records[item.id] = item
    if sources.keys() - seen_sources:
        raise ValueError("A published source is missing from Hindsight; staging would be incomplete")

    existing = (await session.scalars(select(UserMemory).where(UserMemory.user_id == user_id))).all()
    matched: set[str] = set()
    legacy_conflicts = 0
    for row in existing:
        if is_hindsight_copy(row) and row.id in records and _matches(row, records[row.id]):
            matched.add(row.id)
        elif is_hindsight_copy(row) or (row.status != "deleted" and row.deleted_at is None):
            legacy_conflicts += 1

    snapshot = [asdict(records[key]) for key in sorted(records)]
    body = json.dumps({"owner": user_id, "records": snapshot, "ignored": ignored},
                      ensure_ascii=False, sort_keys=True, default=str)
    fingerprint = hashlib.sha256(body.encode("utf-8")).hexdigest()
    staged = 0
    if expected_fingerprint is not None:
        if expected_fingerprint != fingerprint:
            raise ValueError("Memory changed since the preview; run the preview again")
        if legacy_conflicts:
            raise ValueError("Existing local records need review; no memory was overwritten")
        for item in records.values():
            if item.id in matched:
                continue
            session.add(UserMemory(
                id=item.id, user_id=user_id, content=item.content, source_ref=item.source_ref,
                memory_type=item.memory_type, source=item.source, scope=item.scope,
                status=item.status, memory_layer=item.memory_layer, canonical_key=item.canonical_key,
                tags=item.tags, importance=item.importance, created_at=item.created_at,
                updated_at=item.updated_at,
            ))
            staged += 1

    return MemoryTransferReport(
        fingerprint=fingerprint,
        active=sum(r.status == "active" for r in records.values()),
        archived=sum(r.status == "archived" for r in records.values()),
        pending=sum(r.status == "pending" for r in records.values()),
        already_staged=len(matched), legacy_conflicts=legacy_conflicts, ignored_facts=ignored, staged=staged,
    )
