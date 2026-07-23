"""Add LangGraph shadow comparison records.

Revision ID: 20260717_0006
Revises: 20260717_0005
Create Date: 2026-07-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260717_0006"
down_revision: Union[str, None] = "20260717_0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if "agent_shadow_runs" not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table(
            "agent_shadow_runs",
            sa.Column("id", sa.String(64), primary_key=True),
            sa.Column("user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("request_id", sa.String(80), nullable=True),
            sa.Column("trace_id", sa.String(80), nullable=True),
            sa.Column("input_hash", sa.String(64), nullable=False),
            sa.Column("mode", sa.String(32), nullable=False),
            sa.Column("legacy_intent", sa.String(80), nullable=False),
            sa.Column("graph_intent", sa.String(80), nullable=True),
            sa.Column("legacy_route", sa.String(80), nullable=False),
            sa.Column("graph_route", sa.String(80), nullable=True),
            sa.Column("legacy_requires_sources", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("graph_requires_sources", sa.Boolean(), nullable=True),
            sa.Column("hard_violation", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("status", sa.String(32), nullable=False, server_default="running"),
            sa.Column("differences", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
            sa.Column("graph_summary", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
            sa.Column("duration_ms", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("error_code", sa.String(80), nullable=True),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        )
    for statement in (
        "CREATE INDEX IF NOT EXISTS ix_agent_shadow_runs_user_id ON agent_shadow_runs(user_id)",
        "CREATE INDEX IF NOT EXISTS ix_agent_shadow_runs_request_id ON agent_shadow_runs(request_id)",
        "CREATE INDEX IF NOT EXISTS ix_agent_shadow_runs_trace_id ON agent_shadow_runs(trace_id)",
        "CREATE INDEX IF NOT EXISTS ix_agent_shadow_runs_input_hash ON agent_shadow_runs(input_hash)",
        "CREATE INDEX IF NOT EXISTS ix_agent_shadow_runs_hard_violation ON agent_shadow_runs(hard_violation)",
        "CREATE INDEX IF NOT EXISTS ix_agent_shadow_runs_status ON agent_shadow_runs(status)",
        "CREATE INDEX IF NOT EXISTS ix_agent_shadow_runs_created_at ON agent_shadow_runs(created_at)",
    ):
        op.execute(statement)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS agent_shadow_runs")
