from __future__ import annotations

from sqlalchemy import select

from app.models.db import NoteEditPreview, NoteEditPreviewRevision
from app.repositories.base import Repository, require_user_id


class EditRepository(Repository):
    async def get_by_idempotency_key(self, user_id: str, idempotency_key: str) -> NoteEditPreview | None:
        user_id = require_user_id(user_id)
        return await self.session.scalar(
            select(NoteEditPreview).where(
                NoteEditPreview.user_id == user_id,
                NoteEditPreview.idempotency_key == idempotency_key,
            )
        )

    async def get(self, user_id: str, edit_id: str) -> NoteEditPreview | None:
        user_id = require_user_id(user_id)
        return await self.session.scalar(
            select(NoteEditPreview).where(
                NoteEditPreview.id == edit_id,
                NoteEditPreview.user_id == user_id,
            )
        )

    async def get_for_update(self, user_id: str, edit_id: str) -> NoteEditPreview | None:
        user_id = require_user_id(user_id)
        return await self.session.scalar(
            select(NoteEditPreview).where(
                NoteEditPreview.id == edit_id,
                NoteEditPreview.user_id == user_id,
            ).with_for_update()
        )

    async def list_revisions(self, user_id: str, edit_id: str) -> list[NoteEditPreviewRevision]:
        user_id = require_user_id(user_id)
        result = await self.session.execute(
            select(NoteEditPreviewRevision)
            .where(NoteEditPreviewRevision.edit_id == edit_id, NoteEditPreviewRevision.user_id == user_id)
            .order_by(NoteEditPreviewRevision.created_at, NoteEditPreviewRevision.id)
        )
        return list(result.scalars().all())

    async def get_revision(self, user_id: str, edit_id: str, revision_id: str) -> NoteEditPreviewRevision | None:
        user_id = require_user_id(user_id)
        return await self.session.scalar(
            select(NoteEditPreviewRevision).where(
                NoteEditPreviewRevision.id == revision_id,
                NoteEditPreviewRevision.edit_id == edit_id,
                NoteEditPreviewRevision.user_id == user_id,
            )
        )
