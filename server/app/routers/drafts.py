from __future__ import annotations

import hashlib
import re
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.database import AsyncSessionLocal
from app.deps import CurrentUser, get_current_user
from app.models.db import (
    Note,
    NoteDraft,
    NoteDraftSection,
    NoteDraftSectionVersion,
    NoteIndexJob,
    NoteVersion,
)
from app.repositories.drafts import DraftRepository
from app.repositories.index_jobs import IndexJobRepository
from app.repositories.notes import NoteRepository
from app.agent.rollout import select_child_runtime
from app.agent.write_runtime import authorize_draft_save, initialize_draft_graph, resume_draft_generation
from app.services.markdown_index import index_note_now
from app.utils import random_id

router = APIRouter(tags=["drafts"])

DRAFT_STATUSES = {
    "configuring",
    "outline_ready",
    "generating",
    "assembled",
    "saved",
    "canceled",
    "failed",
}

SECTION_STATUSES = {
    "outline_only",
    "generating",
    "generated",
    "needs_revision",
    "confirmed",
    "deleted",
    "failed",
}

HEADING_RE = re.compile(r"^(#{1,4})\s+(.+?)\s*#*\s*$")
LIST_RE = re.compile(r"^\s*(?:[-*+]\s+|\d+[.)]\s+)(.+?)\s*$")


class DraftSectionPayload(BaseModel):
    id: Optional[str] = None
    title: str = "未命名小节"
    level: int = 2
    sortOrder: int = 0
    outlineText: str = ""
    content: str = ""
    status: str = "outline_only"


class DraftCreatePayload(BaseModel):
    title: Optional[str] = None
    topic: str
    categoryId: Optional[str] = None
    noteType: str = "学习笔记"
    writingTone: str = "通俗易懂"
    noteFormat: str = "详细教程"
    headingLevel: str = "H2 / H3 / H4"
    includeCode: bool = True
    includeExercises: bool = True
    extraRequest: str = ""
    draftConfig: dict = {}
    outline: str = ""
    sections: list[DraftSectionPayload] = []
    idempotencyKey: Optional[str] = None
    bodyInstruction: str = ""


class DraftUpdatePayload(BaseModel):
    title: Optional[str] = None
    categoryId: Optional[str] = None
    outline: Optional[str] = None
    assembledContent: Optional[str] = None
    status: Optional[str] = None
    sections: Optional[list[DraftSectionPayload]] = None
    bodyInstruction: Optional[str] = None
    regenerateGenerated: bool = False
    sectionOrder: Optional[list[str]] = None


class DraftSectionUpdatePayload(BaseModel):
    title: Optional[str] = None
    level: Optional[int] = None
    sortOrder: Optional[int] = None
    outlineText: Optional[str] = None
    content: Optional[str] = None
    status: Optional[str] = None
    source: str = "revise_section"


class DraftAssemblePayload(BaseModel):
    content: Optional[str] = None


class DraftSavePayload(BaseModel):
    categoryId: Optional[str] = None
    title: Optional[str] = None
    confirm: bool = False


class DraftGenerateAllPayload(BaseModel):
    retryFailed: bool = False


def _now() -> datetime:
    return datetime.utcnow()


def _dt(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _clean_title(value: str) -> str:
    title = value.strip().removesuffix(".md").strip()
    return title[:255] or "未命名笔记"


def _clean_section_title(value: str) -> str:
    title = re.sub(r"^[#\s*+\-\d.、)）]+", "", value.strip())
    title = re.sub(r"\s+", " ", title).strip()
    return title[:255] or "未命名小节"


def _normalize_status(value: str, allowed: set[str], fallback: str) -> str:
    return value if value in allowed else fallback


def _section_status(section: NoteDraftSection) -> str:
    if section.deleted_at is not None:
        return "deleted"
    return section.status


def _section_out(section: NoteDraftSection) -> dict:
    return {
        "id": section.id,
        "draftId": section.draft_id,
        "title": section.title,
        "level": section.level,
        "sortOrder": section.sort_order,
        "outlineText": section.outline_text,
        "content": section.content,
        "status": _section_status(section),
        "createdAt": _dt(section.created_at),
        "updatedAt": _dt(section.updated_at),
        "deletedAt": _dt(section.deleted_at),
        "confirmedAt": _dt(section.confirmed_at),
    }


def _note_out(note: Note) -> dict:
    return {
        "id": note.id,
        "title": note.title,
        "categoryId": note.category_id,
        "summary": note.summary,
        "tags": note.tags or [],
        "content": note.content or "",
        "contentHash": hashlib.sha256((note.content or "").encode("utf-8")).hexdigest(),
        "isPinned": note.is_pinned,
        "isFavorite": note.is_favorite,
        "indexStatus": note.index_status,
        "createdAt": _dt(note.created_at),
        "updatedAt": _dt(note.updated_at),
        "deletedAt": _dt(note.deleted_at),
    }


def _index_job_out(job: NoteIndexJob) -> dict:
    return {
        "id": job.id,
        "noteId": job.note_id,
        "status": job.status,
        "errorMessage": job.error_message,
        "retryCount": job.retry_count or 0,
        "maxRetries": job.max_retries or 0,
        "nextAttemptAt": _dt(job.next_attempt_at),
        "createdAt": _dt(job.created_at),
        "startedAt": _dt(job.started_at),
        "finishedAt": _dt(job.finished_at),
    }


def _draft_out(draft: NoteDraft, sections: list[NoteDraftSection]) -> dict:
    return {
        "id": draft.id,
        "title": draft.title,
        "topic": draft.topic,
        "categoryId": draft.category_id,
        "noteType": draft.note_type,
        "writingTone": draft.writing_tone,
        "noteFormat": draft.note_format,
        "headingLevel": draft.heading_level,
        "includeCode": draft.include_code,
        "includeExercises": draft.include_exercises,
        "extraRequest": draft.extra_request,
        "draftConfig": draft.draft_config or {},
        "bodyInstruction": str((draft.draft_config or {}).get("bodyInstruction") or ""),
        "outline": draft.outline,
        "assembledContent": draft.assembled_content,
        "status": draft.status,
        "runtime": draft.runtime,
        "graphThreadId": draft.graph_thread_id,
        "savedNoteId": draft.saved_note_id,
        "createdAt": _dt(draft.created_at),
        "updatedAt": _dt(draft.updated_at),
        "canceledAt": _dt(draft.canceled_at),
        "savedAt": _dt(draft.saved_at),
        "sections": [_section_out(section) for section in sections],
    }


def _make_section_version(section: NoteDraftSection, source: str) -> NoteDraftSectionVersion:
    return NoteDraftSectionVersion(
        id=random_id(),
        draft_section_id=section.id,
        draft_id=section.draft_id,
        user_id=section.user_id,
        title=section.title,
        outline_text=section.outline_text,
        content=section.content,
        status=_section_status(section),
        source=source or "revise_section",
    )


def _make_note_version(note: Note) -> NoteVersion:
    return NoteVersion(
        id=random_id(),
        note_id=note.id,
        user_id=note.user_id,
        title=note.title,
        content=note.content or "",
        change_summary="AI 草稿保存为正式笔记",
        source="draft_save",
    )


def _parse_outline_sections(outline: str) -> list[DraftSectionPayload]:
    lines = outline.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    sections: list[DraftSectionPayload] = []
    current: DraftSectionPayload | None = None
    main_title = ""

    def start(title: str, level: int, line: str):
        nonlocal current
        normalized_level = max(2, min(level, 4))
        current = DraftSectionPayload(
            title=_clean_section_title(title),
            level=normalized_level,
            sortOrder=len(sections),
            outlineText=line.strip(),
            status="outline_only",
        )
        sections.append(current)

    for line in lines:
        if not line.strip():
            continue
        heading_match = HEADING_RE.match(line)
        if heading_match:
            level = len(heading_match.group(1))
            if level == 1:
                main_title = _clean_section_title(heading_match.group(2))
                current = None
                continue
            start(heading_match.group(2), level, line)
            continue

        list_match = LIST_RE.match(line)
        if list_match and current is None:
            start(list_match.group(1), 2, line)
            continue

        if current is not None:
            current.outlineText = f"{current.outlineText}\n{line}".strip()

    if not sections and outline.strip():
        sections.append(
            DraftSectionPayload(
                title=main_title or _clean_section_title(outline.splitlines()[0]),
                level=2,
                sortOrder=0,
                outlineText=outline.strip(),
                status="outline_only",
            )
        )

    return sections


def _assemble_from_sections(draft: NoteDraft, sections: list[NoteDraftSection]) -> str:
    title_pattern = re.compile(rf"(^|\n{{2,}})#\s+{re.escape(draft.title)}\s*\n+", re.IGNORECASE)
    ordered = sorted(
        [section for section in sections if section.deleted_at is None],
        key=lambda item: item.sort_order,
    )
    body_parts: list[str] = []
    for section in ordered:
        content = (section.content or "").strip()
        if content:
            body_parts.append(title_pattern.sub(lambda match: match.group(1), content).strip())
            continue
        heading = "#" * max(1, min(section.level, 4))
        outline_text = section.outline_text.strip()
        body_parts.append(f"{heading} {section.title}\n\n{outline_text}".strip())
    if body_parts:
        return "\n\n".join(body_parts).strip()
    return (draft.assembled_content or draft.outline or "").strip()


def _outline_from_sections(draft: NoteDraft, sections: list[NoteDraftSection]) -> str:
    parts = [f"# {_clean_title(draft.title)}"]
    ordered = sorted(
        [section for section in sections if section.deleted_at is None],
        key=lambda item: item.sort_order,
    )
    for section in ordered:
        lines = (section.outline_text or "").strip().splitlines()
        nested = lines[1:] if lines and re.match(r"^#{1,4}\s+", lines[0]) else lines
        parts.append("\n".join([f"## {_clean_section_title(section.title)}", *nested]).strip())
    return "\n\n".join(part for part in parts if part).strip()


async def _ensure_category(session, user_id: str, category_id: Optional[str]):
    if not category_id:
        return
    if await NoteRepository(session).get_category(user_id, category_id) is None:
        raise HTTPException(status_code=404, detail="category not found")


async def _get_draft(session, user_id: str, draft_id: str) -> NoteDraft:
    draft = await DraftRepository(session).get(user_id, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="draft not found")
    return draft


async def _get_sections(session, user_id: str, draft_id: str) -> list[NoteDraftSection]:
    return await DraftRepository(session).list_sections(user_id, draft_id)


async def _get_section(
    session,
    user_id: str,
    draft_id: str,
    section_id: str,
) -> NoteDraftSection:
    section = await DraftRepository(session).get_section(user_id, draft_id, section_id)
    if section is None:
        raise HTTPException(status_code=404, detail="draft section not found")
    return section


async def _replace_sections(
    session,
    draft: NoteDraft,
    sections: list[DraftSectionPayload],
):
    await DraftRepository(session).delete_sections(draft.user_id, draft.id)
    for index, payload in enumerate(sections):
        status = _normalize_status(payload.status, SECTION_STATUSES, "outline_only")
        deleted_at = _now() if status == "deleted" else None
        session.add(
            NoteDraftSection(
                id=(payload.id or random_id())[:64],
                draft_id=draft.id,
                user_id=draft.user_id,
                title=_clean_section_title(payload.title),
                level=max(1, min(payload.level, 4)),
                sort_order=payload.sortOrder if "sortOrder" in payload.model_fields_set else index,
                outline_text=payload.outlineText.strip(),
                content=payload.content,
                status="outline_only" if status == "deleted" else status,
                deleted_at=deleted_at,
            )
        )
    await session.flush()


@router.post("/note-drafts")
async def create_draft(
    payload: DraftCreatePayload,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        idempotency_key = (payload.idempotencyKey or "").strip()
        if idempotency_key:
            existing = await DraftRepository(session).get_by_idempotency_key(user.id, idempotency_key)
            if existing is not None:
                return {
                    "draft": _draft_out(existing, await _get_sections(session, user.id, existing.id)),
                    "idempotentReplay": True,
                }
        await _ensure_category(session, user.id, payload.categoryId)
        outline = payload.outline.strip()
        sections = payload.sections or _parse_outline_sections(outline)
        status = "outline_ready" if outline or sections else "configuring"
        draft = NoteDraft(
            id=random_id(),
            user_id=user.id,
            title=_clean_title(payload.title or payload.topic),
            topic=_clean_title(payload.topic),
            category_id=payload.categoryId,
            note_type=payload.noteType,
            writing_tone=payload.writingTone,
            note_format=payload.noteFormat,
            heading_level=payload.headingLevel,
            include_code=payload.includeCode,
            include_exercises=payload.includeExercises,
            extra_request=payload.extraRequest,
            draft_config={
                **payload.draftConfig,
                "bodyInstruction": (
                    payload.bodyInstruction
                    or str((payload.draftConfig or {}).get("bodyInstruction") or "")
                ).strip()[:4000],
                "orchestration": {
                    **dict((payload.draftConfig or {}).get("orchestration") or {}),
                    "runtime": select_child_runtime("draft"),
                    "stage": "outline_ready" if status == "outline_ready" else "requirements",
                },
            },
            outline=outline,
            status=status,
            idempotency_key=idempotency_key or None,
            runtime=select_child_runtime("draft"),
            graph_thread_id=f"draft-{random_id()}" if select_child_runtime("draft") == "langgraph" else None,
        )
        session.add(draft)
        await session.flush()
        await _replace_sections(session, draft, sections)
        await session.commit()
        await session.refresh(draft)
        if draft.runtime == "langgraph" and draft.graph_thread_id:
            initialized = await initialize_draft_graph(
                user_id=user.id, thread_id=draft.graph_thread_id,
                draft_id=draft.id, topic=draft.topic, outline=draft.outline,
            )
            if not initialized:
                draft.runtime = "legacy"
                draft.graph_thread_id = None
                await session.commit()
                await session.refresh(draft)
        return {"draft": _draft_out(draft, await _get_sections(session, user.id, draft.id))}


@router.get("/note-drafts/{draft_id}")
async def get_draft(
    draft_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        draft = await _get_draft(session, user.id, draft_id)
        sections = await _get_sections(session, user.id, draft.id)
        return {"draft": _draft_out(draft, sections)}


@router.put("/note-drafts/{draft_id}")
async def update_draft(
    draft_id: str,
    payload: DraftUpdatePayload,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        draft = await _get_draft(session, user.id, draft_id)
        if payload.categoryId is not None:
            await _ensure_category(session, user.id, payload.categoryId)
        if payload.title is not None:
            draft.title = _clean_title(payload.title)
        if "categoryId" in payload.model_fields_set:
            draft.category_id = payload.categoryId
        if payload.outline is not None:
            draft.outline = payload.outline.strip()
        if payload.assembledContent is not None:
            draft.assembled_content = payload.assembledContent.strip()
        if payload.status is not None:
            draft.status = _normalize_status(payload.status, DRAFT_STATUSES, draft.status)
        if payload.sections is not None:
            await _replace_sections(session, draft, payload.sections)
            if payload.status is None:
                draft.status = "outline_ready"
        if payload.sectionOrder is not None:
            sections = await _get_sections(session, user.id, draft.id)
            active_sections = [section for section in sections if section.deleted_at is None]
            active_ids = {section.id for section in active_sections}
            ordered_ids = payload.sectionOrder
            if len(ordered_ids) != len(set(ordered_ids)) or set(ordered_ids) != active_ids:
                raise HTTPException(status_code=400, detail="section order must contain every active section exactly once")
            order_by_id = {section_id: index for index, section_id in enumerate(ordered_ids)}
            for section in active_sections:
                section.sort_order = order_by_id[section.id]
        if "bodyInstruction" in payload.model_fields_set:
            config = dict(draft.draft_config or {})
            config["bodyInstruction"] = (payload.bodyInstruction or "").strip()[:4000]
            draft.draft_config = config
        if payload.regenerateGenerated:
            if draft.status == "generating":
                raise HTTPException(status_code=409, detail="stop generation before rewriting completed sections")
            sections = await _get_sections(session, user.id, draft.id)
            reset_ids: list[str] = []
            for section in sections:
                if section.deleted_at is None and section.content.strip():
                    section.status = "outline_only"
                    section.confirmed_at = None
                    reset_ids.append(section.id)
            if reset_ids:
                config = dict(draft.draft_config or {})
                job = dict(config.get("generationJob") or {})
                attempts = dict(job.get("attempts") or {})
                for section_id in reset_ids:
                    attempts[section_id] = 0
                job["attempts"] = attempts
                job["cancelRequested"] = False
                job["status"] = "ready"
                config["generationJob"] = job
                draft.draft_config = config
                draft.assembled_content = ""
                draft.status = "outline_ready"
        await session.commit()
        await session.refresh(draft)
        return {"draft": _draft_out(draft, await _get_sections(session, user.id, draft.id))}


@router.put("/note-drafts/{draft_id}/sections/{section_id}")
async def update_draft_section(
    draft_id: str,
    section_id: str,
    payload: DraftSectionUpdatePayload,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        draft = await _get_draft(session, user.id, draft_id)
        section = await _get_section(session, user.id, draft.id, section_id)
        session.add(_make_section_version(section, payload.source))

        if payload.title is not None:
            section.title = _clean_section_title(payload.title)
        if payload.level is not None:
            section.level = max(1, min(payload.level, 4))
        if payload.sortOrder is not None:
            section.sort_order = payload.sortOrder
        if payload.outlineText is not None:
            section.outline_text = payload.outlineText.strip()
        if payload.content is not None:
            section.content = payload.content
        if payload.status is not None:
            status = _normalize_status(payload.status, SECTION_STATUSES, section.status)
            if status == "deleted":
                section.deleted_at = _now()
            else:
                section.status = status
                if status == "confirmed":
                    section.confirmed_at = _now()
                if section.deleted_at is not None:
                    section.deleted_at = None
        structure_changed = any(
            value is not None
            for value in (payload.title, payload.level, payload.sortOrder, payload.outlineText)
        ) or payload.status in {"deleted", "outline_only"}
        content_changed = payload.content is not None
        if structure_changed or content_changed:
            draft.assembled_content = ""
            if draft.status == "assembled":
                draft.status = "outline_ready"
        if structure_changed:
            await session.flush()
            draft.outline = _outline_from_sections(
                draft,
                await _get_sections(session, user.id, draft.id),
            )
        await session.commit()
        await session.refresh(draft)
        return {"draft": _draft_out(draft, await _get_sections(session, user.id, draft.id))}


@router.post("/note-drafts/{draft_id}/sections")
async def create_draft_section(
    draft_id: str,
    payload: DraftSectionPayload,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        draft = await _get_draft(session, user.id, draft_id)
        if draft.status in {"generating", "saved", "canceled"}:
            raise HTTPException(status_code=409, detail="current draft cannot add sections")
        sections = await _get_sections(session, user.id, draft.id)
        active_sections = [item for item in sections if item.deleted_at is None]
        section = NoteDraftSection(
            id=random_id(),
            draft_id=draft.id,
            user_id=user.id,
            title=_clean_section_title(payload.title),
            level=2,
            sort_order=len(active_sections),
            outline_text=payload.outlineText.strip() or f"## {_clean_section_title(payload.title)}",
            content="",
            status="outline_only",
        )
        session.add(section)
        await session.flush()
        draft.status = "outline_ready"
        draft.assembled_content = ""
        draft.outline = _outline_from_sections(
            draft,
            await _get_sections(session, user.id, draft.id),
        )
        await session.commit()
        await session.refresh(draft)
        return {"draft": _draft_out(draft, await _get_sections(session, user.id, draft.id))}


@router.post("/note-drafts/{draft_id}/sections/{section_id}/generate")
async def generate_draft_section(
    draft_id: str,
    section_id: str,
    payload: DraftSectionUpdatePayload,
    user: CurrentUser = Depends(get_current_user),
):
    payload.status = payload.status or "generated"
    if "source" not in payload.model_fields_set:
        payload.source = "generate_section"
    return await update_draft_section(draft_id, section_id, payload, user)


@router.post("/note-drafts/{draft_id}/sections/{section_id}/confirm")
async def confirm_draft_section(
    draft_id: str,
    section_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    payload = DraftSectionUpdatePayload(status="confirmed", source="confirm_section")
    return await update_draft_section(draft_id, section_id, payload, user)


@router.post("/note-drafts/{draft_id}/sections/{section_id}/delete")
async def delete_draft_section(
    draft_id: str,
    section_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    payload = DraftSectionUpdatePayload(status="deleted", source="delete_section")
    return await update_draft_section(draft_id, section_id, payload, user)


@router.post("/note-drafts/{draft_id}/sections/{section_id}/restore")
async def restore_draft_section(
    draft_id: str,
    section_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    payload = DraftSectionUpdatePayload(status="outline_only", source="restore_section")
    return await update_draft_section(draft_id, section_id, payload, user)


@router.post("/note-drafts/{draft_id}/assemble")
async def assemble_draft(
    draft_id: str,
    payload: DraftAssemblePayload,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        draft = await _get_draft(session, user.id, draft_id)
        sections = await _get_sections(session, user.id, draft.id)
        content = payload.content.strip() if payload.content else _assemble_from_sections(draft, sections)
        if not content:
            raise HTTPException(status_code=400, detail="draft content is empty")
        draft.assembled_content = content
        draft.status = "assembled"
        await session.commit()
        await session.refresh(draft)
        return {"draft": _draft_out(draft, await _get_sections(session, user.id, draft.id))}


@router.post("/note-drafts/{draft_id}/generate-all")
async def generate_all_draft_sections(
    draft_id: str,
    payload: DraftGenerateAllPayload,
    user: CurrentUser = Depends(get_current_user),
):
    from app.services.draft_worker import notify_draft_worker

    async with AsyncSessionLocal() as session:
        draft = await _get_draft(session, user.id, draft_id)
        if draft.status == "saved":
            return {"draft": _draft_out(draft, await _get_sections(session, user.id, draft.id))}
        if draft.status == "canceled":
            raise HTTPException(status_code=409, detail="canceled draft cannot be generated")
        sections = [item for item in await _get_sections(session, user.id, draft.id) if item.deleted_at is None]
        if not sections:
            raise HTTPException(status_code=400, detail="draft has no sections")

        config = dict(draft.draft_config or {})
        previous_job = dict(config.get("generationJob") or {})
        attempts = dict(previous_job.get("attempts") or {})
        if payload.retryFailed:
            for section in sections:
                if section.status == "failed":
                    section.status = "outline_only"
                    attempts[section.id] = 0
        config["generationJob"] = {
            **previous_job,
            "status": "queued",
            "attempts": attempts,
            "cancelRequested": False,
            "error": "",
            "startedAt": previous_job.get("startedAt") or _now().isoformat(),
            "updatedAt": _now().isoformat(),
        }
        draft.draft_config = config
        draft.status = "generating"
        await session.commit()
        await session.refresh(draft)
        result = {"draft": _draft_out(draft, await _get_sections(session, user.id, draft.id))}
        if draft.runtime == "langgraph" and draft.graph_thread_id:
            resumed = await resume_draft_generation(thread_id=draft.graph_thread_id)
            if not resumed:
                draft.runtime = "legacy"
                draft.graph_thread_id = None
                await session.commit()
                await session.refresh(draft)
                result = {"draft": _draft_out(draft, await _get_sections(session, user.id, draft.id))}
    notify_draft_worker()
    return result


@router.post("/note-drafts/{draft_id}/generate-all/stop")
async def stop_all_draft_sections(
    draft_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    from app.services.draft_worker import (
        cancel_active_draft_generation,
        notify_draft_worker,
        reset_interrupted_sections,
    )

    async with AsyncSessionLocal() as session:
        draft = await _get_draft(session, user.id, draft_id)
        if draft.status not in {"generating", "failed"}:
            return {"draft": _draft_out(draft, await _get_sections(session, user.id, draft.id))}
        config = dict(draft.draft_config or {})
        job = dict(config.get("generationJob") or {})
        job["cancelRequested"] = True
        job["status"] = "stopped"
        job.pop("currentSectionId", None)
        job.pop("currentSectionTitle", None)
        job["updatedAt"] = _now().isoformat()
        config["generationJob"] = job
        draft.draft_config = config
        reset_interrupted_sections(await _get_sections(session, user.id, draft.id))
        draft.status = "outline_ready"
        await session.commit()
        await session.refresh(draft)
        result = {"draft": _draft_out(draft, await _get_sections(session, user.id, draft.id))}
    await cancel_active_draft_generation(draft_id)
    notify_draft_worker()
    return result


@router.post("/note-drafts/{draft_id}/save-to-notes")
async def save_draft_to_notes(
    draft_id: str,
    payload: DraftSavePayload,
    user: CurrentUser = Depends(get_current_user),
):
    if not payload.confirm:
        raise HTTPException(status_code=400, detail="save confirmation is required")

    async with AsyncSessionLocal() as session:
        draft = await DraftRepository(session).get_for_update(user.id, draft_id)
        if draft is None:
            raise HTTPException(status_code=404, detail="draft not found")
        if draft.saved_note_id:
            note = await NoteRepository(session).get(user.id, draft.saved_note_id)
            job = await IndexJobRepository(session).latest_for_note(user.id, draft.saved_note_id)
            if note is None:
                raise HTTPException(status_code=409, detail="draft saved note is unavailable")
            return {
                "draft": _draft_out(draft, await _get_sections(session, user.id, draft.id)),
                "note": _note_out(note),
                "job": _index_job_out(job) if job else None,
                "idempotentReplay": True,
            }
        category_id = payload.categoryId if "categoryId" in payload.model_fields_set else draft.category_id
        await _ensure_category(session, user.id, category_id)
        sections = await _get_sections(session, user.id, draft.id)
        content = (draft.assembled_content or _assemble_from_sections(draft, sections)).strip()
        if not content:
            raise HTTPException(status_code=400, detail="draft content is empty")
        if draft.runtime == "langgraph" and draft.graph_thread_id:
            authorized = await authorize_draft_save(
                thread_id=draft.graph_thread_id, assembled_content=content,
            )
            if not authorized:
                draft.runtime = "legacy"
                draft.graph_thread_id = None
        note = Note(
            id=random_id(),
            user_id=user.id,
            title=_clean_title(payload.title or draft.title),
            category_id=category_id,
            summary=None,
            tags=[],
            content=content,
            is_pinned=False,
            is_favorite=False,
            index_status="pending",
        )
        session.add(note)
        await session.flush()
        session.add(_make_note_version(note))
        job = await index_note_now(session, note)
        draft.status = "saved"
        draft.saved_note_id = note.id
        draft.saved_at = _now()
        draft.assembled_content = content
        await session.commit()
        await session.refresh(draft)
        await session.refresh(note)
        await session.refresh(job)
        return {
            "draft": _draft_out(draft, await _get_sections(session, user.id, draft.id)),
            "note": _note_out(note),
            "job": _index_job_out(job),
        }


@router.post("/note-drafts/{draft_id}/cancel")
async def cancel_draft(
    draft_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        draft = await _get_draft(session, user.id, draft_id)
        if draft.status == "saved":
            raise HTTPException(status_code=409, detail="saved draft cannot be canceled")
        draft.status = "canceled"
        draft.canceled_at = _now()
        await session.commit()
        await session.refresh(draft)
        return {"draft": _draft_out(draft, await _get_sections(session, user.id, draft.id))}
