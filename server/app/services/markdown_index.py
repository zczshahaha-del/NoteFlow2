from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import cfg
from app.models.db import Note, NoteChunk, NoteEmbedding, NoteIndexJob, NoteSection
from app.services.embedding_index import index_note_chunk_embeddings
from app.services.embeddings import chunk_embedding_text, content_hash, embedding_enabled
from app.utils import random_id
from app.services.observability import record_metric

HEADING_RE = re.compile(r"^(#{1,4})\s+(.+?)\s*#*\s*$")
MAX_CHUNK_CHARS = 1600


@dataclass
class ParsedSection:
    id: str
    parent_id: str | None
    title: str
    level: int
    sort_order: int
    content: str
    token_count: int


def _estimate_tokens(text: str) -> int:
    compact = re.sub(r"\s+", "", text)
    return max(1, len(compact))


def _clean_heading(value: str) -> str:
    title = re.sub(r"\s+", " ", value.strip())
    return title[:255] or "未命名小节"


def _section_hash(title: str, content: str) -> str:
    return content_hash(f"{title}\n{content}")


def _chunk_hash(note: Note, section_title: str, chunk: str) -> str:
    return content_hash(
        chunk_embedding_text(
            note_title=note.title,
            section_title=section_title,
            chunk_content=chunk,
            tags=note.tags or [],
        )
    )


def parse_markdown_sections(markdown: str) -> list[ParsedSection]:
    lines = markdown.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    sections: list[dict] = []
    stack: dict[int, str] = {}
    current: dict | None = None

    def start_section(title: str, level: int, heading_line: str | None = None):
        nonlocal current
        section_id = random_id()
        parent_id = None
        for parent_level in range(level - 1, 0, -1):
            if parent_level in stack:
                parent_id = stack[parent_level]
                break

        stack[level] = section_id
        for existing_level in list(stack.keys()):
            if existing_level > level:
                del stack[existing_level]

        current = {
            "id": section_id,
            "parent_id": parent_id,
            "title": _clean_heading(title),
            "level": level,
            "lines": [heading_line] if heading_line else [],
        }
        sections.append(current)

    for line in lines:
        match = HEADING_RE.match(line)
        if match:
            level = len(match.group(1))
            start_section(match.group(2), level, line)
            continue

        if current is None:
            if not line.strip():
                continue
            start_section("正文", 1)
        current["lines"].append(line)

    if not sections:
        start_section("正文", 1)

    parsed: list[ParsedSection] = []
    for index, section in enumerate(sections):
        content = "\n".join(section["lines"]).strip()
        parsed.append(
            ParsedSection(
                id=section["id"],
                parent_id=section["parent_id"],
                title=section["title"],
                level=section["level"],
                sort_order=index,
                content=content,
                token_count=_estimate_tokens(content),
            )
        )

    return parsed


def split_section_chunks(content: str, max_chars: int = MAX_CHUNK_CHARS) -> list[str]:
    normalized = content.strip()
    if not normalized:
        return [""]
    if len(normalized) <= max_chars:
        return [normalized]

    paragraphs = re.split(r"\n{2,}", normalized)
    chunks: list[str] = []
    current = ""

    def push_current():
        nonlocal current
        text = current.strip()
        if text:
            chunks.append(text)
        current = ""

    for paragraph in paragraphs:
        paragraph = paragraph.strip()
        if not paragraph:
            continue
        if len(paragraph) > max_chars:
            push_current()
            for start in range(0, len(paragraph), max_chars):
                chunks.append(paragraph[start : start + max_chars].strip())
            continue

        next_value = f"{current}\n\n{paragraph}".strip() if current else paragraph
        if len(next_value) > max_chars:
            push_current()
            current = paragraph
        else:
            current = next_value

    push_current()
    return chunks or [normalized[:max_chars]]


async def create_index_job(session: AsyncSession, note: Note) -> NoteIndexJob:
    source_version = content_hash(getattr(note, "content", "") or "")
    existing_result = await session.execute(
        select(NoteIndexJob)
        .where(
            NoteIndexJob.note_id == note.id,
            NoteIndexJob.user_id == note.user_id,
            NoteIndexJob.status == "pending",
        )
        .order_by(NoteIndexJob.created_at.desc())
        .limit(1)
    )
    existing = existing_result.scalar_one_or_none()
    if existing is not None:
        existing.next_attempt_at = None
        existing.source_version = source_version
        existing.parser_version = "markdown-v1"
        existing.chunker_version = f"chars-{MAX_CHUNK_CHARS}"
        existing.embedding_version = f"{cfg.EMBEDDING_PROVIDER}:{cfg.EMBEDDING_MODEL}:{cfg.EMBEDDING_DIMENSIONS}"
        note.index_status = "outdated"
        await session.flush()
        return existing
    job = NoteIndexJob(
        id=random_id(),
        note_id=note.id,
        user_id=note.user_id,
        status="pending",
        retry_count=0,
        max_retries=3,
        source_version=source_version,
        parser_version="markdown-v1",
        chunker_version=f"chars-{MAX_CHUNK_CHARS}",
        embedding_version=f"{cfg.EMBEDDING_PROVIDER}:{cfg.EMBEDDING_MODEL}:{cfg.EMBEDDING_DIMENSIONS}",
    )
    note.index_status = "outdated"
    session.add(job)
    await session.flush()
    return job


async def run_index_job(session: AsyncSession, note: Note, job: NoteIndexJob) -> NoteIndexJob:
    job.status = "running"
    job.started_at = datetime.utcnow()
    job.error_code = None
    note.index_status = "indexing"
    await session.flush()

    try:
        old_sections_result = await session.execute(select(NoteSection).where(NoteSection.note_id == note.id))
        old_chunks_result = await session.execute(select(NoteChunk).where(NoteChunk.note_id == note.id))
        old_embeddings_result = await session.execute(select(NoteEmbedding).where(NoteEmbedding.note_id == note.id))
        old_sections = old_sections_result.scalars().all()
        old_chunks = old_chunks_result.scalars().all()
        old_embeddings = old_embeddings_result.scalars().all()
        old_sections_by_id = {section.id: section for section in old_sections}
        old_sections_by_hash: dict[str, list[NoteSection]] = {}
        old_chunks_by_hash: dict[str, list[NoteChunk]] = {}
        old_embeddings_by_chunk_id: dict[str, list[NoteEmbedding]] = {}
        for section in old_sections:
            old_sections_by_hash.setdefault(section.content_hash or _section_hash(section.title, section.content), []).append(section)
        for chunk in old_chunks:
            old_section = old_sections_by_id.get(chunk.section_id)
            fallback_hash = _chunk_hash(note, old_section.title if old_section else "", chunk.content)
            old_chunks_by_hash.setdefault(chunk.content_hash or fallback_hash, []).append(chunk)
        for embedding in old_embeddings:
            old_embeddings_by_chunk_id.setdefault(embedding.chunk_id, []).append(embedding)

        def reusable_embedding_for(chunk_id: str, chunk_hash: str) -> NoteEmbedding | None:
            configured = embedding_enabled()
            candidates = sorted(
                old_embeddings_by_chunk_id.get(chunk_id, []),
                key=lambda item: item.indexed_at or item.updated_at or item.created_at or datetime.min,
                reverse=True,
            )
            for candidate in candidates:
                if candidate.content_hash != chunk_hash:
                    continue
                if candidate.provider != cfg.EMBEDDING_PROVIDER:
                    continue
                if candidate.embedding_model != cfg.EMBEDDING_MODEL:
                    continue
                if candidate.embedding_dim != cfg.EMBEDDING_DIMENSIONS:
                    continue
                if candidate.status == "indexed" and candidate.embedding is not None:
                    return candidate
                if not configured and candidate.status == "skipped":
                    return candidate
            return None

        parsed_sections = parse_markdown_sections(note.content or "")
        section_rows: list[NoteSection] = []
        section_by_parsed_id: dict[str, NoteSection] = {}
        used_section_ids: set[str] = set()
        for section in parsed_sections:
            section_hash = _section_hash(section.title, section.content)
            reusable_section = None
            for candidate in old_sections_by_hash.get(section_hash, []):
                if candidate.id not in used_section_ids:
                    reusable_section = candidate
                    break
            row = reusable_section or NoteSection(id=section.id)
            row.note_id = note.id
            row.user_id = note.user_id
            row.parent_id = None
            row.title = section.title
            row.level = section.level
            row.sort_order = section.sort_order
            row.content = section.content
            row.token_count = section.token_count
            row.content_hash = section_hash
            used_section_ids.add(row.id)
            section_rows.append(row)
            section_by_parsed_id[section.id] = row
            session.add(row)

        # Persist every reused/new section without a parent first. SQLAlchemy does
        # not have an ORM relationship for this self-reference, so assigning raw
        # parent_id values before the initial flush can emit child updates before
        # newly-created parent rows and violate the FK constraint.
        await session.flush()

        for section in parsed_sections:
            row = section_by_parsed_id[section.id]
            parent_row = section_by_parsed_id.get(section.parent_id or "")
            row.parent_id = parent_row.id if parent_row else None

        await session.flush()

        chunk_rows: list[NoteChunk] = []
        chunks_to_embed: list[NoteChunk] = []
        used_chunk_ids: set[str] = set()
        used_embedding_ids: set[str] = set()
        reused_embeddings = 0
        for section in parsed_sections:
            section_row = section_by_parsed_id[section.id]
            for chunk_index, chunk in enumerate(split_section_chunks(section.content)):
                chunk_hash = _chunk_hash(note, section.title, chunk)
                reusable_chunk = None
                for candidate in old_chunks_by_hash.get(chunk_hash, []):
                    if candidate.id not in used_chunk_ids:
                        reusable_chunk = candidate
                        break
                row = reusable_chunk or NoteChunk(id=random_id())
                row.note_id = note.id
                row.section_id = section_row.id
                row.user_id = note.user_id
                row.chunk_index = chunk_index
                row.content = chunk
                row.token_count = _estimate_tokens(chunk)
                row.content_hash = chunk_hash
                used_chunk_ids.add(row.id)
                chunk_rows.append(row)
                session.add(row)
                reusable_embedding = reusable_embedding_for(row.id, chunk_hash)
                if reusable_embedding:
                    reusable_embedding.note_id = note.id
                    reusable_embedding.section_id = row.section_id
                    reusable_embedding.chunk_id = row.id
                    reusable_embedding.updated_at = datetime.utcnow()
                    session.add(reusable_embedding)
                    used_embedding_ids.add(reusable_embedding.id)
                    reused_embeddings += 1
                else:
                    chunks_to_embed.append(row)

        await session.flush()
        stale_embedding_ids = [embedding.id for embedding in old_embeddings if embedding.id not in used_embedding_ids]
        stale_chunk_ids = [chunk.id for chunk in old_chunks if chunk.id not in used_chunk_ids]
        stale_section_ids = [section.id for section in old_sections if section.id not in used_section_ids]
        if stale_embedding_ids:
            await session.execute(delete(NoteEmbedding).where(NoteEmbedding.id.in_(stale_embedding_ids)))
        if stale_chunk_ids:
            await session.execute(delete(NoteChunk).where(NoteChunk.id.in_(stale_chunk_ids)))
        if stale_section_ids:
            await session.execute(delete(NoteSection).where(NoteSection.id.in_(stale_section_ids)))
        await session.flush()

        stats = await index_note_chunk_embeddings(
            session,
            note,
            chunks_to_embed,
            {section.id: section for section in section_rows},
            reused_count=reused_embeddings,
        )

        job.status = "success"
        job.error_message = None
        job.next_attempt_at = None
        job.stats = {
            "sections": len(section_rows),
            "chunks": len(chunk_rows),
            "indexed": stats.indexed,
            "reused": stats.reused,
            "skipped": stats.skipped,
            "failed": stats.failed,
        }
        job.finished_at = datetime.utcnow()
        job.claim_owner = None
        job.claimed_at = None
        job.heartbeat_at = None
        note.index_status = "indexed"
        note.index_version = job.source_version or content_hash(note.content or "")
        record_metric("index", "note", duration_ms=(datetime.utcnow() - job.started_at).total_seconds() * 1000)
        await session.flush()
        return job
    except Exception as exc:
        schedule_index_retry(note, job, exc)
        record_metric("index", "note", status="failed", duration_ms=(datetime.utcnow() - job.started_at).total_seconds() * 1000)
        await session.flush()
        return job


def schedule_index_retry(note: Note, job: NoteIndexJob, error: Exception, now: datetime | None = None) -> None:
    current_time = now or datetime.utcnow()
    job.error_message = str(error)
    job.error_code = type(error).__name__[:80]
    job.claim_owner = None
    job.claimed_at = None
    job.heartbeat_at = None
    job.retry_count = (job.retry_count or 0) + 1
    if job.retry_count <= (job.max_retries or 3):
        job.status = "pending"
        job.next_attempt_at = current_time + timedelta(seconds=min(60, 2 ** job.retry_count))
        job.finished_at = None
        note.index_status = "outdated"
        return
    job.status = "failed"
    job.next_attempt_at = None
    job.finished_at = current_time
    note.index_status = "failed"


async def index_note_now(session: AsyncSession, note: Note) -> NoteIndexJob:
    job = await create_index_job(session, note)
    if cfg.RAG_V2_INDEX_ENABLED:
        from app.rag.v2.indexer import create_rag_v2_index_job

        await create_rag_v2_index_job(session, note)
    from app.services.index_worker import notify_index_worker

    notify_index_worker()
    return job


async def latest_index_job(session: AsyncSession, user_id: str, note_id: str) -> NoteIndexJob | None:
    result = await session.execute(
        select(NoteIndexJob)
        .where(NoteIndexJob.user_id == user_id, NoteIndexJob.note_id == note_id)
        .order_by(NoteIndexJob.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()
