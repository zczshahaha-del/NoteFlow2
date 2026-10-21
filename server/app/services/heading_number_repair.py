"""Explicit operator repair. Never imported by ordinary read/write endpoints."""
import hashlib
from dataclasses import dataclass, asdict

from sqlalchemy import select

from app.models.db import Note, NoteVersion, NoteEditPreview
from app.services.heading_numbers import markdown_headings, number_markdown_headings, _without_ordinal
from app.services.markdown_index import index_note_now
from app.utils import random_id


def content_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def heading_only_fingerprint(content: str) -> str:
    """Remove only recognized ordinal spans; retain all other source bytes."""
    lines = content.splitlines(keepends=True)
    for heading in markdown_headings(content):
        line = lines[heading.line]
        lines[heading.line] = line[:heading.column] + _without_ordinal(heading.raw, heading.plain) + line[heading.column + len(heading.raw):]
    return "".join(lines)


@dataclass
class RepairResult:
    note_id: str
    source_hash: str
    target_hash: str
    changed_headings: int
    backup_version_id: str | None = None


async def repair_heading_numbers(session, user_id: str, targets: dict[str, tuple[str, str] | None], *, apply: bool = False) -> list[dict]:
    """Caller owns transaction. Validate the entire exact scope before any write.
    Apply requires reviewed source AND target hashes, and version backup precedes
    indexing. A mismatch or pending preview aborts all selected notes."""
    if not user_id or not targets:
        raise ValueError("必须指定账户和精确笔记 ID")
    planned = []
    for note_id, expected in targets.items():
        statement = select(Note).where(Note.id == note_id, Note.user_id == user_id, Note.deleted_at.is_(None))
        if apply:
            statement = statement.with_for_update()
        note = (await session.execute(statement)).scalar_one_or_none()
        if note is None:
            raise ValueError("指定笔记不属于该账户或已删除")
        pending = await session.scalar(select(NoteEditPreview.id).where(NoteEditPreview.note_id == note_id, NoteEditPreview.user_id == user_id, NoteEditPreview.status == "preview").limit(1))
        if pending:
            raise ValueError("笔记有待确认 AI 预览，请先处理预览，未修改原文")
        original = note.content or ""
        proposed = number_markdown_headings(original, note.title)
        old, new = markdown_headings(original), markdown_headings(proposed)
        if [(h.line, h.level) for h in old] != [(h.line, h.level) for h in new] or heading_only_fingerprint(original) != heading_only_fingerprint(proposed):
            raise ValueError("差异不只涉及标题序号，未修改原文")
        result = RepairResult(note_id, content_hash(original), content_hash(proposed), sum(a.raw != b.raw for a, b in zip(old, new)))
        if (apply and expected is None) or (expected is not None and expected != (result.source_hash, result.target_hash)):
            raise ValueError("内容或预期差异已变化，请重新只读核对")
        planned.append((note, proposed, result))
    if apply:
        for note, proposed, result in planned:
            if proposed == (note.content or ""):
                continue
            result.backup_version_id = random_id()
            session.add(NoteVersion(id=result.backup_version_id, note_id=note.id, user_id=user_id, title=note.title, content=note.content or "", source="heading_number_repair", change_summary="一次性恢复可编辑的标题序号；正文与代码不变"))
            note.content, note.index_status = proposed, "pending"
            await session.flush()
            await index_note_now(session, note)
    return [asdict(result) for _, _, result in planned]
