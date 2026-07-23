"""Add the versioned RAG v2 derived index.

Revision ID: 20260717_0007
Revises: 20260717_0006
Create Date: 2026-07-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.services.pgvector import Vector

revision: str = "20260717_0007"
down_revision: Union[str, None] = "20260717_0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "rag_v2_index_states" not in tables:
        op.create_table(
            "rag_v2_index_states",
            sa.Column("note_id", sa.String(64), sa.ForeignKey("notes.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("source_version", sa.String(128), nullable=False, server_default=""),
            sa.Column("parser_version", sa.String(80), nullable=False, server_default=""),
            sa.Column("chunker_version", sa.String(80), nullable=False, server_default=""),
            sa.Column("embedding_version", sa.String(120), nullable=False, server_default=""),
            sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
            sa.Column("node_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("error_code", sa.String(80), nullable=True),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
            sa.Column("indexed_at", sa.DateTime(), nullable=True),
        )
    if "rag_v2_nodes" not in tables:
        op.create_table(
            "rag_v2_nodes",
            sa.Column("id", sa.String(64), primary_key=True),
            sa.Column("note_id", sa.String(64), sa.ForeignKey("notes.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("section_key", sa.String(64), nullable=False),
            sa.Column("section_path", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
            sa.Column("node_type", sa.String(32), nullable=False, server_default="text"),
            sa.Column("node_index", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("content", sa.Text(), nullable=False, server_default=""),
            sa.Column("token_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("content_hash", sa.String(64), nullable=False),
            sa.Column("source_version", sa.String(128), nullable=False),
            sa.Column("parser_version", sa.String(80), nullable=False),
            sa.Column("chunker_version", sa.String(80), nullable=False),
            sa.Column("block_types", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
            sa.Column("node_metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )
    if "rag_v2_embeddings" not in tables:
        op.create_table(
            "rag_v2_embeddings",
            sa.Column("id", sa.String(64), primary_key=True),
            sa.Column("node_id", sa.String(64), sa.ForeignKey("rag_v2_nodes.id", ondelete="CASCADE"), nullable=False),
            sa.Column("note_id", sa.String(64), sa.ForeignKey("notes.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("provider", sa.String(50), nullable=False),
            sa.Column("embedding_model", sa.String(100), nullable=False),
            sa.Column("embedding_dim", sa.Integer(), nullable=False),
            sa.Column("content_hash", sa.String(64), nullable=False),
            sa.Column("embedding", Vector(1024), nullable=True),
            sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
            sa.Column("indexed_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("node_id", "provider", "embedding_model", "embedding_dim", name="uq_rag_v2_embedding_version"),
        )
    statements = (
        "CREATE INDEX IF NOT EXISTS ix_rag_v2_index_states_user_id ON rag_v2_index_states(user_id)",
        "CREATE INDEX IF NOT EXISTS ix_rag_v2_index_states_status ON rag_v2_index_states(status)",
        "CREATE INDEX IF NOT EXISTS ix_rag_v2_nodes_note_id ON rag_v2_nodes(note_id)",
        "CREATE INDEX IF NOT EXISTS ix_rag_v2_nodes_user_id ON rag_v2_nodes(user_id)",
        "CREATE INDEX IF NOT EXISTS ix_rag_v2_nodes_section_key ON rag_v2_nodes(section_key)",
        "CREATE INDEX IF NOT EXISTS ix_rag_v2_nodes_content_hash ON rag_v2_nodes(content_hash)",
        "CREATE INDEX IF NOT EXISTS ix_rag_v2_nodes_source_version ON rag_v2_nodes(source_version)",
        "CREATE INDEX IF NOT EXISTS ix_rag_v2_nodes_active ON rag_v2_nodes(active)",
        "CREATE INDEX IF NOT EXISTS ix_rag_v2_nodes_visible ON rag_v2_nodes(user_id, active, source_version)",
        "CREATE INDEX IF NOT EXISTS ix_rag_v2_nodes_note_section ON rag_v2_nodes(note_id, section_key)",
        "CREATE INDEX IF NOT EXISTS ix_rag_v2_nodes_content_trgm ON rag_v2_nodes USING gin(content gin_trgm_ops)",
        "CREATE INDEX IF NOT EXISTS ix_rag_v2_embeddings_node_id ON rag_v2_embeddings(node_id)",
        "CREATE INDEX IF NOT EXISTS ix_rag_v2_embeddings_note_id ON rag_v2_embeddings(note_id)",
        "CREATE INDEX IF NOT EXISTS ix_rag_v2_embeddings_user_id ON rag_v2_embeddings(user_id)",
        "CREATE INDEX IF NOT EXISTS ix_rag_v2_embeddings_content_hash ON rag_v2_embeddings(content_hash)",
        "CREATE INDEX IF NOT EXISTS ix_rag_v2_embeddings_vector_ready ON rag_v2_embeddings(user_id, status)",
        "CREATE INDEX IF NOT EXISTS ix_rag_v2_embeddings_hnsw ON rag_v2_embeddings USING hnsw (embedding vector_cosine_ops) WHERE status = 'indexed' AND embedding IS NOT NULL",
    )
    for statement in statements:
        op.execute(statement)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS rag_v2_embeddings")
    op.execute("DROP TABLE IF EXISTS rag_v2_nodes")
    op.execute("DROP TABLE IF EXISTS rag_v2_index_states")
