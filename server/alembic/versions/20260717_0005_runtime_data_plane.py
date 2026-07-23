"""Add the runtime data plane, outbox and official LangGraph checkpoint schema.

Revision ID: 20260717_0005
Revises: 20260715_0004
Create Date: 2026-07-17

``agent_checkpoints`` remains NoteFlow's business checkpoint/audit table.  The
four ``checkpoint_*``/``checkpoints`` tables below are owned by
langgraph-checkpoint-postgres and intentionally have its exact schema.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260717_0005"
down_revision: Union[str, None] = "20260715_0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _add_columns() -> None:
    additions = {
        "notes": [
            "index_version VARCHAR(128)",
            "idempotency_key VARCHAR(160)",
        ],
        "note_index_jobs": [
            "claim_owner VARCHAR(160)", "claimed_at TIMESTAMP", "heartbeat_at TIMESTAMP",
            "error_code VARCHAR(80)", "source_version VARCHAR(128)",
            "idempotency_key VARCHAR(200)", "parser_version VARCHAR(80)",
            "chunker_version VARCHAR(80)", "embedding_version VARCHAR(120)",
            "graph_version VARCHAR(80)",
        ],
        "note_drafts": ["idempotency_key VARCHAR(160)"],
        "note_edit_previews": [
            "idempotency_key VARCHAR(160)", "apply_idempotency_key VARCHAR(160)",
        ],
        "user_memories": [
            "external_provider VARCHAR(50)", "external_id VARCHAR(160)",
            "canonical_key VARCHAR(120)", "memory_layer VARCHAR(50)",
            "expires_at TIMESTAMP", "source_ref VARCHAR(255)",
            "provider_metadata JSON NOT NULL DEFAULT '{}'::json",
            "idempotency_key VARCHAR(160)",
        ],
        "agent_runs": [
            "request_id VARCHAR(64)", "trace_id VARCHAR(64)",
            "idempotency_key VARCHAR(160)",
        ],
        "agent_steps": ["trace_id VARCHAR(64)"],
        "agent_tool_traces": ["trace_id VARCHAR(64)"],
    }
    for table, columns in additions.items():
        for column in columns:
            op.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column}")


def _create_application_tables() -> None:
    expected = {"integration_outbox", "rag_query_logs", "rag_eval_cases", "rag_eval_runs"}
    existing = expected.intersection(sa.inspect(op.get_bind()).get_table_names())
    # The adoption baseline creates current SQLAlchemy metadata on a brand-new
    # database, while an existing 0004 database has none of these tables yet.
    if existing == expected:
        return
    if existing:
        raise RuntimeError(f"partial Step 6 application schema detected: {sorted(existing)}")
    op.create_table(
        "integration_outbox",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("topic", sa.String(120), nullable=False),
        sa.Column("aggregate_type", sa.String(80), nullable=False),
        sa.Column("aggregate_id", sa.String(160), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("idempotency_key", sa.String(240), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("available_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("locked_by", sa.String(160), nullable=True),
        sa.Column("locked_at", sa.DateTime(), nullable=True),
        sa.Column("heartbeat_at", sa.DateTime(), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="8"),
        sa.Column("error_code", sa.String(80), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("trace_id", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("processed_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("idempotency_key", name="uq_integration_outbox_idempotency_key"),
    )
    op.create_table(
        "rag_query_logs",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("user_id", sa.String(64), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("query_hash", sa.String(64), nullable=False),
        sa.Column("query_preview", sa.String(300), nullable=True),
        sa.Column("provider", sa.String(50), nullable=False, server_default="legacy"),
        sa.Column("mode", sa.String(50), nullable=False, server_default="hybrid"),
        sa.Column("candidate_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("result_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("latency_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("trace_id", sa.String(64), nullable=True),
        sa.Column("run_id", sa.String(64), sa.ForeignKey("agent_runs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("metrics", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
    )
    op.create_table(
        "rag_eval_cases",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("dataset_version", sa.String(80), nullable=False, server_default="v1"),
        sa.Column("input_data", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("expected", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("tags", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("dataset_version", "name", name="uq_rag_eval_case_version_name"),
    )
    op.create_table(
        "rag_eval_runs",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("case_id", sa.String(64), sa.ForeignKey("rag_eval_cases.id", ondelete="SET NULL"), nullable=True),
        sa.Column("provider", sa.String(50), nullable=False, server_default="legacy"),
        sa.Column("status", sa.String(32), nullable=False, server_default="running"),
        sa.Column("parameters", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("metrics", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("trace_id", sa.String(64), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
    )


def _create_official_checkpoint_schema() -> None:
    op.execute("CREATE TABLE IF NOT EXISTS checkpoint_migrations (v INTEGER PRIMARY KEY)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS checkpoints (
            thread_id TEXT NOT NULL,
            checkpoint_ns TEXT NOT NULL DEFAULT '',
            checkpoint_id TEXT NOT NULL,
            parent_checkpoint_id TEXT,
            type TEXT,
            checkpoint JSONB NOT NULL,
            metadata JSONB NOT NULL DEFAULT '{}',
            PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS checkpoint_blobs (
            thread_id TEXT NOT NULL,
            checkpoint_ns TEXT NOT NULL DEFAULT '',
            channel TEXT NOT NULL,
            version TEXT NOT NULL,
            type TEXT NOT NULL,
            blob BYTEA,
            PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS checkpoint_writes (
            thread_id TEXT NOT NULL,
            checkpoint_ns TEXT NOT NULL DEFAULT '',
            checkpoint_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            idx INTEGER NOT NULL,
            channel TEXT NOT NULL,
            type TEXT,
            blob BYTEA NOT NULL,
            task_path TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
        )
    """)
    for table in ("checkpoints", "checkpoint_blobs", "checkpoint_writes"):
        op.execute(f"CREATE INDEX IF NOT EXISTS {table}_thread_id_idx ON {table} (thread_id)")
    op.execute("INSERT INTO checkpoint_migrations(v) SELECT generate_series(0, 9) ON CONFLICT DO NOTHING")


def _create_indexes() -> None:
    statements = [
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_notes_user_idempotency ON notes(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_note_index_jobs_user_idempotency ON note_index_jobs(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_note_drafts_user_idempotency ON note_drafts(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_note_edit_previews_user_idempotency ON note_edit_previews(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_note_edit_apply_user_idempotency ON note_edit_previews(user_id, apply_idempotency_key) WHERE apply_idempotency_key IS NOT NULL",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_user_memories_user_idempotency ON user_memories(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_user_memories_external ON user_memories(user_id, external_provider, external_id) WHERE external_id IS NOT NULL",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_runs_user_idempotency ON agent_runs(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL",
        "CREATE INDEX IF NOT EXISTS ix_note_index_jobs_claim_owner ON note_index_jobs(claim_owner)",
        "CREATE INDEX IF NOT EXISTS ix_note_index_jobs_heartbeat_at ON note_index_jobs(heartbeat_at)",
        "CREATE INDEX IF NOT EXISTS ix_user_memories_expires_at ON user_memories(expires_at)",
        "CREATE INDEX IF NOT EXISTS ix_agent_runs_request_id ON agent_runs(request_id)",
        "CREATE INDEX IF NOT EXISTS ix_agent_runs_trace_id ON agent_runs(trace_id)",
        "CREATE INDEX IF NOT EXISTS ix_agent_steps_trace_id ON agent_steps(trace_id)",
        "CREATE INDEX IF NOT EXISTS ix_agent_tool_traces_trace_id ON agent_tool_traces(trace_id)",
        "CREATE INDEX IF NOT EXISTS ix_integration_outbox_ready ON integration_outbox(status, available_at)",
        "CREATE INDEX IF NOT EXISTS ix_integration_outbox_locked_by ON integration_outbox(locked_by)",
        "CREATE INDEX IF NOT EXISTS ix_integration_outbox_trace_id ON integration_outbox(trace_id)",
        "CREATE INDEX IF NOT EXISTS ix_rag_query_logs_created_at ON rag_query_logs(created_at)",
        "CREATE INDEX IF NOT EXISTS ix_rag_query_logs_query_hash ON rag_query_logs(query_hash)",
        "CREATE INDEX IF NOT EXISTS ix_rag_query_logs_trace_id ON rag_query_logs(trace_id)",
        "CREATE INDEX IF NOT EXISTS ix_rag_eval_runs_status ON rag_eval_runs(status)",
    ]
    for statement in statements:
        op.execute(statement)


def upgrade() -> None:
    _add_columns()
    _create_application_tables()
    _create_official_checkpoint_schema()
    _create_indexes()


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS checkpoint_writes")
    op.execute("DROP TABLE IF EXISTS checkpoint_blobs")
    op.execute("DROP TABLE IF EXISTS checkpoints")
    op.execute("DROP TABLE IF EXISTS checkpoint_migrations")
    for table in ("rag_eval_runs", "rag_eval_cases", "rag_query_logs", "integration_outbox"):
        op.execute(f"DROP TABLE IF EXISTS {table}")
    drops = {
        "agent_tool_traces": ["trace_id"],
        "agent_steps": ["trace_id"],
        "agent_runs": ["idempotency_key", "trace_id", "request_id"],
        "user_memories": ["idempotency_key", "provider_metadata", "source_ref", "expires_at", "memory_layer", "canonical_key", "external_id", "external_provider"],
        "note_edit_previews": ["apply_idempotency_key", "idempotency_key"],
        "note_drafts": ["idempotency_key"],
        "note_index_jobs": ["graph_version", "embedding_version", "chunker_version", "parser_version", "idempotency_key", "source_version", "error_code", "heartbeat_at", "claimed_at", "claim_owner"],
        "notes": ["idempotency_key", "index_version"],
    }
    for table, columns in drops.items():
        for column in columns:
            op.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS {column}")
