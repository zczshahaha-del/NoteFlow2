"""Authenticated memory boundary: source lifecycle, policy and engine coordination."""
from __future__ import annotations

import hashlib
import asyncio
from datetime import datetime

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.memory.control import DEFAULT_MISSION, control, engine_name, lock_owner, save_control
from app.memory.engine import MemoryRecord, configured_engine
from app.memory.policy import classify_memory_content
from app.models.db import MemorySource, IntegrationOutbox, UserSettings
from app.observability.context import current_trace
from app.repositories.outbox import OutboxRepository
from app.utils import random_id


def record(row, source):
    metadata = source.metadata_json or {}
    def date(value):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None
        except ValueError:
            return None
    return MemoryRecord(
        id=row["id"], content=row.get("text", ""), source_ref=source.id,
        status="pending" if row["id"] in metadata.get("pendingIds", []) else "archived" if row.get("state") == "invalidated" else "active",
        memory_type=metadata.get("memoryType", "personal_info"),
        source=metadata.get("source", "user_message"), scope=metadata.get("scope", "global"),
        created_at=source.created_at, updated_at=date(row.get("updated_at")) or source.updated_at,
        tags=row.get("tags") or [], canonical_key=metadata.get("canonicalKey", ""),
    )


def public_record(memory):
    from dataclasses import asdict
    item = asdict(memory)
    names = {"memory_type": "memoryType", "source_ref": "sourceRef", "memory_layer": "layer",
        "canonical_key": "canonicalKey", "created_at": "createdAt", "updated_at": "updatedAt",
        "deleted_at": "deletedAt", "last_used_at": "lastUsedAt", "access_count": "accessCount"}
    return {names.get(k, k): v.isoformat() if isinstance(v, datetime) else v for k, v in item.items() if k != "expires_at"} | {"value": memory.content}


class MemoryGateway:
    def __init__(self, engine=None):
        self.engine = engine or configured_engine()

    async def preview(self, user_id, *, mission, text):
        if not classify_memory_content(text).allowed:
            raise ValueError("该示例包含不适合保存的信息。")
        test_owner = f"preview:{user_id}:{random_id()}"
        try:
            await self.engine.ensure_bank(test_owner, mission.strip())
            await self.engine.retain(test_owner, content=text, source_id="preview", metadata={"source": "synthetic_preview"})
            return {"facts": [row.get("text", "") for row in await self.engine.list(test_owner)]}
        finally:
            await self.engine.delete_bank(test_owner)

    async def wait(self, user_id, source_id, *, seconds=20):
        deadline = asyncio.get_running_loop().time() + seconds
        while True:
            async with AsyncSessionLocal() as session:
                source = await session.get(MemorySource, source_id)
                if source is None or source.user_id != user_id:
                    raise LookupError("source not found")
                if source.status == "stored":
                    return [r for r in await self.read(user_id) if r.source_ref == source_id and r.status == "active"]
                dead = await session.scalar(select(IntegrationOutbox.id).where(
                    IntegrationOutbox.user_id == user_id, IntegrationOutbox.aggregate_id == source_id,
                    IntegrationOutbox.status == "dead"))
                if dead:
                    from app.memory.engine import MemoryUnavailable
                    raise MemoryUnavailable("记忆整理失败，尚未确认保存；请在记忆管理重试。")
                if source.status != "queued" or asyncio.get_running_loop().time() >= deadline:
                    return []
            await asyncio.sleep(0.3)

    async def sources(self, session, user_id):
        return {s.id: s for s in (await session.scalars(select(MemorySource).where(
            MemorySource.user_id == user_id, MemorySource.status == "stored"))).all()}

    async def read(self, user_id, *, query=None, memory_types=(), scopes=(), limit=50, include_archived=True):
        async with AsyncSessionLocal() as session:
            settings, initial_state = await control(session, user_id)
            if query is not None and not settings.memory_enabled:
                return []
            sources = await self.sources(session, user_id)
            if not sources:
                return []
            rows = await (self.engine.recall(user_id, query) if query is not None else self.engine.list(user_id))
            result = []
            for row in rows:
                # Recall payloads vary; get the live fact before using it. This
                # also enforces current curation state instead of stale scores.
                if query is not None:
                    try:
                        row = await self.engine.get(user_id, row["id"])
                    except LookupError:
                        continue
                source = sources.get(row.get("document_id"))
                if not source or row.get("fact_type") == "observation":
                    continue
                if row["id"] in (source.metadata_json or {}).get("hiddenIds", []):
                    continue
                item = record(row, source)
                if not classify_memory_content(item.content).allowed:
                    continue
                if (query is not None or not include_archived) and item.status != "active":
                    continue
                if memory_types and item.memory_type not in memory_types:
                    continue
                if scopes and item.scope not in {"global", *scopes}:
                    continue
                result.append(item)
            live_sources = await self.sources(session, user_id)
            if query is not None:
                current = (await session.execute(select(UserSettings.memory_enabled, UserSettings.preferences).where(
                    UserSettings.user_id == user_id))).first()
                if current is None or not current[0] or (current[1] or {}).get("memoryControl", {}).get("generation", 0) != initial_state.get("generation", 0):
                    return []
            return [r for r in result if r.source_ref in live_sources][:max(1, min(limit, 500))]

    async def submit(self, user_id, content, *, source_key=None, metadata=None):
        text = content.strip()
        if len(text) > 8000:
            raise ValueError("记忆输入过长，请缩短到 8000 字以内。")
        if not classify_memory_content(text).allowed:
            return None
        trace = current_trace()
        source_key = source_key or trace.run_id or trace.request_id or random_id()
        source_key = hashlib.sha256(source_key.encode()).hexdigest()
        async with AsyncSessionLocal() as session:
            await lock_owner(session, user_id)
            settings, state = await control(session, user_id)
            if not settings.memory_enabled:
                return None
            existing = await session.scalar(select(MemorySource).where(
                MemorySource.user_id == user_id, MemorySource.source_key == source_key))
            if existing:
                return None if existing.status in {"deleted", "skipped"} else existing.id
            source = MemorySource(id=random_id(), user_id=user_id, source_key=source_key,
                generation=state.get("generation", 0), rule_version=state.get("ruleVersion", 1),
                metadata_json=metadata or {}, status="queued")
            session.add(source)
            await session.flush()
            await OutboxRepository(session).enqueue(topic="memory.retain.requested", aggregate_type="memory_source",
                aggregate_id=source.id, user_id=user_id, idempotency_key=f"retain:{user_id}:{source_key}",
                payload={"content": text}, max_attempts=3, trace_id=trace.trace_id or None)
            await session.commit()
        from app.workers.outbox_worker import notify_outbox_worker
        notify_outbox_worker()
        return source.id

    async def process(self, session, item):
        await lock_owner(session, item.user_id)
        settings, state = await control(session, item.user_id)
        source = await session.get(MemorySource, item.aggregate_id)
        if not source or source.user_id != item.user_id or source.status != "queued":
            return
        if (not settings.memory_enabled or await engine_name(session, item.user_id) != "hindsight"
            or source.generation != state.get("generation", 0) or source.rule_version != state.get("ruleVersion", 1)):
            source.status = "skipped"
            item.payload = {}
            return
        mission = state.get("mission", DEFAULT_MISSION)
        await self.engine.ensure_bank(item.user_id, mission)
        # Retry of a noncommitted source can replace only its own document.
        # Published/curated sources are never reprocessed by this worker.
        await self.engine.delete_source(item.user_id, source.id)
        await self.engine.retain(item.user_id, content=item.payload["content"], source_id=source.id,
                                 metadata={"source": "user_message", "rule_version": source.rule_version})
        rows = await self.engine.list(item.user_id, document_id=source.id)
        published = await self.sources(session, item.user_id)
        previous = await self.engine.list(item.user_id, state="valid") if published else []
        normalize = lambda text: "".join(text.split()).casefold()
        known = {normalize(r.get("text", "")) for r in previous if r.get("document_id") in published}
        hidden, pending = [], []
        for row in rows:
            duplicate = normalize(row.get("text", "")) in known
            if duplicate or (state.get("reviewNewFacts", False) and (source.metadata_json or {}).get("source") != "user_explicit"):
                await self.engine.curate(item.user_id, row["id"], {"state": "invalidated",
                    "reason": "duplicate" if duplicate else "pending user review: protect manual curation"})
                (hidden if duplicate else pending).append(row["id"])
        source.metadata_json = {**(source.metadata_json or {}), "hiddenIds": hidden, "pendingIds": pending}
        source.status = "stored" if rows else "empty"
        item.payload = {}

    async def curated(self, user_id, memory_id, *, content=None, status=None):
        if content is None and status is None:
            raise ValueError("请选择要修改的内容或状态。")
        async with AsyncSessionLocal() as session:
            await lock_owner(session, user_id)
            row = await self.engine.get(user_id, memory_id)
            sources = await self.sources(session, user_id)
            source = sources.get(row.get("document_id"))
            if source is None:
                raise LookupError("memory not found")
            changes = {"reason": "NoteFlow user curation"}
            if content is not None:
                if not content.strip() or len(content) > 2000 or not classify_memory_content(content).allowed:
                    raise ValueError("记忆内容为空、过长或包含不适合保存的信息。")
                changes["text"] = content.strip()
                settings, state = await control(session, user_id)
                # Subsequent automatic facts require confirmation after a manual
                # correction, rather than silently introducing a contradictory copy.
                save_control(settings, {**state, "reviewNewFacts": True})
            if status is not None:
                if status not in {"active", "archived"}:
                    raise ValueError("这里只支持启用或停用；彻底删除请使用删除来源。")
                changes["state"] = "valid" if status == "active" else "invalidated"
            row = await self.engine.curate(user_id, memory_id, changes)
            if status is not None:
                source.metadata_json = {**(source.metadata_json or {}), "pendingIds": [
                    key for key in (source.metadata_json or {}).get("pendingIds", []) if key != memory_id]}
            await session.commit()
            return record(row, source)

    async def delete_impact(self, user_id, memory_id):
        async with AsyncSessionLocal() as session:
            row = await self.engine.get(user_id, memory_id)
            source = (await self.sources(session, user_id)).get(row.get("document_id"))
            if source is None:
                raise LookupError("memory not found")
            rows = await self.engine.list(user_id, document_id=source.id)
            return {"sourceId": source.id, "memories": [public_record(record(r, source)) for r in rows]}

    async def delete(self, user_id, memory_id):
        async with AsyncSessionLocal() as session:
            await lock_owner(session, user_id)
            row = await self.engine.get(user_id, memory_id)
            source = (await self.sources(session, user_id)).get(row.get("document_id"))
            if source is None:
                raise LookupError("memory not found")
            result = record(row, source)
            # Persist a barrier before touching the engine. Failed external
            # deletion remains hidden and is retried, never reported as success.
            source.status = "deleted"
            await OutboxRepository(session).enqueue(topic="memory.source.delete", aggregate_type="memory_source",
                aggregate_id=source.id, user_id=user_id, idempotency_key=f"delete-source:{source.id}", payload={}, max_attempts=3)
            await session.commit()
        await self.engine.delete_source(user_id, source.id)
        result.status = "deleted"
        return result

    async def graph(self, user_id):
        records = await self.read(user_id, limit=500, include_archived=False)
        allowed = {r.id for r in records}
        graph = await self.engine.graph(user_id)
        nodes = [n.get("data", n) for n in graph.get("nodes", []) if n.get("data", n).get("id") in allowed]
        edges = [e.get("data", e) for e in graph.get("edges", [])
                 if e.get("data", e).get("source") in allowed and e.get("data", e).get("target") in allowed]
        return {"nodes": nodes, "edges": edges}
