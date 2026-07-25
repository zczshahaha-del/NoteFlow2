from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from sqlalchemy import select


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))


async def main_async(limit: int, no_embeddings: bool, force: bool) -> int:
    from app.config import cfg
    from app.database import AsyncSessionLocal, engine
    from app.models.db import Note
    from app.rag.pipeline.indexer import create_rag_index_job, run_rag_index_job

    original_key = cfg.EMBEDDING_API_KEY
    if no_embeddings:
        cfg.EMBEDDING_API_KEY = ""
    counts = {"notes": 0, "success": 0, "failed": 0, "cancelled": 0, "nodes": 0, "embedded": 0, "reused": 0}
    try:
        async with AsyncSessionLocal() as session:
            note_ids = list(
                (
                    await session.execute(
                        select(Note.id)
                        .where(Note.deleted_at.is_(None))
                        .order_by(Note.updated_at.desc())
                        .limit(max(1, min(limit, 10000)))
                    )
                ).scalars().all()
            )
        for note_id in note_ids:
            async with AsyncSessionLocal() as session:
                note = await session.scalar(select(Note).where(Note.id == note_id, Note.deleted_at.is_(None)))
                if note is None:
                    continue
                job = await create_rag_index_job(session, note, force=force)
                if job.status != "success" or force:
                    await run_rag_index_job(session, note, job)
                await session.commit()
                counts["notes"] += 1
                counts[job.status] = counts.get(job.status, 0) + 1
                counts["nodes"] += int((job.stats or {}).get("nodes", 0))
                counts["embedded"] += int((job.stats or {}).get("embedded", 0))
                counts["reused"] += int((job.stats or {}).get("reused", 0))
        print(json.dumps(counts, ensure_ascii=False))
        return 0 if counts["failed"] == 0 and counts["cancelled"] == 0 else 1
    finally:
        cfg.EMBEDDING_API_KEY = original_key
        await engine.dispose()


def main() -> int:
    parser = argparse.ArgumentParser(description="Rebuild the derived NoteFlow RAG index")
    parser.add_argument("--limit", type=int, default=10000)
    parser.add_argument("--no-embeddings", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    return asyncio.run(main_async(args.limit, args.no_embeddings, args.force))


if __name__ == "__main__":
    raise SystemExit(main())
