"""Add write-graph runtime and optimistic-concurrency metadata.

Revision ID: 20260717_0008
Revises: 20260717_0007
Create Date: 2026-07-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260717_0008"
down_revision: Union[str, None] = "20260717_0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set[str]:
    return {item["name"] for item in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    draft_columns = _columns("note_drafts")
    if "runtime" not in draft_columns:
        op.add_column("note_drafts", sa.Column("runtime", sa.String(32), nullable=False, server_default="legacy"))
    if "graph_thread_id" not in draft_columns:
        op.add_column("note_drafts", sa.Column("graph_thread_id", sa.String(160), nullable=True))

    section_columns = _columns("note_draft_sections")
    if "generation_key" not in section_columns:
        op.add_column("note_draft_sections", sa.Column("generation_key", sa.String(160), nullable=True))
    if "retry_count" not in section_columns:
        op.add_column("note_draft_sections", sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"))

    edit_columns = _columns("note_edit_previews")
    if "runtime" not in edit_columns:
        op.add_column("note_edit_previews", sa.Column("runtime", sa.String(32), nullable=False, server_default="legacy"))
    if "graph_thread_id" not in edit_columns:
        op.add_column("note_edit_previews", sa.Column("graph_thread_id", sa.String(160), nullable=True))
    if "source_content_hash" not in edit_columns:
        op.add_column("note_edit_previews", sa.Column("source_content_hash", sa.String(64), nullable=False, server_default=""))
    if "applied_content_hash" not in edit_columns:
        op.add_column("note_edit_previews", sa.Column("applied_content_hash", sa.String(64), nullable=True))

    op.execute("CREATE INDEX IF NOT EXISTS ix_note_drafts_graph_thread_id ON note_drafts(graph_thread_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_note_edit_previews_graph_thread_id ON note_edit_previews(graph_thread_id)")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_note_drafts_user_idempotency ON note_drafts(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_note_edit_user_idempotency ON note_edit_previews(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_note_edit_user_idempotency")
    op.execute("DROP INDEX IF EXISTS uq_note_drafts_user_idempotency")
    op.drop_index("ix_note_edit_previews_graph_thread_id", table_name="note_edit_previews")
    op.drop_index("ix_note_drafts_graph_thread_id", table_name="note_drafts")
    for column in ("applied_content_hash", "source_content_hash", "graph_thread_id", "runtime"):
        op.drop_column("note_edit_previews", column)
    for column in ("retry_count", "generation_key"):
        op.drop_column("note_draft_sections", column)
    for column in ("graph_thread_id", "runtime"):
        op.drop_column("note_drafts", column)
