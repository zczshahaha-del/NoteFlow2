"""Prepare an account's governed Hindsight facts for NoteFlow-owned storage."""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.memory.control import lock_owner
from app.memory.domain import normalize_memory_layer, normalize_memory_type, normalize_scope
from app.memory.engine import MemoryEngine, MemoryRecord
from app.memory.gateway import record
from app.memory.policy import classify_memory_content, memory_is_eligible
from app.models.db import IntegrationOutbox, MemorySource, User, UserMemory

_COPY_ID_PREFIX = "hsp-"
_SOURCE_TEXT = "portableSourceText"
_SOURCE_EDGES = "portableSourceEdges"
_EXPLICIT_ZODIAC = re.compile(
    r"^(?:用户|我)(?:属\s*|(?:的)?生肖\s*(?:是|为|[：:])?\s*)"
    r"[鼠牛虎兔龙蛇马羊猴鸡狗猪](?=[\s。，、；;|]|$)"
)


def is_hindsight_copy(memory: UserMemory) -> bool:
    return memory.id.startswith(_COPY_ID_PREFIX)


async def copied_source_memories(session: AsyncSession, user_id: str, source_id: str) -> list[UserMemory]:
    return list((await session.scalars(select(UserMemory).join(
        MemorySource, (MemorySource.id == UserMemory.source_ref) & (MemorySource.user_id == UserMemory.user_id),
    ).where(
        UserMemory.user_id == user_id, UserMemory.source_ref == source_id,
        UserMemory.id.startswith(_COPY_ID_PREFIX), UserMemory.status != "deleted",
        UserMemory.deleted_at.is_(None), MemorySource.status == "stored",
    ).order_by(UserMemory.created_at, UserMemory.id))).all())


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
    source_documents: int
    unavailable_documents: int
    graph_edges: int


def _portable_id(user_id: str, source_id: str, fact_id: str) -> str:
    key = json.dumps([user_id, source_id, fact_id], ensure_ascii=False)
    return _COPY_ID_PREFIX + hashlib.sha256(key.encode("utf-8")).hexdigest()[:60]


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
        and (row.canonical_key == fact.canonical_key
             or (not row.canonical_key and fact.canonical_key == "profile.zodiac" and _EXPLICIT_ZODIAC.match(row.content)))
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
    portable_ids: dict[str, str] = {}
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
        if not item.canonical_key and item.memory_type == "personal_info" and _EXPLICIT_ZODIAC.match(item.content):
            item.canonical_key = "profile.zodiac"
        if normalize_scope(item.scope) != item.scope:
            raise ValueError("A memory uses an unknown scope; review it before staging")
        item.memory_layer = normalize_memory_layer(item.memory_layer, item.memory_type)
        item.created_at = _utc(item.created_at)
        item.updated_at = _utc(item.updated_at)
        if item.id in records and records[item.id] != item:
            raise ValueError("Hindsight returned conflicting versions of a published fact")
        records[item.id] = item
        portable_ids[fact.id] = item.id
    if sources.keys() - seen_sources:
        raise ValueError("A published source is missing from Hindsight; staging would be incomplete")

    source_ids = sorted({item.source_ref for item in records.values()})
    documents = {}
    for source_id in source_ids:
        document = await engine.document(user_id, source_id)
        if document and classify_memory_content(document.content).allowed:
            documents[source_id] = document.content
    edges_by_source: dict[str, list[dict[str, str]]] = {source_id: [] for source_id in source_ids}
    if records:
        graph = await engine.graph(user_id)
        visible = {node.id for node in graph.nodes}
        edges = {
            (portable_ids[edge.source], portable_ids[edge.target], edge.relation)
            for edge in graph.edges
            if edge.source in portable_ids and edge.target in portable_ids
            and edge.source in visible and edge.target in visible
        }
        for start, end, relation in sorted(edges):
            edges_by_source[records[start].source_ref].append(
                {"source": start, "target": end, "relation": relation}
            )

    existing_by_id = {row.id: row for row in (await session.scalars(
        select(UserMemory).where(UserMemory.user_id == user_id)
    )).all()}
    matched: set[str] = set()
    legacy_conflicts = 0
    for row in existing_by_id.values():
        if is_hindsight_copy(row) and row.id in records and _matches(row, records[row.id]):
            matched.add(row.id)
        elif is_hindsight_copy(row) or (row.status != "deleted" and row.deleted_at is None):
            legacy_conflicts += 1

    snapshot = [asdict(records[key]) for key in sorted(records)]
    body = json.dumps({"owner": user_id, "records": snapshot, "ignored": ignored,
                       "documents": documents, "edges": edges_by_source},
                      ensure_ascii=False, sort_keys=True, default=str)
    fingerprint = hashlib.sha256(body.encode("utf-8")).hexdigest()
    staged = 0
    if expected_fingerprint is not None:
        if expected_fingerprint != fingerprint:
            raise ValueError("Memory changed since the preview; run the preview again")
        if legacy_conflicts:
            raise ValueError("Existing local records need review; no memory was overwritten")
        for source_id in source_ids:
            source = sources[source_id]
            metadata = dict(source.metadata_json or {})
            metadata.pop(_SOURCE_TEXT, None)
            if source_id in documents:
                metadata[_SOURCE_TEXT] = documents[source_id]
            metadata[_SOURCE_EDGES] = edges_by_source[source_id]
            if metadata != source.metadata_json:
                source.metadata_json = metadata
                # Copying metadata does not revise the original source. Its
                # timestamp is also the fallback for facts without a date.
                flag_modified(source, "updated_at")
        for item in records.values():
            if item.id in matched:
                row = existing_by_id[item.id]
                if not row.canonical_key and item.canonical_key:
                    row.canonical_key = item.canonical_key
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
        source_documents=len(documents), unavailable_documents=len(source_ids) - len(documents),
        graph_edges=sum(map(len, edges_by_source.values())),
    )


def portable_source_document(source: MemorySource) -> dict[str, str] | None:
    text = (source.metadata_json or {}).get(_SOURCE_TEXT)
    return {"id": source.id, "content": text} if isinstance(text, str) and text else None


def clear_portable_source(source: MemorySource) -> None:
    source.metadata_json = {key: value for key, value in (source.metadata_json or {}).items()
                            if key not in {_SOURCE_TEXT, _SOURCE_EDGES}}


async def portable_memory_graph(session: AsyncSession, user_id: str) -> dict:
    rows = (await session.execute(select(UserMemory, MemorySource).outerjoin(
        MemorySource, (MemorySource.id == UserMemory.source_ref) & (MemorySource.user_id == UserMemory.user_id),
    ).where(UserMemory.user_id == user_id, UserMemory.status == "active", UserMemory.deleted_at.is_(None))
        .order_by(UserMemory.created_at.desc(), UserMemory.id).limit(400))).all()
    nodes, sources = [], {}
    for memory, source in rows:
        if not memory_is_eligible(memory):
            continue
        if is_hindsight_copy(memory):
            if source is None or source.status != "stored":
                continue
            sources[source.id] = source
        nodes.append({"id": memory.id, "content": memory.content,
                      "sourceRef": source.id if is_hindsight_copy(memory) else ""})
    visible = {node["id"] for node in nodes}
    edges = [edge for source in sources.values() for edge in (source.metadata_json or {}).get(_SOURCE_EDGES, [])
             if edge["source"] in visible and edge["target"] in visible]
    return {"nodes": nodes, "edges": edges}
