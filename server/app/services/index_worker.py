from __future__ import annotations

import asyncio
import logging
import os
import socket
import uuid
from datetime import datetime, timedelta

from sqlalchemy import or_, select

from app.database import AsyncSessionLocal
from app.models.db import Note, NoteIndexJob
from app.config import cfg

logger = logging.getLogger(__name__)

_worker_task: asyncio.Task | None = None
_wake_event: asyncio.Event | None = None
_stop_event: asyncio.Event | None = None
_worker_id = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"


def notify_index_worker() -> None:
    if _wake_event is not None:
        _wake_event.set()


async def _claim_one() -> str | None:
    now = datetime.utcnow()
    stale_at = now - timedelta(seconds=max(1, cfg.INDEX_JOB_STALE_SECONDS))
    async with AsyncSessionLocal() as session:
        async with session.begin():
            result = await session.execute(
                select(NoteIndexJob)
                .where(
                    or_(
                        (NoteIndexJob.status == "pending")
                        & or_(NoteIndexJob.next_attempt_at.is_(None), NoteIndexJob.next_attempt_at <= now),
                        (NoteIndexJob.status == "running")
                        & or_(NoteIndexJob.heartbeat_at.is_(None), NoteIndexJob.heartbeat_at < stale_at),
                    ),
                )
                .order_by(NoteIndexJob.created_at)
                .with_for_update(skip_locked=True)
                .limit(1)
            )
            job = result.scalar_one_or_none()
            if job is None:
                return None
            job.status = "running"
            job.claim_owner = _worker_id
            job.claimed_at = now
            job.heartbeat_at = now
            job.started_at = job.started_at or now
            return job.id


async def _run_claimed(job_id: str) -> bool:
    from app.services.markdown_index import run_index_job

    async with AsyncSessionLocal() as session:
        async with session.begin():
            job = await session.get(NoteIndexJob, job_id, with_for_update=True)
            if job is None or job.status != "running" or job.claim_owner != _worker_id:
                return False
            note_result = await session.execute(
                select(Note).where(
                    Note.id == job.note_id,
                    Note.user_id == job.user_id,
                    Note.deleted_at.is_(None),
                )
            )
            note = note_result.scalar_one_or_none()
            if note is None:
                job.status = "cancelled"
                job.error_message = "note no longer exists"
                job.error_code = "NOTE_NOT_FOUND"
                job.finished_at = datetime.utcnow()
                job.claim_owner = None
                job.heartbeat_at = None
                return True
            job.heartbeat_at = datetime.utcnow()
            if job.graph_version == "rag-v2":
                from app.rag.v2.indexer import run_rag_v2_index_job

                await run_rag_v2_index_job(session, note, job)
            else:
                await run_index_job(session, note, job)
        return True


async def _claim_and_run_one() -> bool:
    job_id = await _claim_one()
    if job_id is None:
        return False
    return await _run_claimed(job_id)


async def _worker_loop() -> None:
    assert _wake_event is not None and _stop_event is not None
    logger.info("note index worker started")
    while not _stop_event.is_set():
        try:
            processed = await _claim_and_run_one()
            if processed:
                continue
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("note index worker iteration failed")

        _wake_event.clear()
        try:
            await asyncio.wait_for(_wake_event.wait(), timeout=2.0)
        except asyncio.TimeoutError:
            pass
    logger.info("note index worker stopped")


async def start_index_worker() -> None:
    global _worker_task, _wake_event, _stop_event
    if _worker_task and not _worker_task.done():
        return
    _wake_event = asyncio.Event()
    _stop_event = asyncio.Event()
    _worker_task = asyncio.create_task(_worker_loop(), name="noteflow-index-worker")


async def stop_index_worker() -> None:
    global _worker_task
    if _stop_event is not None:
        _stop_event.set()
    if _wake_event is not None:
        _wake_event.set()
    if _worker_task is not None:
        try:
            await asyncio.wait_for(_worker_task, timeout=5)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            _worker_task.cancel()
        _worker_task = None
