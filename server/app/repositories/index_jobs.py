from __future__ import annotations

from sqlalchemy import select

from app.models.db import NoteIndexJob
from app.repositories.base import Repository, require_user_id


class IndexJobRepository(Repository):
    async def get(self, user_id: str, job_id: str) -> NoteIndexJob | None:
        user_id = require_user_id(user_id)
        return await self.session.scalar(
            select(NoteIndexJob).where(NoteIndexJob.id == job_id, NoteIndexJob.user_id == user_id)
        )

    async def latest_for_note(self, user_id: str, note_id: str) -> NoteIndexJob | None:
        user_id = require_user_id(user_id)
        return await self.session.scalar(
            select(NoteIndexJob)
            .where(NoteIndexJob.note_id == note_id, NoteIndexJob.user_id == user_id)
            .order_by(NoteIndexJob.created_at.desc())
            .limit(1)
        )

    async def list_for_note(self, user_id: str, note_id: str, limit: int = 20) -> list[NoteIndexJob]:
        user_id = require_user_id(user_id)
        result = await self.session.execute(
            select(NoteIndexJob)
            .where(NoteIndexJob.note_id == note_id, NoteIndexJob.user_id == user_id)
            .order_by(NoteIndexJob.created_at.desc())
            .limit(max(1, limit))
        )
        return list(result.scalars().all())

    async def list(self, user_id: str, *, note_id: str | None = None, limit: int = 50) -> list[NoteIndexJob]:
        user_id = require_user_id(user_id)
        stmt = select(NoteIndexJob).where(NoteIndexJob.user_id == user_id)
        if note_id:
            stmt = stmt.where(NoteIndexJob.note_id == note_id)
        result = await self.session.execute(stmt.order_by(NoteIndexJob.created_at.desc()).limit(max(1, limit)))
        return list(result.scalars().all())
