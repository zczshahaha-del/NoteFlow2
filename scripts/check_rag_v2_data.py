from __future__ import annotations

import asyncio
import hashlib
import json
import sys
from pathlib import Path

from sqlalchemy import func, select, text


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))


async def main_async() -> int:
    from app.database import AsyncSessionLocal, engine
    from app.models.db import Note, NoteIndexJob, RagV2Embedding, RagV2IndexState, RagV2Node

    async with AsyncSessionLocal() as session:
        revision = await session.scalar(text("select version_num from alembic_version"))
        active_notes = (await session.execute(select(Note.id, Note.content).where(Note.deleted_at.is_(None)))).all()
        states = (await session.execute(select(RagV2IndexState))).scalars().all()
        state_by_note = {state.note_id: state for state in states}
        missing_states = [note_id for note_id, _content in active_notes if note_id not in state_by_note]
        stale_states = [
            note_id
            for note_id, content in active_notes
            if note_id in state_by_note
            and state_by_note[note_id].source_version != hashlib.sha256((content or "").encode()).hexdigest()
        ]
        node_count = await session.scalar(select(func.count(RagV2Node.id)).where(RagV2Node.active.is_(True)))
        node_pointer_mismatch = await session.scalar(
            select(func.count(RagV2Node.id))
            .join(RagV2IndexState, RagV2IndexState.note_id == RagV2Node.note_id)
            .where(RagV2Node.active.is_(True), RagV2Node.source_version != RagV2IndexState.source_version)
        )
        embedding_rows = (
            await session.execute(
                select(RagV2Embedding.status, func.count(RagV2Embedding.id)).group_by(RagV2Embedding.status)
            )
        ).all()
        embedding_counts = {status: count for status, count in embedding_rows}
        failed_jobs = await session.scalar(
            select(func.count(NoteIndexJob.id)).where(
                NoteIndexJob.graph_version == "rag-v2", NoteIndexJob.status == "failed"
            )
        )
        indexed_states = sum(1 for state in states if state.status == "indexed")
        report = {
            "revision": revision,
            "activeNotes": len(active_notes),
            "indexedStates": indexed_states,
            "activeNodes": node_count or 0,
            "embeddingCounts": embedding_counts,
            "missingStateCount": len(missing_states),
            "staleStateCount": len(stale_states),
            "nodePointerMismatchCount": node_pointer_mismatch or 0,
            "failedJobCount": failed_jobs or 0,
        }
        report["ok"] = (
            revision == "20260717_0007"
            and indexed_states == len(active_notes)
            and not missing_states
            and not stale_states
            and not node_pointer_mismatch
            and not embedding_counts.get("failed", 0)
            and not failed_jobs
        )
        print(json.dumps(report, ensure_ascii=False))
    await engine.dispose()
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main_async()))
