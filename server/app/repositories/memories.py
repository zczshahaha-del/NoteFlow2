from __future__ import annotations

from sqlalchemy import select

from app.models.db import UserMemory
from app.repositories.base import Repository, require_user_id


class MemoryRepository(Repository):
    async def get(self, user_id: str, memory_id: str) -> UserMemory | None:
        user_id = require_user_id(user_id)
        return await self.session.scalar(
            select(UserMemory).where(UserMemory.id == memory_id, UserMemory.user_id == user_id)
        )

    async def list(self, user_id: str, *, include_deleted: bool = False, limit: int = 50) -> list[UserMemory]:
        user_id = require_user_id(user_id)
        stmt = select(UserMemory).where(UserMemory.user_id == user_id)
        if not include_deleted:
            stmt = stmt.where(UserMemory.deleted_at.is_(None), UserMemory.status != "deleted")
        result = await self.session.execute(stmt.order_by(UserMemory.updated_at.desc()).limit(max(1, limit)))
        return list(result.scalars().all())
