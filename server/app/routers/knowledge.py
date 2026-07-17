from __future__ import annotations

from typing import Optional, Union

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.database import AsyncSessionLocal
from app.deps import CurrentUser, get_current_user
from app.models.db import KnowledgeBase, Note, NoteCategory
from app.utils import random_id

router = APIRouter(tags=["knowledge"])


class KnowledgeBaseSnapshot(BaseModel):
    treeData: Optional[Union[list, dict]] = None
    fileContents: Optional[dict] = None
    selectedFileId: Optional[str] = None


def _normalize(snapshot: KnowledgeBaseSnapshot):
    if not snapshot.treeData or snapshot.treeData == "null":
        snapshot.treeData = []
    if not snapshot.fileContents or snapshot.fileContents == "null":
        snapshot.fileContents = {}
    return snapshot


def _clean_title(value: str) -> str:
    title = value.strip().removesuffix(".md").strip()
    return title[:255] or "未命名笔记"


def _clean_category_name(value: str) -> str:
    name = value.strip().removesuffix(".md").strip()
    return name[:100] or "新建文件夹"


async def _safe_model_id(session, model, preferred: Optional[str]) -> str:
    candidate = (preferred or "").strip()
    if not candidate or len(candidate) > 64:
        return random_id()
    existing = await session.get(model, candidate)
    return random_id() if existing is not None else candidate


async def _has_structured_notes(session, user_id: str) -> bool:
    note_result = await session.execute(select(Note.id).where(Note.user_id == user_id).limit(1))
    if note_result.scalar_one_or_none() is not None:
        return True
    category_result = await session.execute(
        select(NoteCategory.id).where(NoteCategory.user_id == user_id).limit(1)
    )
    return category_result.scalar_one_or_none() is not None


@router.get("/knowledge-base")
async def load_knowledge_base(user: CurrentUser = Depends(get_current_user)):
    async with AsyncSessionLocal() as session:
        if await _has_structured_notes(session, user.id):
            return {"snapshot": None}

        result = await session.execute(
            select(KnowledgeBase).where(KnowledgeBase.user_id == user.id)
        )
        kb = result.scalar_one_or_none()

    if kb is None:
        return {"snapshot": None}

    snapshot = _normalize(KnowledgeBaseSnapshot(
        treeData=kb.tree_data,
        fileContents=kb.file_contents,
        selectedFileId=kb.selected_file_id,
    ))
    return {"snapshot": snapshot.model_dump()}


@router.put("/knowledge-base")
async def save_knowledge_base(
    snapshot: KnowledgeBaseSnapshot,
    user: CurrentUser = Depends(get_current_user),
):
    snapshot = _normalize(snapshot)
    selected_file_id = snapshot.selectedFileId if snapshot.selectedFileId and snapshot.selectedFileId.strip() else None

    async with AsyncSessionLocal() as session:
        if await _has_structured_notes(session, user.id):
            return {
                "ok": False,
                "ignored": True,
                "reason": "structured notes already exist; legacy knowledge_base write ignored",
            }

        stmt = pg_insert(KnowledgeBase).values(
            user_id=user.id,
            tree_data=snapshot.treeData,
            file_contents=snapshot.fileContents,
            selected_file_id=selected_file_id,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[KnowledgeBase.user_id],
            set_={
                "tree_data": stmt.excluded.tree_data,
                "file_contents": stmt.excluded.file_contents,
                "selected_file_id": stmt.excluded.selected_file_id,
            },
        )
        await session.execute(stmt)
        await session.commit()

    return {"ok": True}


@router.post("/knowledge-base/migrate")
async def migrate_knowledge_base(user: CurrentUser = Depends(get_current_user)):
    async with AsyncSessionLocal() as session:
        if await _has_structured_notes(session, user.id):
            result = await session.execute(
                select(KnowledgeBase).where(KnowledgeBase.user_id == user.id)
            )
            kb = result.scalar_one_or_none()
            if kb is not None:
                await session.delete(kb)
                await session.commit()
            return {
                "ok": True,
                "migrated": False,
                "reason": "structured notes already exist; stale legacy snapshot cleared",
                "categoriesCreated": 0,
                "notesCreated": 0,
            }

        result = await session.execute(
            select(KnowledgeBase).where(KnowledgeBase.user_id == user.id)
        )
        kb = result.scalar_one_or_none()
        if kb is None:
            return {
                "ok": True,
                "migrated": False,
                "reason": "legacy knowledge base not found",
                "categoriesCreated": 0,
                "notesCreated": 0,
            }

        tree_data = kb.tree_data if isinstance(kb.tree_data, list) else []
        file_contents = kb.file_contents if isinstance(kb.file_contents, dict) else {}
        category_id_map: dict[str, str] = {}
        categories_created = 0
        notes_created = 0

        async def migrate_nodes(nodes: list, parent_id: Optional[str] = None):
            nonlocal categories_created, notes_created
            for sort_order, raw_node in enumerate(nodes):
                if not isinstance(raw_node, dict):
                    continue
                node_type = raw_node.get("type")
                legacy_id = str(raw_node.get("id") or "")
                name = str(raw_node.get("name") or "")

                if node_type == "folder":
                    category_id = await _safe_model_id(session, NoteCategory, legacy_id)
                    category_id_map[legacy_id] = category_id
                    session.add(
                        NoteCategory(
                            id=category_id,
                            user_id=user.id,
                            name=_clean_category_name(name),
                            parent_id=parent_id,
                            sort_order=sort_order,
                        )
                    )
                    categories_created += 1
                    children = raw_node.get("children")
                    await migrate_nodes(children if isinstance(children, list) else [], category_id)
                    continue

                if node_type == "file":
                    note_id = await _safe_model_id(session, Note, legacy_id)
                    content = file_contents.get(legacy_id)
                    if not isinstance(content, str):
                        content = raw_node.get("content") if isinstance(raw_node.get("content"), str) else ""
                    session.add(
                        Note(
                            id=note_id,
                            user_id=user.id,
                            title=_clean_title(name),
                            category_id=parent_id,
                            content=content,
                            tags=[],
                            is_pinned=bool(raw_node.get("pinned")),
                            is_favorite=False,
                            index_status="pending",
                        )
                    )
                    notes_created += 1

        await migrate_nodes(tree_data)
        await session.delete(kb)
        await session.commit()

        return {
            "ok": True,
            "migrated": True,
            "categoriesCreated": categories_created,
            "notesCreated": notes_created,
        }


@router.delete("/knowledge-base")
async def delete_knowledge_base(user: CurrentUser = Depends(get_current_user)):
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(KnowledgeBase).where(KnowledgeBase.user_id == user.id)
        )
        kb = result.scalar_one_or_none()
        if kb is not None:
            await session.delete(kb)
            await session.commit()

    return {"ok": True}
