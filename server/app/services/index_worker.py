from __future__ import annotations

import asyncio
import logging
from datetime import datetime

from sqlalchemy import or_, select

from app.database import AsyncSessionLocal
from app.models.db import Note, NoteIndexJob

logger = logging.getLogger(__name__)

_worker_task: asyncio.Task | None = None
_wake_event: asyncio.Event | None = None
_stop_event: asyncio.Event | None = None


def notify_index_worker() -> None:
    if _wake_event is not None:
        _wake_event.set()


async def _claim_and_run_one() -> bool:
    from app.services.markdown_index import run_index_job

    async with AsyncSessionLocal() as session:
        async with session.begin():
            result = await session.execute(
                select(NoteIndexJob)
                .where(
                    NoteIndexJob.status == "pending",
                    or_(
                        NoteIndexJob.next_attempt_at.is_(None),
                        NoteIndexJob.next_attempt_at <= datetime.utcnow(),
                    ),
                )
                .order_by(NoteIndexJob.created_at)
                .with_for_update(skip_locked=True)
                .limit(1)
            )
            job = result.scalar_one_or_none()
            if job is None:
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
                job.finished_at = datetime.utcnow()
                return True
            await run_index_job(session, note, job)
        return True


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
