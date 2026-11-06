from __future__ import annotations

from sqlalchemy import select

from app.config import cfg
from app.database import AsyncSessionLocal
from app.memory.domain import find_memories, mark_memories_used, memory_canonical_key, memory_layer, memory_value
from app.memory.engine import MemoryRecord, MemoryUnavailable
from app.memory.planning import MemoryReadPlan, broad_memory_read_plan
from app.memory.policy import filter_eligible_memories
from app.memory.presentation import format_context
from app.memory.runtime import resolve_memory_read
from app.models.db import UserSettings
from app.services.user_settings import is_user_memory_enabled


class MemoryContextService:
    async def enabled(self, *, user_id: str, requested: bool) -> bool:
        if not requested:
            return False
        async with AsyncSessionLocal() as session:
            return await is_user_memory_enabled(session, user_id)

    async def recall(
        self,
        user_id: str,
        plan: MemoryReadPlan,
        *,
        requested: bool = True,
        track_use: bool = False,
    ) -> list[MemoryRecord]:
        if not requested:
            return []
        from app.memory.control import control, uses_engine

        if await uses_engine(user_id):
            from app.memory.gateway import MemoryGateway

            return await MemoryGateway().read(
                user_id, query=plan.query, scopes=plan.scopes, memory_types=plan.memory_types,
                canonical_keys=plan.canonical_keys, layers=plan.layers, limit=plan.limit,
            )

        async with AsyncSessionLocal() as session:
            settings, state = await control(session, user_id)
            if not settings.memory_enabled:
                return []

            async def candidates_for_plan(*, refresh=False):
                return await find_memories(
                    session, user_id, query=plan.query, scopes=plan.scopes,
                    memory_types=plan.memory_types, canonical_keys=plan.canonical_keys,
                    layers=plan.layers, limit=max(20, plan.limit), refresh=refresh,
                )

            candidates = await candidates_for_plan()
            limit = min(plan.limit, cfg.MEMORY_CONTEXT_LIMIT)
            active = await resolve_memory_read(
                session, user_id=user_id, query=plan.query, candidate_memories=candidates, limit=limit,
            )
            # A ranking request can finish after a disable, edit or deletion.
            current_settings = (await session.execute(select(
                UserSettings.memory_enabled, UserSettings.preferences,
            ).where(UserSettings.user_id == user_id))).one_or_none()
            if current_settings is None or not current_settings.memory_enabled:
                return []
            current_state = (current_settings.preferences or {}).get("memoryControl") or {}
            if current_state.get("generation", 0) != state.get("generation", 0):
                return []
            current = {memory.id: memory for memory in await candidates_for_plan(refresh=True)}
            active = filter_eligible_memories(
                [current[memory.id] for memory in active if memory.id in current], limit=limit,
            )[:limit]
            if track_use:
                await mark_memories_used(session, user_id, active, reason=f"read_plan:{plan.reason or 'memory_query'}")
            records = [
                MemoryRecord(
                    id=memory.id, content=memory.content, memory_type=memory.memory_type,
                    source=memory.source, scope=memory.scope, status=memory.status,
                    source_ref=memory.source_ref or "", memory_layer=memory_layer(memory),
                    canonical_key=memory_canonical_key(memory), tags=memory.tags or [],
                    importance=memory.importance, confidence=memory.confidence,
                    created_at=memory.created_at, updated_at=memory.updated_at,
                    deleted_at=memory.deleted_at, expires_at=memory.expires_at,
                    last_used_at=memory.last_used_at, access_count=memory.access_count,
                    value=memory_value(memory),
                )
                for memory in active
            ]
            await session.commit()
            return records

    async def context(
        self,
        *,
        user_id: str,
        requested: bool,
        query: str,
        scopes: list[str],
        memory_types: list[str],
        limit: int = 6,
    ) -> str:
        plan = broad_memory_read_plan(query, scopes=scopes, memory_types=memory_types, limit=limit)
        plan.scopes = list(scopes)
        try:
            return format_context(await self.recall(user_id, plan, requested=requested))
        except MemoryUnavailable:
            return ""
