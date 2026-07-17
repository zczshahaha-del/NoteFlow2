from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import cfg
from app.models.db import Note, NoteChunk, NoteEmbedding, NoteSection
from app.services.embeddings import chunk_embedding_text, content_hash, embed_texts, embedding_enabled
from app.utils import random_id


@dataclass
class EmbeddingIndexStats:
    indexed: int = 0
    reused: int = 0
    skipped: int = 0
    failed: int = 0


async def index_note_chunk_embeddings(
    session: AsyncSession,
    note: Note,
    chunks: list[NoteChunk],
    sections_by_id: dict[str, NoteSection],
    reused_count: int = 0,
) -> EmbeddingIndexStats:
    stats = EmbeddingIndexStats(reused=reused_count)
    if not chunks:
        await session.flush()
        return stats

    if not embedding_enabled():
        for chunk in chunks:
            text = chunk_embedding_text(
                note_title=note.title,
                section_title=sections_by_id.get(chunk.section_id).title if sections_by_id.get(chunk.section_id) else "",
                chunk_content=chunk.content or "",
                tags=note.tags or [],
            )
            session.add(
                NoteEmbedding(
                    id=random_id(),
                    chunk_id=chunk.id,
                    note_id=chunk.note_id,
                    section_id=chunk.section_id,
                    user_id=chunk.user_id,
                    provider=cfg.EMBEDDING_PROVIDER,
                    embedding_model=cfg.EMBEDDING_MODEL,
                    embedding_dim=cfg.EMBEDDING_DIMENSIONS,
                    content_hash=content_hash(text),
                    embedding=None,
                    status="skipped",
                    error_message="embedding provider is not configured",
                )
            )
            stats.skipped += 1
        await session.flush()
        return stats

    batch_size = max(1, min(cfg.EMBEDDING_BATCH_SIZE, 20))
    for start in range(0, len(chunks), batch_size):
        batch = chunks[start : start + batch_size]
        texts = [
            chunk_embedding_text(
                note_title=note.title,
                section_title=sections_by_id.get(chunk.section_id).title if sections_by_id.get(chunk.section_id) else "",
                chunk_content=chunk.content or "",
                tags=note.tags or [],
            )
            for chunk in batch
        ]

        try:
            result = await embed_texts(texts)
            indexed_at = datetime.utcnow()
            for chunk, text, vector in zip(batch, texts, result.embeddings):
                session.add(
                    NoteEmbedding(
                        id=random_id(),
                        chunk_id=chunk.id,
                        note_id=chunk.note_id,
                        section_id=chunk.section_id,
                        user_id=chunk.user_id,
                        provider=result.provider,
                        embedding_model=result.model,
                        embedding_dim=result.dimensions,
                        content_hash=content_hash(text),
                        embedding=vector,
                        status="indexed",
                        indexed_at=indexed_at,
                    )
                )
                stats.indexed += 1
        except Exception as exc:
            message = str(exc)[:1000]
            for chunk, text in zip(batch, texts):
                session.add(
                    NoteEmbedding(
                        id=random_id(),
                        chunk_id=chunk.id,
                        note_id=chunk.note_id,
                        section_id=chunk.section_id,
                        user_id=chunk.user_id,
                        provider=cfg.EMBEDDING_PROVIDER,
                        embedding_model=cfg.EMBEDDING_MODEL,
                        embedding_dim=cfg.EMBEDDING_DIMENSIONS,
                        content_hash=content_hash(text),
                        embedding=None,
                        status="failed",
                        error_message=message,
                    )
                )
                stats.failed += 1
            if cfg.EMBEDDING_FAIL_INDEX_ON_ERROR:
                raise

    await session.flush()
    return stats
