from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import and_, select

from app.database import AsyncSessionLocal
from app.deps import CurrentUser, get_current_user
from app.models.db import (
    Note,
    NoteEditPreview,
    NoteEditPreviewRevision,
    NoteIndexJob,
    NoteSection,
    NoteVersion,
)
from app.services.markdown_index import HEADING_RE, index_note_now
from app.services.memory import build_memory_context
from app.services.note_edit import generate_edit_preview, revise_edit_preview
from app.services.user_settings import is_user_memory_enabled
from app.utils import random_id

router = APIRouter(tags=["edits"])

TARGET_TYPES = {"selection", "section", "note", "insert", "delete"}

SECTION_INTENT_RE = (
    r"(当前小节|这个小节|这一个小节|这一小节|本小节|小节|"
    r"当前章节|这个章节|这一个章节|这一章节|章节|"
    r"当前节|这一节|这节|本节|这一章|这章|本章)"
)


@dataclass
class MarkdownSectionRange:
    id: Optional[str]
    title: str
    level: int
    sort_order: int
    content: str


class EditPreviewPayload(BaseModel):
    noteId: str
    targetType: Optional[str] = None
    sectionId: Optional[str] = None
    selectedText: str = ""
    instruction: str
    keepStyle: bool = True
    memoryEnabled: bool = True


class RevisePreviewPayload(BaseModel):
    instruction: str
    memoryEnabled: bool = True


class RestorePreviewRevisionPayload(BaseModel):
    revisionId: str


def _dt(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


async def _effective_memory_enabled(session, user_id: str, requested: bool) -> bool:
    if not requested:
        return False
    return await is_user_memory_enabled(session, user_id)


def _note_out(note: Note) -> dict:
    return {
        "id": note.id,
        "title": note.title,
        "categoryId": note.category_id,
        "summary": note.summary,
        "tags": note.tags or [],
        "content": note.content or "",
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


def _edit_out(preview: NoteEditPreview) -> dict:
    return {
        "id": preview.id,
        "noteId": preview.note_id,
        "targetType": preview.target_type,
        "sectionId": preview.section_id,
        "oldContent": preview.old_content,
        "newContent": preview.new_content,
        "instruction": preview.instruction,
        "changeSummary": preview.change_summary or [],
        "status": preview.status,
        "createdAt": _dt(preview.created_at),
        "updatedAt": _dt(preview.updated_at),
        "appliedAt": _dt(preview.applied_at),
        "cancelledAt": _dt(preview.cancelled_at),
    }


def _edit_revision_out(revision: NoteEditPreviewRevision) -> dict:
    return {
        "id": revision.id,
        "editId": revision.edit_id,
        "newContent": revision.new_content,
        "instruction": revision.instruction,
        "changeSummary": revision.change_summary or [],
        "source": revision.source,
        "createdAt": _dt(revision.created_at),
    }


def _make_edit_revision(preview: NoteEditPreview, *, source: str) -> NoteEditPreviewRevision:
    return NoteEditPreviewRevision(
        id=random_id(),
        edit_id=preview.id,
        user_id=preview.user_id,
        new_content=preview.new_content or "",
        instruction=preview.instruction or "",
        change_summary=preview.change_summary or [],
        source=source,
    )


async def _get_note(session, user_id: str, note_id: str) -> Note:
    result = await session.execute(
        select(Note).where(Note.id == note_id, Note.user_id == user_id, Note.deleted_at.is_(None))
    )
    note = result.scalar_one_or_none()
    if note is None:
        raise HTTPException(status_code=404, detail="note not found")
    return note


async def _get_preview(session, user_id: str, edit_id: str) -> NoteEditPreview:
    result = await session.execute(
        select(NoteEditPreview).where(
            NoteEditPreview.id == edit_id,
            NoteEditPreview.user_id == user_id,
        )
    )
    preview = result.scalar_one_or_none()
    if preview is None:
        raise HTTPException(status_code=404, detail="edit preview not found")
    return preview


async def _get_sections(session, user_id: str, note_id: str) -> list[NoteSection]:
    result = await session.execute(
        select(NoteSection)
        .where(NoteSection.user_id == user_id, NoteSection.note_id == note_id)
        .order_by(NoteSection.sort_order)
    )
    return list(result.scalars().all())


async def _get_section(
    session,
    user_id: str,
    note_id: str,
    section_id: str,
) -> NoteSection:
    result = await session.execute(
        select(NoteSection).where(
            NoteSection.id == section_id,
            NoteSection.user_id == user_id,
            NoteSection.note_id == note_id,
        )
    )
    section = result.scalar_one_or_none()
    if section is None:
        raise HTTPException(status_code=404, detail="section not found")
    return section


def _instruction_requests_section(instruction: str) -> bool:
    return bool(instruction and re.search(SECTION_INTENT_RE, instruction))


def _normalize_target_type(
    value: Optional[str],
    selected_text: str,
    section_id: Optional[str],
    instruction: str = "",
) -> str:
    if value in TARGET_TYPES:
        return value
    if section_id:
        return "section"
    if _instruction_requests_section(instruction):
        return "section"
    if selected_text.strip():
        return "selection"
    return "note"


def _find_instruction_sections(instruction: str, sections: list[NoteSection]) -> list[NoteSection]:
    normalized = instruction.replace(" ", "")
    matches: list[NoteSection] = []
    for section in sections:
        title = section.title.replace(" ", "")
        if title and title in normalized:
            matches.append(section)
    return matches


def _normalized_text_only(value: str) -> str:
    normalized, _ = _normalized_match_text(value)
    return normalized


def _section_match_score(section: NoteSection, selected: str) -> int:
    selected_norm = _normalized_text_only(selected)
    if not selected_norm:
        return 0

    title_norm = _normalized_text_only(section.title or "")
    content = section.content or ""
    content_norm = _normalized_text_only(content)

    if title_norm and selected_norm == title_norm:
        return 100
    if title_norm and len(selected_norm) >= 6 and selected_norm in title_norm:
        return 90
    if title_norm and len(title_norm) >= 6 and title_norm in selected_norm:
        return 85
    if selected in content:
        return 80
    if _find_normalized_span(content, selected) or _find_anchor_span(content, selected):
        return 75
    if len(selected_norm) >= 12 and selected_norm in content_norm:
        return 65
    return 0


def _find_section_from_selected_text(sections: list[NoteSection], selected: str) -> NoteSection | None:
    scored = [
        (score, section)
        for section in sections
        if (score := _section_match_score(section, selected)) > 0
    ]
    if not scored:
        return None

    def sort_key(item):
        score, section = item
        depth = int(getattr(section, "level", 0) or 0) if score < 90 else 0
        sort_order = int(getattr(section, "sort_order", 0) or 0)
        return (score, depth, -sort_order)

    scored.sort(key=sort_key, reverse=True)
    return scored[0][1]


def _clean_heading_title(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip())[:255] or "未命名小节"


def _parse_markdown_section_ranges(markdown: str) -> list[MarkdownSectionRange]:
    text = (markdown or "").replace("\r\n", "\n").replace("\r", "\n")
    if not text.strip():
        return []

    lines = text.split("\n")
    offsets: list[int] = []
    cursor = 0
    for index, line in enumerate(lines):
        offsets.append(cursor)
        cursor += len(line)
        if index < len(lines) - 1:
            cursor += 1

    headings: list[tuple[int, int, int, str]] = []
    for line_index, line in enumerate(lines):
        match = HEADING_RE.match(line)
        if match:
            headings.append(
                (
                    line_index,
                    offsets[line_index],
                    len(match.group(1)),
                    _clean_heading_title(match.group(2)),
                )
            )

    if not headings:
        return [MarkdownSectionRange(None, "正文", 1, 0, text.strip())]

    ranges: list[MarkdownSectionRange] = []
    for heading_index, (_line_index, start, level, title) in enumerate(headings):
        end = len(text)
        for _next_line_index, next_start, next_level, _next_title in headings[heading_index + 1 :]:
            if next_level <= level:
                end = next_start
                break
        ranges.append(
            MarkdownSectionRange(
                id=None,
                title=title,
                level=level,
                sort_order=heading_index,
                content=text[start:end].strip(),
            )
        )

    return ranges


def _find_section_from_note_content(note_content: str, selected: str):
    sections = _parse_markdown_section_ranges(note_content or "")
    return _find_section_from_selected_text(sections, selected)


def _current_section_content(note_content: str, section: NoteSection, selected: str = "") -> str:
    content = getattr(section, "content", "") or ""
    title = getattr(section, "title", "") or ""
    for locator in (selected, title):
        fallback = _find_section_from_note_content(note_content, locator)
        if fallback is not None:
            return fallback.content

    if content:
        resolved = _resolve_selected_content(note_content, content)
        if content in note_content or resolved != content:
            return resolved

    return content


def _normalized_match_text(value: str) -> tuple[str, list[int]]:
    chars: list[str] = []
    source_indexes: list[int] = []
    for index, char in enumerate(value):
        if char.isalnum():
            chars.append(char.lower())
            source_indexes.append(index)
    return "".join(chars), source_indexes


def _expand_inline_markers(full_text: str, start: int, end: int) -> tuple[int, int]:
    if start >= 2 and full_text[start - 2 : start] == "**" and full_text[end : end + 2] == "**":
        start -= 2
        end += 2
    elif start >= 1 and full_text[start - 1] in {"*", "_", "`"} and full_text[end : end + 1] == full_text[start - 1]:
        start -= 1
        end += 1

    line_start = full_text.rfind("\n", 0, start) + 1
    prefix = full_text[line_start:start]
    markdown_prefix_chars = set(" \t\u00a0#>*+-_.`\\0123456789)）(")
    if prefix and all(char in markdown_prefix_chars for char in prefix):
        start = line_start

    return start, end


def _source_span_from_normalized(
    full_text: str,
    source_indexes: list[int],
    normalized_start: int,
    normalized_length: int,
) -> tuple[int, int]:
    start = source_indexes[normalized_start]
    end = source_indexes[normalized_start + normalized_length - 1] + 1
    return _expand_inline_markers(full_text, start, end)


def _find_normalized_span(full_text: str, target: str) -> tuple[int, int] | None:
    normalized_target, _ = _normalized_match_text(target)
    if len(normalized_target) < 8:
        return None

    normalized_full, source_indexes = _normalized_match_text(full_text)
    normalized_index = normalized_full.find(normalized_target)
    if normalized_index < 0:
        return None

    return _source_span_from_normalized(full_text, source_indexes, normalized_index, len(normalized_target))


def _find_anchor_span(full_text: str, target: str) -> tuple[int, int] | None:
    normalized_target, _ = _normalized_match_text(target)
    if len(normalized_target) < 120:
        return None

    normalized_full, source_indexes = _normalized_match_text(full_text)
    anchor_sizes = (120, 90, 60, 40, 30, 24, 20, 16, 12)
    for prefix_size in anchor_sizes:
        if len(normalized_target) < prefix_size * 2:
            continue

        prefix = normalized_target[:prefix_size]
        prefix_index = normalized_full.find(prefix)
        if prefix_index < 0:
            continue

        for suffix_size in anchor_sizes:
            if len(normalized_target) < prefix_size + suffix_size:
                continue
            suffix = normalized_target[-suffix_size:]
            suffix_index = normalized_full.find(suffix, prefix_index + prefix_size)
            if suffix_index < 0:
                suffix_index = normalized_full.rfind(suffix)
            if suffix_index < prefix_index:
                continue

            normalized_span_length = suffix_index + suffix_size - prefix_index
            allowed_length = max(len(normalized_target) * 2, len(normalized_target) + 500)
            if normalized_span_length > allowed_length:
                continue

            start, _ = _source_span_from_normalized(full_text, source_indexes, prefix_index, prefix_size)
            _, end = _source_span_from_normalized(full_text, source_indexes, suffix_index, suffix_size)
            return start, end

    return None


def _resolve_selected_content(full_text: str, selected: str) -> str:
    if not selected:
        return selected
    if selected in full_text:
        return selected

    span = _find_normalized_span(full_text, selected) or _find_anchor_span(full_text, selected)
    if not span:
        return selected

    start, end = span
    return full_text[start:end]


async def _resolve_target(
    session,
    user_id: str,
    note: Note,
    payload: EditPreviewPayload,
) -> tuple[str, Optional[str], str, str]:
    target_type = _normalize_target_type(
        payload.targetType,
        payload.selectedText,
        payload.sectionId,
        payload.instruction,
    )
    selected = payload.selectedText.strip()
    note_content = note.content or ""

    if selected and target_type == "section":
        sections = await _get_sections(session, user_id, note.id)
        section = _find_section_from_selected_text(sections, selected)
        section_id = section.id if section else None
        if section is None:
            section = _find_section_from_note_content(note_content, selected)
        if section is not None:
            return "section", section_id, _current_section_content(note_content, section, selected), f"小节：{section.title}"
        return "selection", None, _resolve_selected_content(note_content, selected), "用户选中的文本"

    if selected and target_type in {"selection", "insert", "delete"}:
        return target_type, None, _resolve_selected_content(note_content, selected), "用户选中的文本"

    if target_type == "selection":
        if not selected:
            raise HTTPException(status_code=400, detail="selectedText is required for selection edit")
        return target_type, None, _resolve_selected_content(note_content, selected), "用户选中的文本"

    sections = await _get_sections(session, user_id, note.id)
    section_id = payload.sectionId
    if not section_id and target_type in {"section", "insert", "delete"}:
        matches = _find_instruction_sections(payload.instruction, sections)
        if len(matches) > 1:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "multiple sections matched",
                    "sections": [{"id": section.id, "title": section.title} for section in matches],
                },
            )
        if len(matches) == 1:
            section_id = matches[0].id

    if section_id:
        section = await _get_section(session, user_id, note.id, section_id)
        return (
            "section" if target_type not in {"insert", "delete"} else target_type,
            section.id,
            _current_section_content(note_content, section),
            f"小节：{section.title}",
        )

    if target_type == "section":
        section = _find_section_from_note_content(note_content, payload.instruction)
        if section is not None:
            return "section", None, section.content, f"小节：{section.title}"
        raise HTTPException(status_code=400, detail="修改小节需要选中文本、sectionId，或在指令中包含明确的小节标题。")

    if target_type in {"insert", "delete"}:
        raise HTTPException(status_code=400, detail="insert/delete requires a selected text or section")

    return "note", None, note_content, "当前整篇笔记"


def _make_version(note: Note, preview: NoteEditPreview) -> NoteVersion:
    return NoteVersion(
        id=random_id(),
        note_id=note.id,
        user_id=note.user_id,
        title=note.title,
        content=note.content or "",
        change_summary=f"AI 修改预览应用：{preview.instruction[:160]}",
        source="ai_edit",
    )


def _replace_once(full_text: str, old: str, new: str) -> str:
    if not old:
        return full_text
    index = full_text.find(old)
    if index >= 0:
        return full_text[:index] + new + full_text[index + len(old):]

    span = _find_normalized_span(full_text, old) or _find_anchor_span(full_text, old)
    if not span:
        raise HTTPException(status_code=409, detail="目标原文已不在当前笔记中，请重新选择要修改的内容后再试。")

    start, end = span
    return full_text[:start] + new + full_text[end:]


def _apply_preview_content(note: Note, preview: NoteEditPreview) -> str:
    content = note.content or ""
    new_content = preview.new_content or ""

    if preview.target_type == "note":
        return new_content
    if preview.target_type == "insert":
        return _replace_once(content, preview.old_content, f"{preview.old_content}\n\n{new_content}".strip())
    if preview.target_type in {"selection", "section", "delete"}:
        replacement = "" if preview.target_type == "delete" else new_content
        return _replace_once(content, preview.old_content, replacement)

    raise HTTPException(status_code=400, detail="unsupported target type")


@router.post("/note-edit-previews")
async def create_edit_preview(
    payload: EditPreviewPayload,
    user: CurrentUser = Depends(get_current_user),
):
    if not payload.instruction.strip():
        raise HTTPException(status_code=400, detail="instruction is required")

    async with AsyncSessionLocal() as session:
        note = await _get_note(session, user.id, payload.noteId)
        target_type, section_id, old_content, target_label = await _resolve_target(
            session,
            user.id,
            note,
            payload,
        )
        if target_type == "delete":
            new_content = ""
            change_summary = ["删除目标范围内容"]
        else:
            memory_context = ""
            if await _effective_memory_enabled(session, user.id, payload.memoryEnabled):
                memory_context = await build_memory_context(
                    session,
                    user.id,
                    query=payload.instruction,
                    scopes=["note_editing", "note_generation", "learning"],
                    memory_types=["identity", "personal_info", "interest", "preference", "writing_style", "constraint", "workflow"],
                )
            result = await generate_edit_preview(
                note_title=note.title,
                target_type=target_type,
                target_content=old_content,
                instruction=payload.instruction,
                neighbor_context=target_label,
                keep_style=payload.keepStyle,
                memory_context=memory_context,
            )
            new_content = result.new_content
            change_summary = result.change_summary

        preview = NoteEditPreview(
            id=random_id(),
            user_id=user.id,
            note_id=note.id,
            target_type=target_type,
            section_id=section_id,
            old_content=old_content,
            new_content=new_content,
            instruction=payload.instruction.strip(),
            change_summary=change_summary,
            status="preview",
        )
        session.add(preview)
        session.add(_make_edit_revision(preview, source="generated"))
        await session.commit()
        await session.refresh(preview)
        return {"preview": _edit_out(preview)}


@router.get("/note-edit-previews/{edit_id}")
async def get_edit_preview(
    edit_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        preview = await _get_preview(session, user.id, edit_id)
        return {"preview": _edit_out(preview)}


@router.get("/note-edit-previews/{edit_id}/revisions")
async def list_edit_preview_revisions(
    edit_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        await _get_preview(session, user.id, edit_id)
        result = await session.execute(
            select(NoteEditPreviewRevision)
            .where(
                NoteEditPreviewRevision.edit_id == edit_id,
                NoteEditPreviewRevision.user_id == user.id,
            )
            .order_by(NoteEditPreviewRevision.created_at, NoteEditPreviewRevision.id)
        )
        return {"revisions": [_edit_revision_out(item) for item in result.scalars().all()]}


@router.post("/note-edit-previews/{edit_id}/restore-revision")
async def restore_edit_preview_revision(
    edit_id: str,
    payload: RestorePreviewRevisionPayload,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        preview = await _get_preview(session, user.id, edit_id)
        if preview.status != "preview":
            raise HTTPException(status_code=409, detail="edit preview is not active")
        result = await session.execute(
            select(NoteEditPreviewRevision).where(
                NoteEditPreviewRevision.id == payload.revisionId,
                NoteEditPreviewRevision.edit_id == edit_id,
                NoteEditPreviewRevision.user_id == user.id,
            )
        )
        revision = result.scalar_one_or_none()
        if revision is None:
            raise HTTPException(status_code=404, detail="edit preview revision not found")
        preview.new_content = revision.new_content
        preview.change_summary = revision.change_summary or []
        preview.instruction = revision.instruction
        await session.commit()
        await session.refresh(preview)
        return {"preview": _edit_out(preview)}


@router.post("/note-edit-previews/{edit_id}/revise")
async def revise_preview(
    edit_id: str,
    payload: RevisePreviewPayload,
    user: CurrentUser = Depends(get_current_user),
):
    if not payload.instruction.strip():
        raise HTTPException(status_code=400, detail="instruction is required")

    async with AsyncSessionLocal() as session:
        preview = await _get_preview(session, user.id, edit_id)
        if preview.status != "preview":
            raise HTTPException(status_code=409, detail="edit preview is not active")
        note = await _get_note(session, user.id, preview.note_id)
        preview.old_content = _resolve_selected_content(note.content or "", preview.old_content or "")
        memory_context = ""
        if await _effective_memory_enabled(session, user.id, payload.memoryEnabled):
            memory_context = await build_memory_context(
                session,
                user.id,
                query=payload.instruction,
                scopes=["note_editing", "note_generation", "learning"],
                memory_types=["identity", "personal_info", "interest", "preference", "writing_style", "constraint", "workflow"],
            )
        result = await revise_edit_preview(
            note_title=note.title,
            target_type=preview.target_type,
            original_content=preview.old_content,
            current_preview=preview.new_content,
            instruction=payload.instruction,
            memory_context=memory_context,
        )
        preview.new_content = result.new_content
        preview.change_summary = result.change_summary
        preview.instruction = f"{preview.instruction}\n\n继续调整：{payload.instruction.strip()}"
        session.add(_make_edit_revision(preview, source="revision"))
        await session.commit()
        await session.refresh(preview)
        return {"preview": _edit_out(preview)}


@router.post("/note-edit-previews/{edit_id}/apply")
async def apply_preview(
    edit_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        preview = await _get_preview(session, user.id, edit_id)
        if preview.status != "preview":
            raise HTTPException(status_code=409, detail="edit preview is not active")
        note = await _get_note(session, user.id, preview.note_id)
        session.add(_make_version(note, preview))
        note.content = _apply_preview_content(note, preview)
        note.index_status = "pending"
        job = await index_note_now(session, note)
        preview.status = "applied"
        preview.applied_at = datetime.utcnow()
        await session.commit()
        await session.refresh(preview)
        await session.refresh(note)
        await session.refresh(job)
        return {
            "preview": _edit_out(preview),
            "note": _note_out(note),
            "job": _index_job_out(job),
        }


@router.post("/note-edit-previews/{edit_id}/cancel")
async def cancel_preview(
    edit_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    async with AsyncSessionLocal() as session:
        preview = await _get_preview(session, user.id, edit_id)
        if preview.status != "preview":
            raise HTTPException(status_code=409, detail="edit preview is not active")
        preview.status = "cancelled"
        preview.cancelled_at = datetime.utcnow()
        await session.commit()
        await session.refresh(preview)
        return {"preview": _edit_out(preview)}
