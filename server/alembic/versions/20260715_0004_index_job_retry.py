"""Add retry and scheduling state to note index jobs.

Revision ID: 20260715_0004
Revises: 20260715_0003
Create Date: 2026-07-15
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260715_0004"
down_revision: Union[str, None] = "20260715_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE note_index_jobs ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE note_index_jobs ADD COLUMN IF NOT EXISTS max_retries INTEGER NOT NULL DEFAULT 3")
    op.execute("ALTER TABLE note_index_jobs ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMP NULL")
    op.execute("CREATE INDEX IF NOT EXISTS ix_note_index_jobs_next_attempt_at ON note_index_jobs (next_attempt_at)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_note_index_jobs_next_attempt_at")
    op.execute("ALTER TABLE note_index_jobs DROP COLUMN IF EXISTS next_attempt_at")
    op.execute("ALTER TABLE note_index_jobs DROP COLUMN IF EXISTS max_retries")
    op.execute("ALTER TABLE note_index_jobs DROP COLUMN IF EXISTS retry_count")
