from __future__ import annotations

from sqlalchemy import select

from app.models.db import NoteAttachment
from app.repositories.base import Repository, require_user_id


class AttachmentRepository(Repository):
    async def get(self, user_id: str, attachment_id: str) -> NoteAttachment | None:
        user_id = require_user_id(user_id)
        return await self.session.scalar(
            select(NoteAttachment).where(
                NoteAttachment.id == attachment_id,
                NoteAttachment.user_id == user_id,
            )
        )

    async def get_by_signed_id(self, attachment_id: str) -> NoteAttachment | None:
        """Use only after the router has verified the HMAC signed URL."""
        return await self.session.scalar(select(NoteAttachment).where(NoteAttachment.id == attachment_id))

    async def list(self, user_id: str, note_id: str | None = None) -> list[NoteAttachment]:
        user_id = require_user_id(user_id)
        stmt = select(NoteAttachment).where(NoteAttachment.user_id == user_id)
        if note_id:
            stmt = stmt.where(NoteAttachment.note_id == note_id)
        result = await self.session.execute(stmt.order_by(NoteAttachment.created_at.desc()))
        return list(result.scalars().all())
