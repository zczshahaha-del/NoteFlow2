from __future__ import annotations

from app.database import AsyncSessionLocal
from app.memory.runtime import resolve_memory_read
from app.memory.domain import find_memories
from app.memory.policy import filter_eligible_memories
from app.services.user_settings import is_user_memory_enabled


class MemoryContextService:
    async def enabled(self, *, user_id: str, requested: bool) -> bool:
        if not requested:
            return False
        async with AsyncSessionLocal() as session:
            return await is_user_memory_enabled(session, user_id)

    async def context(
        self,
        *,
        user_id: str,
        requested: bool,
        query: str,
        scopes: list[str],
        memory_types: list[str],
    ) -> str:
        if not requested:
            return ""
        async with AsyncSessionLocal() as session:
            if not await is_user_memory_enabled(session, user_id):
                return ""
            memories = await find_memories(
                session,
                user_id,
                query=query,
                scopes=scopes,
                memory_types=memory_types,
                limit=20,
            )
            active = await resolve_memory_read(
                session,
                user_id=user_id,
                query=query,
                candidate_memories=memories,
                limit=6,
            )
            await session.commit()
            active = filter_eligible_memories(active, limit=6)
            if not active:
                return ""
            lines = ["长期记忆（只作为默认偏好；用户当前明确要求优先级最高）："]
            lines.extend(
                f"{index}. [{memory.memory_type}/{memory.scope}/重要度{memory.importance}] {memory.content}"
                for index, memory in enumerate(active, start=1)
            )
            return "\n".join(lines)
