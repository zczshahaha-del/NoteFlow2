from __future__ import annotations

from sqlalchemy import delete, select

from app.models.db import NoteDraft, NoteDraftSection
from app.repositories.base import Repository, require_user_id


class DraftRepository(Repository):
    async def get_by_idempotency_key(self, user_id: str, idempotency_key: str) -> NoteDraft | None:
        user_id = require_user_id(user_id)
        return await self.session.scalar(
            select(NoteDraft).where(
                NoteDraft.user_id == user_id,
                NoteDraft.idempotency_key == idempotency_key,
            )
        )

    async def get(self, user_id: str, draft_id: str) -> NoteDraft | None:
        user_id = require_user_id(user_id)
        return await self.session.scalar(
            select(NoteDraft).where(NoteDraft.id == draft_id, NoteDraft.user_id == user_id)
        )

    async def get_for_update(self, user_id: str, draft_id: str) -> NoteDraft | None:
        user_id = require_user_id(user_id)
        return await self.session.scalar(
            select(NoteDraft).where(
                NoteDraft.id == draft_id, NoteDraft.user_id == user_id
            ).with_for_update()
        )

    async def list_sections(self, user_id: str, draft_id: str) -> list[NoteDraftSection]:
        user_id = require_user_id(user_id)
        result = await self.session.execute(
            select(NoteDraftSection)
            .where(NoteDraftSection.draft_id == draft_id, NoteDraftSection.user_id == user_id)
            .order_by(NoteDraftSection.sort_order, NoteDraftSection.created_at)
        )
        return list(result.scalars().all())

    async def get_section(self, user_id: str, draft_id: str, section_id: str) -> NoteDraftSection | None:
        user_id = require_user_id(user_id)
        return await self.session.scalar(
            select(NoteDraftSection).where(
                NoteDraftSection.id == section_id,
                NoteDraftSection.draft_id == draft_id,
                NoteDraftSection.user_id == user_id,
            )
        )

    async def delete_sections(self, user_id: str, draft_id: str) -> None:
        user_id = require_user_id(user_id)
        await self.session.execute(
            delete(NoteDraftSection).where(
                NoteDraftSection.draft_id == draft_id,
                NoteDraftSection.user_id == user_id,
            )
        )
