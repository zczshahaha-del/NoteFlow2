"""Bootstrap the existing NoteFlow schema under Alembic control.

Revision ID: 20260715_0001
Revises: None
Create Date: 2026-07-15

This adoption migration is deliberately idempotent: it creates a fresh schema
from the current metadata and safely upgrades databases created by older
NoteFlow versions. Future schema changes must use explicit Alembic operations.
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

from app.models.db import Base

revision: str = "20260715_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    baseline_tables = [
        table
        for table in Base.metadata.sorted_tables
        if table.name not in {"user_sessions", "password_reset_tokens"}
    ]
    Base.metadata.create_all(bind=bind, tables=baseline_tables)

    op.execute("ALTER TABLE note_sections ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64) NOT NULL DEFAULT ''")
    op.execute("ALTER TABLE note_chunks ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64) NOT NULL DEFAULT ''")
    op.execute("ALTER TABLE note_index_jobs ADD COLUMN IF NOT EXISTS stats JSONB NOT NULL DEFAULT '{}'::jsonb")

    indexes = (
        "CREATE INDEX IF NOT EXISTS ix_note_embeddings_embedding_hnsw ON note_embeddings USING hnsw (embedding vector_cosine_ops) WHERE status = 'indexed' AND embedding IS NOT NULL",
        "CREATE INDEX IF NOT EXISTS ix_notes_title_trgm ON notes USING gin (title gin_trgm_ops)",
        "CREATE INDEX IF NOT EXISTS ix_notes_content_trgm ON notes USING gin (content gin_trgm_ops)",
        "CREATE INDEX IF NOT EXISTS ix_note_sections_title_trgm ON note_sections USING gin (title gin_trgm_ops)",
        "CREATE INDEX IF NOT EXISTS ix_note_sections_content_trgm ON note_sections USING gin (content gin_trgm_ops)",
        "CREATE INDEX IF NOT EXISTS ix_note_chunks_content_trgm ON note_chunks USING gin (content gin_trgm_ops)",
        "CREATE INDEX IF NOT EXISTS ix_note_sections_note_hash ON note_sections (note_id, content_hash)",
        "CREATE INDEX IF NOT EXISTS ix_note_chunks_note_hash ON note_chunks (note_id, content_hash)",
        "CREATE INDEX IF NOT EXISTS ix_note_embeddings_chunk_hash ON note_embeddings (chunk_id, content_hash)",
    )
    for statement in indexes:
        bind.execute(text(statement))


def downgrade() -> None:
    # The first revision adopts installations that may already contain user
    # data. It must never destroy an existing NoteFlow database on downgrade.
    pass
