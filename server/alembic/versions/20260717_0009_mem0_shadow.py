"""Add Mem0 shadow comparison audit plane.

Revision ID: 20260717_0009
Revises: 20260717_0008
Create Date: 2026-07-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260717_0009"
down_revision: Union[str, None] = "20260717_0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # The adoption baseline creates current metadata on a brand-new database.
    # Existing installations reach this revision without the table, so this
    # revision must support both paths just like revisions 0006-0008.
    if "memory_shadow_runs" not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table(
            "memory_shadow_runs",
            sa.Column("id", sa.String(64), primary_key=True),
            sa.Column("user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("memory_id", sa.String(64), sa.ForeignKey("user_memories.id", ondelete="SET NULL"), nullable=True),
            sa.Column("operation", sa.String(32), nullable=False),
            sa.Column("query_hash", sa.String(64), nullable=True),
            sa.Column("legacy_ids", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("mem0_ids", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("overlap_ratio", sa.Float(), nullable=False, server_default="0"),
            sa.Column("latency_ms", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("hard_violation", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("status", sa.String(32), nullable=False, server_default="success"),
            sa.Column("error_code", sa.String(80), nullable=True),
            sa.Column("details", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )
    for column in ("user_id", "memory_id", "operation", "query_hash", "hard_violation", "status", "created_at"):
        op.execute(
            f"CREATE INDEX IF NOT EXISTS ix_memory_shadow_runs_{column} "
            f"ON memory_shadow_runs ({column})"
        )


def downgrade() -> None:
    op.drop_table("memory_shadow_runs")
