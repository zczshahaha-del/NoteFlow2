from __future__ import annotations

from pathlib import Path

from app.config import cfg
from app.database import AsyncSessionLocal
from app.models.db import NoteAttachment
from app.repositories.attachments import AttachmentRepository
from app.repositories.notes import NoteRepository
from app.services.object_storage import build_object_storage
from app.utils import random_id


class AttachmentService:
    def __init__(self) -> None:
        self.storage = build_object_storage(cfg.ATTACHMENT_STORAGE_ROOT)

    async def create(
        self,
        *,
        user_id: str,
        note_id: str | None,
        file_name: str,
        content_type: str,
        content: bytes,
    ) -> NoteAttachment:
        async with AsyncSessionLocal() as session:
            if note_id and await NoteRepository(session).get_active(user_id, note_id) is None:
                raise LookupError("note not found")
            attachment_id = f"att_{random_id()}"
            key = f"{user_id}/{attachment_id}{Path(file_name).suffix.lower()[:16]}"
            stored = await self.storage.put(key, content)
            item = NoteAttachment(
                id=attachment_id,
                user_id=user_id,
                note_id=note_id,
                file_name=file_name,
                content_type=content_type,
                size=stored.size,
                sha256=stored.sha256,
                storage_key=stored.key,
            )
            session.add(item)
            await session.commit()
            await session.refresh(item)
            return item

    async def list_for_note(self, user_id: str, note_id: str) -> list[NoteAttachment]:
        async with AsyncSessionLocal() as session:
            return await AttachmentRepository(session).list(user_id, note_id)

    async def read(self, user_id: str, attachment_id: str) -> tuple[NoteAttachment, bytes]:
        async with AsyncSessionLocal() as session:
            item = await AttachmentRepository(session).get(user_id, attachment_id)
            if item is None:
                raise LookupError("attachment not found")
            return item, await self.storage.get(item.storage_key)

    async def read_signed(self, attachment_id: str) -> tuple[NoteAttachment, bytes]:
        async with AsyncSessionLocal() as session:
            item = await AttachmentRepository(session).get_by_signed_id(attachment_id)
            if item is None:
                raise LookupError("attachment not found")
            return item, await self.storage.get(item.storage_key)

    async def delete(self, user_id: str, attachment_id: str) -> None:
        async with AsyncSessionLocal() as session:
            item = await AttachmentRepository(session).get(user_id, attachment_id)
            if item is None:
                raise LookupError("attachment not found")
            await self.storage.delete(item.storage_key)
            await session.delete(item)
            await session.commit()
