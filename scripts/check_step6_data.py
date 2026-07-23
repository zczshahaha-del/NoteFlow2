#!/usr/bin/env python3
"""Read-only Step 6 reconciliation report for an upgraded NoteFlow database."""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

import asyncpg  # noqa: E402
from app.config import cfg  # noqa: E402


async def main() -> None:
    connection = await asyncpg.connect(
        host=cfg.DB_HOST, port=int(cfg.DB_PORT), user=cfg.DB_USER,
        password=cfg.DB_PASSWORD, database=cfg.DB_NAME,
    )
    try:
        revision = await connection.fetchval("select version_num from alembic_version")
        counts = {}
        for table in ("users", "notes", "user_memories", "agent_runs", "agent_checkpoints", "integration_outbox"):
            counts[table] = await connection.fetchval(f"select count(*) from {table}")
        duplicate_keys = {}
        for table in ("notes", "note_index_jobs", "note_drafts", "note_edit_previews", "user_memories", "agent_runs"):
            duplicate_keys[table] = await connection.fetchval(
                f"select count(*) from (select user_id, idempotency_key from {table} "
                "where idempotency_key is not null group by user_id, idempotency_key having count(*) > 1) d"
            )
        checkpoint_versions = await connection.fetchval("select count(*) from checkpoint_migrations")
        orphaned = await connection.fetchval(
            "select count(*) from integration_outbox o left join users u on u.id=o.user_id "
            "where o.user_id is not null and u.id is null"
        )
        report = {
            "ok": revision in {"20260717_0005", "20260717_0006", "20260717_0007"} and not any(duplicate_keys.values()) and not orphaned and checkpoint_versions == 10,
            "revision": revision,
            "rowCounts": counts,
            "duplicateIdempotencyKeys": duplicate_keys,
            "orphanedOutboxOwners": orphaned,
            "officialCheckpointMigrationCount": checkpoint_versions,
        }
        print(json.dumps(report, ensure_ascii=False, indent=2))
        raise SystemExit(0 if report["ok"] else 1)
    finally:
        await connection.close()


if __name__ == "__main__":
    asyncio.run(main())
