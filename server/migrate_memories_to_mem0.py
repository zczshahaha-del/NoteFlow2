from __future__ import annotations

import argparse
import asyncio
import json
import re

from app.database import AsyncSessionLocal
from app.memory.backfill import enqueue_mem0_backfill


def _batch_id(value: str) -> str:
    normalized = value.strip()
    if not re.fullmatch(r"[a-zA-Z0-9._-]{1,64}", normalized):
        raise argparse.ArgumentTypeError("batch id must use 1-64 letters, digits, dots, underscores, or dashes")
    return normalized


async def _run(*, batch_id: str, execute: bool) -> dict:
    async with AsyncSessionLocal() as session:
        report = await enqueue_mem0_backfill(session, batch_id=batch_id, dry_run=not execute)
    return report.to_dict()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Idempotently enqueue eligible NoteFlow memories for Mem0 backfill"
    )
    parser.add_argument("--batch-id", required=True, type=_batch_id)
    parser.add_argument(
        "--execute",
        action="store_true",
        help="persist outbox rows; without this flag the command is read-only",
    )
    args = parser.parse_args()
    print(json.dumps(asyncio.run(_run(batch_id=args.batch_id, execute=args.execute)), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
