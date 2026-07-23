from __future__ import annotations

from datetime import datetime

from sqlalchemy import and_, func, select, update

from app.models.db import Note, NoteCategory, NoteEmbedding, NoteSection, NoteVersion
from app.repositories.base import Repository, require_user_id


class NoteRepository(Repository):
    async def get_active_by_idempotency_key(self, user_id: str, idempotency_key: str) -> Note | None:
        user_id = require_user_id(user_id)
        return await self.session.scalar(
            select(Note)
            .where(
                Note.user_id == user_id,
                Note.idempotency_key == idempotency_key,
                Note.deleted_at.is_(None),
            )
            .limit(1)
        )

    async def get_active(self, user_id: str, note_id: str) -> Note | None:
        user_id = require_user_id(user_id)
        return await self.session.scalar(
            select(Note).where(Note.id == note_id, Note.user_id == user_id, Note.deleted_at.is_(None))
        )

    async def get_active_for_update(self, user_id: str, note_id: str) -> Note | None:
        user_id = require_user_id(user_id)
        return await self.session.scalar(
            select(Note).where(
                Note.id == note_id, Note.user_id == user_id, Note.deleted_at.is_(None)
            ).with_for_update()
        )

    async def get(self, user_id: str, note_id: str, *, include_deleted: bool = False) -> Note | None:
        user_id = require_user_id(user_id)
        conditions = [Note.id == note_id, Note.user_id == user_id]
        if not include_deleted:
            conditions.append(Note.deleted_at.is_(None))
        return await self.session.scalar(select(Note).where(and_(*conditions)))

    async def list(self, user_id: str, *, include_deleted: bool = False) -> list[Note]:
        user_id = require_user_id(user_id)
        stmt = select(Note).where(Note.user_id == user_id)
        if not include_deleted:
            stmt = stmt.where(Note.deleted_at.is_(None))
        result = await self.session.execute(
            stmt.order_by(Note.is_pinned.desc(), Note.updated_at.desc())
        )
        return list(result.scalars().all())

    async def get_category(
        self,
        user_id: str,
        category_id: str,
        *,
        include_deleted: bool = False,
    ) -> NoteCategory | None:
        user_id = require_user_id(user_id)
        stmt = select(NoteCategory).where(NoteCategory.id == category_id, NoteCategory.user_id == user_id)
        if not include_deleted:
            stmt = stmt.where(NoteCategory.deleted_at.is_(None))
        return await self.session.scalar(stmt)

    async def list_categories(self, user_id: str, *, include_deleted: bool = False) -> list[NoteCategory]:
        user_id = require_user_id(user_id)
        stmt = select(NoteCategory).where(NoteCategory.user_id == user_id)
        if not include_deleted:
            stmt = stmt.where(NoteCategory.deleted_at.is_(None))
        result = await self.session.execute(stmt.order_by(NoteCategory.sort_order, NoteCategory.created_at))
        return list(result.scalars().all())

    async def descendant_category_ids(self, user_id: str, category_id: str) -> set[str]:
        user_id = require_user_id(user_id)
        result = await self.session.execute(
            select(NoteCategory.id, NoteCategory.parent_id).where(
                NoteCategory.user_id == user_id,
                NoteCategory.deleted_at.is_(None),
            )
        )
        children: dict[str | None, list[str]] = {}
        for item_id, parent_id in result.all():
            children.setdefault(parent_id, []).append(item_id)
        collected: set[str] = set()
        stack = [category_id]
        while stack:
            current = stack.pop()
            if current in collected:
                continue
            collected.add(current)
            stack.extend(children.get(current, []))
        return collected

    async def soft_delete_categories_and_notes(
        self,
        user_id: str,
        category_ids: set[str],
        deleted_at: datetime,
    ) -> None:
        user_id = require_user_id(user_id)
        await self.session.execute(
            update(NoteCategory)
            .where(NoteCategory.user_id == user_id, NoteCategory.id.in_(category_ids))
            .values(deleted_at=deleted_at)
        )
        await self.session.execute(
            update(Note)
            .where(Note.user_id == user_id, Note.category_id.in_(category_ids), Note.deleted_at.is_(None))
            .values(deleted_at=deleted_at)
        )

    async def list_sections(self, user_id: str, note_id: str) -> list[NoteSection]:
        user_id = require_user_id(user_id)
        result = await self.session.execute(
            select(NoteSection)
            .where(NoteSection.user_id == user_id, NoteSection.note_id == note_id)
            .order_by(NoteSection.sort_order)
        )
        return list(result.scalars().all())

    async def get_section(self, user_id: str, note_id: str, section_id: str) -> NoteSection | None:
        user_id = require_user_id(user_id)
        return await self.session.scalar(
            select(NoteSection).where(
                NoteSection.id == section_id,
                NoteSection.note_id == note_id,
                NoteSection.user_id == user_id,
            )
        )

    async def list_versions(self, user_id: str, note_id: str) -> list[NoteVersion]:
        user_id = require_user_id(user_id)
        result = await self.session.execute(
            select(NoteVersion)
            .where(NoteVersion.note_id == note_id, NoteVersion.user_id == user_id)
            .order_by(NoteVersion.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_version(self, user_id: str, note_id: str, version_id: str) -> NoteVersion | None:
        user_id = require_user_id(user_id)
        return await self.session.scalar(
            select(NoteVersion).where(
                NoteVersion.id == version_id,
                NoteVersion.note_id == note_id,
                NoteVersion.user_id == user_id,
            )
        )

    async def embedding_status(self, user_id: str, note_id: str) -> tuple[dict[str, int], NoteEmbedding | None]:
        user_id = require_user_id(user_id)
        counts_result = await self.session.execute(
            select(NoteEmbedding.status, func.count(NoteEmbedding.id))
            .where(NoteEmbedding.note_id == note_id, NoteEmbedding.user_id == user_id)
            .group_by(NoteEmbedding.status)
        )
        latest = await self.session.scalar(
            select(NoteEmbedding)
            .where(NoteEmbedding.note_id == note_id, NoteEmbedding.user_id == user_id)
            .order_by(NoteEmbedding.created_at.desc())
            .limit(1)
        )
        return {status: count for status, count in counts_result.all()}, latest
