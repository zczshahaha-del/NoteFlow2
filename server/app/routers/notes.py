from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from app.database import AsyncSessionLocal
from app.deps import CurrentUser, get_current_user
from app.models.db import Note, NoteCategory, NoteIndexJob, NoteSection, NoteVersion
from app.repositories.index_jobs import IndexJobRepository
from app.repositories.notes import NoteRepository
from app.services.markdown_index import index_note_now
from app.services.note_library import (
    build_note_context,
    hybrid_search_notes,
    list_related_notes,
    read_note_sections,
    source_to_dict,
    understand_note_query,
)
from app.services.rag_eval import RagEvalCase, build_auto_rag_eval_cases, run_rag_eval
from app.utils import random_id

router = APIRouter(tags=["notes"])


class CategoryPayload(BaseModel):
    id: Optional[str] = None
    name: str = "新建文件夹"
    parentId: Optional[str] = None
    sortOrder: int = 0


class NotePayload(BaseModel):
    id: Optional[str] = None
    title: str = "未命名笔记"
    categoryId: Optional[str] = None
    summary: Optional[str] = None
    tags: list[str] = []
    content: str = ""
    isPinned: bool = False
    isFavorite: bool = False
    idempotencyKey: Optional[str] = None


class NoteUpdatePayload(BaseModel):
    title: Optional[str] = None
    categoryId: Optional[str] = None
    summary: Optional[str] = None
    tags: Optional[list[str]] = None
    content: Optional[str] = None
    isPinned: Optional[bool] = None
    isFavorite: Optional[bool] = None
    indexStatus: Optional[str] = None
    source: str = "manual_edit"
    changeSummary: Optional[str] = None
    expectedUpdatedAt: Optional[str] = None
    expectedContentHash: Optional[str] = None


class ReindexPayload(BaseModel):
    reason: str = "manual"


class RagV2ReindexPayload(BaseModel):
    noteId: Optional[str] = None
    force: bool = False
    limit: int = 500


class NoteSearchPayload(BaseModel):
    query: str
    noteId: Optional[str] = None
    limit: int = 8


class RagEvalCasePayload(BaseModel):
    id: Optional[str] = None
    query: str
    noteId: Optional[str] = None
    expectedNoteIds: list[str] = Field(default_factory=list)
    expectedSectionIds: list[str] = Field(default_factory=list)
    expectedChunkIds: list[str] = Field(default_factory=list)
    expectedKeywords: list[str] = Field(default_factory=list)


class RagEvalPayload(BaseModel):
    cases: list[RagEvalCasePayload] = Field(default_factory=list)
    limit: int = 8
    successAt: int = 5
    keywordThreshold: float = 0.6


class RagEvalAutoPayload(BaseModel):
    caseLimit: int = 20
    resultLimit: int = 8
    successAt: int = 5
    keywordThreshold: float = 0.6


class NoteContextPayload(BaseModel):
    question: str
    selectedText: str = ""
    unsavedContent: str = ""
    currentSectionId: Optional[str] = None
    currentNoteId: Optional[str] = None


class ReadSectionsPayload(BaseModel):
    sectionIds: Optional[list[str]] = None


def _now() -> datetime:
    return datetime.utcnow()


def _has_note_version_conflict(expected_updated_at: Optional[str], current_updated_at: Optional[datetime]) -> bool:
    return bool(
        expected_updated_at
        and current_updated_at
        and expected_updated_at != current_updated_at.isoformat()
    )


def _content_hash(content: str) -> str:
    return hashlib.sha256((content or "").encode("utf-8")).hexdigest()


def _has_note_content_conflict(expected_content_hash: Optional[str], current_content: str) -> bool:
    return bool(expected_content_hash and expected_content_hash != _content_hash(current_content))


def _clean_title(value: str) -> str:
    title = value.strip().removesuffix(".md").strip()
    return title[:255] or "未命名笔记"


def _clean_category_name(value: str) -> str:
    name = value.strip().removesuffix(".md").strip()
    return name[:100] or "新建文件夹"


def _dt(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _category_out(category: NoteCategory) -> dict:
    return {
        "id": category.id,
        "name": category.name,
        "parentId": category.parent_id,
        "sortOrder": category.sort_order,
        "createdAt": _dt(category.created_at),
        "updatedAt": _dt(category.updated_at),
        "deletedAt": _dt(category.deleted_at),
    }


def _note_out(note: Note) -> dict:
    return {
        "id": note.id,
        "title": note.title,
        "categoryId": note.category_id,
        "summary": note.summary,
        "tags": note.tags or [],
        "content": note.content or "",
        "contentHash": _content_hash(note.content or ""),
        "isPinned": note.is_pinned,
        "isFavorite": note.is_favorite,
        "indexStatus": note.index_status,
        "createdAt": _dt(note.created_at),
        "updatedAt": _dt(note.updated_at),
        "deletedAt": _dt(note.deleted_at),
    }


def _version_out(version: NoteVersion) -> dict:
    return {
        "id": version.id,
        "noteId": version.note_id,
        "title": version.title,
        "content": version.content,
        "changeSummary": version.change_summary,
        "source": version.source,
        "createdAt": _dt(version.created_at),
    }


def _section_out(section: NoteSection) -> dict:
    return {
        "id": section.id,
        "noteId": section.note_id,
        "parentId": section.parent_id,
        "title": section.title,
        "level": section.level,
        "sortOrder": section.sort_order,
        "content": section.content,
        "tokenCount": section.token_count,
        "contentHash": section.content_hash,
        "createdAt": _dt(section.created_at),
    }


def _index_job_out(job: NoteIndexJob) -> dict:
    return {
        "id": job.id,
        "noteId": job.note_id,
        "status": job.status,
        "errorMessage": job.error_message,
        "stats": job.stats or {},
        "retryCount": job.retry_count or 0,
        "maxRetries": job.max_retries or 0,
        "nextAttemptAt": _dt(job.next_attempt_at),
        "createdAt": _dt(job.created_at),
        "startedAt": _dt(job.started_at),
        "finishedAt": _dt(job.finished_at),
        "sourceVersion": job.source_version,
        "parserVersion": job.parser_version,
        "chunkerVersion": job.chunker_version,
        "embeddingVersion": job.embedding_version,
        "graphVersion": job.graph_version,
    }


async def _ensure_category(session, user_id: str, category_id: Optional[str]):
    if not category_id:
        return
    if await NoteRepository(session).get_category(user_id, category_id) is None:
        raise HTTPException(status_code=404, detail="category not found")


async def _get_note(session, user_id: str, note_id: str, include_deleted: bool = False) -> Note:
    note = await NoteRepository(session).get(user_id, note_id, include_deleted=include_deleted)
    if note is None:
        raise HTTPException(status_code=404, detail="note not found")
    return note


async def _get_category(
    session,
    user_id: str,
    category_id: str,
    include_deleted: bool = False,
) -> NoteCategory:
    category = await NoteRepository(session).get_category(
        user_id,
        category_id,
        include_deleted=include_deleted,
    )
    if category is None:
        raise HTTPException(status_code=404, detail="category not found")
    return category


async def _descendant_category_ids(session, user_id: str, category_id: str) -> set[str]:
    return await NoteRepository(session).descendant_category_ids(user_id, category_id)


def _make_version(note: Note, source: str, change_summary: Optional[str]) -> NoteVersion:
    return NoteVersion(
        id=random_id(),
        note_id=note.id,
        user_id=note.user_id,
        title=note.title,
        content=note.content or "",
        change_summary=change_summary,
        source=source or "manual_edit",
    )


@router.get("/categories")
async def list_categories(
    includeDeleted: bool = Query(False),
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        categories = await NoteRepository(session).list_categories(user.id, include_deleted=includeDeleted)
        return {"categories": [_category_out(category) for category in categories]}


@router.post("/categories")
async def create_category(
    payload: CategoryPayload,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        await _ensure_category(session, user.id, payload.parentId)
        category = NoteCategory(
            id=(payload.id or random_id())[:64],
            user_id=user.id,
            name=_clean_category_name(payload.name),
            parent_id=payload.parentId,
            sort_order=payload.sortOrder,
        )
        session.add(category)
        await session.commit()
        await session.refresh(category)
        return {"category": _category_out(category)}


@router.put("/categories/{category_id}")
async def update_category(
    category_id: str,
    payload: CategoryPayload,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        category = await _get_category(session, user.id, category_id)
        parent_provided = "parentId" in payload.model_fields_set
        next_parent_id = payload.parentId if parent_provided else category.parent_id
        if next_parent_id == category.id:
            raise HTTPException(status_code=400, detail="category cannot be its own parent")
        if next_parent_id:
            await _ensure_category(session, user.id, next_parent_id)
            descendants = await _descendant_category_ids(session, user.id, category.id)
            if next_parent_id in descendants:
                raise HTTPException(status_code=400, detail="cannot move category into descendant")

        if "name" in payload.model_fields_set:
            category.name = _clean_category_name(payload.name)
        if parent_provided:
            category.parent_id = payload.parentId
        if "sortOrder" in payload.model_fields_set:
            category.sort_order = payload.sortOrder
        await session.commit()
        await session.refresh(category)
        return {"category": _category_out(category)}


@router.delete("/categories/{category_id}")
async def delete_category(
    category_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        await _get_category(session, user.id, category_id)
        ids = await _descendant_category_ids(session, user.id, category_id)
        deleted_at = _now()
        await NoteRepository(session).soft_delete_categories_and_notes(user.id, ids, deleted_at)
        await session.commit()
        return {"ok": True, "deletedCategoryIds": sorted(ids)}


@router.get("/notes")
async def list_notes(
    includeDeleted: bool = Query(False),
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        notes = await NoteRepository(session).list(user.id, include_deleted=includeDeleted)
        return {"notes": [_note_out(note) for note in notes]}


@router.post("/notes/search")
async def search_notes(
    payload: NoteSearchPayload,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        if payload.noteId:
            await _get_note(session, user.id, payload.noteId)
        results = await hybrid_search_notes(
            session,
            user.id,
            payload.query,
            note_id=payload.noteId,
            limit=max(1, min(payload.limit, 20)),
        )
        query_plan = understand_note_query(payload.query, note_id=payload.noteId)
        return {
            "query": {
                "originalQuery": query_plan.original_query,
                "searchQuery": query_plan.search_query,
                "intent": query_plan.intent,
                "scopeHint": query_plan.scope_hint,
                "terms": query_plan.terms,
                "rewrittenQueries": query_plan.rewritten_queries,
            },
            "results": [source_to_dict(item) for item in results],
        }


def _rag_eval_case_from_payload(payload: RagEvalCasePayload, index: int) -> RagEvalCase:
    return RagEvalCase(
        id=(payload.id or f"case-{index + 1}")[:120],
        query=payload.query.strip(),
        note_id=payload.noteId,
        expected_note_ids=payload.expectedNoteIds,
        expected_section_ids=payload.expectedSectionIds,
        expected_chunk_ids=payload.expectedChunkIds,
        expected_keywords=payload.expectedKeywords,
    )


@router.post("/notes/rag-eval")
async def evaluate_rag(
    payload: RagEvalPayload,
    user: CurrentUser = Depends(get_current_user),
):
    cases = [
        _rag_eval_case_from_payload(item, index)
        for index, item in enumerate(payload.cases[:100])
        if item.query.strip()
    ]
    if not cases:
        raise HTTPException(status_code=400, detail="at least one eval case is required")

    async with AsyncSessionLocal() as session:
        for case in cases:
            if case.note_id:
                await _get_note(session, user.id, case.note_id)
        return await run_rag_eval(
            session,
            user.id,
            cases,
            limit=max(1, min(payload.limit, 20)),
            success_at=max(1, min(payload.successAt, 20)),
            keyword_threshold=max(0.0, min(payload.keywordThreshold, 1.0)),
        )


@router.post("/notes/rag-eval/auto")
async def evaluate_rag_auto(
    payload: RagEvalAutoPayload,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        cases = await build_auto_rag_eval_cases(
            session,
            user.id,
            case_limit=max(1, min(payload.caseLimit, 100)),
        )
        return await run_rag_eval(
            session,
            user.id,
            cases,
            limit=max(1, min(payload.resultLimit, 20)),
            success_at=max(1, min(payload.successAt, 20)),
            keyword_threshold=max(0.0, min(payload.keywordThreshold, 1.0)),
        )


@router.post("/notes/context")
async def build_global_note_context(
    payload: NoteContextPayload,
    user: CurrentUser = Depends(get_current_user),
):
    if not payload.currentNoteId:
        raise HTTPException(status_code=400, detail="currentNoteId is required")
    async with AsyncSessionLocal() as session:
        note = await _get_note(session, user.id, payload.currentNoteId)
        context = await build_note_context(
            session,
            user.id,
            note,
            question=payload.question,
            selected_text=payload.selectedText,
            unsaved_content=payload.unsavedContent,
            current_section_id=payload.currentSectionId,
        )
        return {
            "contextMode": context.context_mode,
            "contextText": context.context_text,
            "sources": [source_to_dict(source) for source in context.sources],
        }


@router.post("/notes")
async def create_note(
    payload: NotePayload,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        await _ensure_category(session, user.id, payload.categoryId)
        idempotency_key = (payload.idempotencyKey or "").strip()[:160] or None
        if idempotency_key:
            existing = await NoteRepository(session).get_active_by_idempotency_key(
                user.id, idempotency_key
            )
            if existing is not None:
                return {"note": _note_out(existing)}
        note = Note(
            id=(payload.id or random_id())[:64],
            user_id=user.id,
            title=_clean_title(payload.title),
            category_id=payload.categoryId,
            summary=payload.summary,
            tags=payload.tags,
            content=payload.content,
            is_pinned=payload.isPinned,
            is_favorite=payload.isFavorite,
            index_status="pending",
            idempotency_key=idempotency_key,
        )
        session.add(note)
        await session.flush()
        await index_note_now(session, note)
        await session.commit()
        await session.refresh(note)
        return {"note": _note_out(note)}


@router.get("/notes/{note_id}")
async def get_note(
    note_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        note = await _get_note(session, user.id, note_id)
        return {"note": _note_out(note)}


@router.post("/notes/{note_id}/context")
async def build_current_note_context(
    note_id: str,
    payload: NoteContextPayload,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        note = await _get_note(session, user.id, note_id)
        context = await build_note_context(
            session,
            user.id,
            note,
            question=payload.question,
            selected_text=payload.selectedText,
            unsaved_content=payload.unsavedContent,
            current_section_id=payload.currentSectionId,
        )
        return {
            "contextMode": context.context_mode,
            "contextText": context.context_text,
            "sources": [source_to_dict(source) for source in context.sources],
        }


@router.post("/notes/{note_id}/sections/read")
async def read_current_note_sections(
    note_id: str,
    payload: ReadSectionsPayload,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        await _get_note(session, user.id, note_id)
        sections = await read_note_sections(session, user.id, note_id, payload.sectionIds)
        return {"sections": [_section_out(section) for section in sections]}


@router.put("/notes/{note_id}")
async def update_note(
    note_id: str,
    payload: NoteUpdatePayload,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        note = await _get_note(session, user.id, note_id, include_deleted=True)
        if note.deleted_at is not None:
            raise HTTPException(status_code=409, detail="note is deleted")
        category_provided = "categoryId" in payload.model_fields_set
        if category_provided and payload.categoryId is not None:
            await _ensure_category(session, user.id, payload.categoryId)

        content_conflict = (
            _has_note_content_conflict(payload.expectedContentHash, note.content or "")
            if payload.expectedContentHash
            else _has_note_version_conflict(payload.expectedUpdatedAt, note.updated_at)
        )
        if content_conflict:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "NOTE_VERSION_CONFLICT",
                    "message": "笔记已在其他设备更新，请先处理同步冲突。",
                    "currentUpdatedAt": note.updated_at.isoformat(),
                    "currentContentHash": _content_hash(note.content or ""),
                },
            )

        content_changed = payload.content is not None and payload.content != (note.content or "")
        if content_changed:
            session.add(_make_version(note, payload.source, payload.changeSummary))
            note.content = payload.content or ""
            note.index_status = payload.indexStatus or "pending"

        if payload.title is not None:
            note.title = _clean_title(payload.title)
        if category_provided:
            note.category_id = payload.categoryId
        if payload.summary is not None:
            note.summary = payload.summary
        if payload.tags is not None:
            note.tags = payload.tags
        if payload.isPinned is not None:
            note.is_pinned = payload.isPinned
        if payload.isFavorite is not None:
            note.is_favorite = payload.isFavorite
        if payload.indexStatus is not None and not content_changed:
            note.index_status = payload.indexStatus

        if content_changed:
            await index_note_now(session, note)

        await session.commit()
        await session.refresh(note)
        return {"note": _note_out(note)}


@router.delete("/notes/{note_id}")
async def delete_note(
    note_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        note = await _get_note(session, user.id, note_id)
        note.deleted_at = _now()
        await session.commit()
        return {"ok": True}


@router.post("/notes/{note_id}/restore")
async def restore_note(
    note_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        note = await _get_note(session, user.id, note_id, include_deleted=True)
        note.deleted_at = None
        await session.commit()
        await session.refresh(note)
        return {"note": _note_out(note)}


@router.get("/notes/{note_id}/versions")
async def list_note_versions(
    note_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        await _get_note(session, user.id, note_id, include_deleted=True)
        versions = await NoteRepository(session).list_versions(user.id, note_id)
        return {"versions": [_version_out(version) for version in versions]}


@router.post("/notes/{note_id}/versions/{version_id}/restore")
async def restore_note_version(
    note_id: str,
    version_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        note = await _get_note(session, user.id, note_id, include_deleted=True)
        version = await NoteRepository(session).get_version(user.id, note_id, version_id)
        if version is None:
            raise HTTPException(status_code=404, detail="version not found")

        session.add(_make_version(note, "restore", f"restore version {version.id}"))
        note.title = version.title
        note.content = version.content
        note.deleted_at = None
        await index_note_now(session, note)
        await session.commit()
        await session.refresh(note)
        return {"note": _note_out(note)}


@router.post("/notes/{note_id}/reindex")
async def reindex_note(
    note_id: str,
    payload: Optional[ReindexPayload] = None,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        note = await _get_note(session, user.id, note_id)
        job = await index_note_now(session, note)
        await session.commit()
        await session.refresh(note)
        await session.refresh(job)
        return {"note": _note_out(note), "job": _index_job_out(job)}


@router.get("/notes/{note_id}/outline")
async def get_note_outline(
    note_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        note = await _get_note(session, user.id, note_id)
        sections = await NoteRepository(session).list_sections(user.id, note.id)
        return {
            "noteId": note.id,
            "indexStatus": note.index_status,
            "sections": [_section_out(section) for section in sections],
        }


@router.get("/notes/{note_id}/embedding-status")
async def get_note_embedding_status(
    note_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        note = await _get_note(session, user.id, note_id)
        counts, latest = await NoteRepository(session).embedding_status(user.id, note.id)
        return {
            "noteId": note.id,
            "indexStatus": note.index_status,
            "embeddingCounts": counts,
            "provider": latest.provider if latest else None,
            "model": latest.embedding_model if latest else None,
            "dimensions": latest.embedding_dim if latest else None,
            "latestStatus": latest.status if latest else None,
            "latestError": latest.error_message if latest else None,
            "latestIndexedAt": _dt(latest.indexed_at) if latest else None,
        }


@router.get("/notes/{note_id}/related")
async def get_related_notes(
    note_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        note = await _get_note(session, user.id, note_id)
        related = await list_related_notes(session, user.id, note)
        return {"related": [source_to_dict(source) for source in related]}


@router.get("/index-jobs")
async def list_index_jobs(
    noteId: Optional[str] = Query(None),
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        jobs = await IndexJobRepository(session).list(user.id, note_id=noteId, limit=50)
        return {"jobs": [_index_job_out(job) for job in jobs]}


@router.post("/rag-v2/reindex")
async def reindex_rag_v2(
    payload: RagV2ReindexPayload,
    user: CurrentUser = Depends(get_current_user),
):
    from app.rag.pipeline.indexer import enqueue_rag_rebuild
    from app.services.index_worker import notify_index_worker

    async with AsyncSessionLocal() as session:
        jobs = await enqueue_rag_rebuild(
            session,
            user.id,
            note_id=payload.noteId,
            force=payload.force,
            limit=payload.limit,
        )
        if payload.noteId and not jobs:
            raise HTTPException(status_code=404, detail="note not found")
        await session.commit()
        notify_index_worker()
        return {"queued": len(jobs), "jobs": [_index_job_out(job) for job in jobs]}


@router.get("/rag-v2/index-status")
async def rag_v2_index_status(
    noteId: Optional[str] = Query(None),
    user: CurrentUser = Depends(get_current_user),
):
    from app.rag.pipeline.indexer import rag_index_diagnostics

    async with AsyncSessionLocal() as session:
        if noteId:
            await _get_note(session, user.id, noteId)
        return await rag_index_diagnostics(session, user.id, note_id=noteId)
