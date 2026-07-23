from __future__ import annotations

import asyncio
import logging
import os
import socket
import uuid

from app.config import cfg
from app.database import AsyncSessionLocal
from app.observability.context import structured_log, trace_scope
from app.repositories.outbox import OutboxRepository
from app.services.outbox import dispatch_outbox
from app.services.observability import record_metric

logger = logging.getLogger(__name__)
_task: asyncio.Task | None = None
_stop: asyncio.Event | None = None
_wake: asyncio.Event | None = None
_worker_id = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"


def notify_outbox_worker() -> None:
    if _wake is not None:
        _wake.set()


async def _process_one() -> bool:
    async with AsyncSessionLocal() as session:
        async with session.begin():
            item = await OutboxRepository(session).claim_one(worker_id=_worker_id, stale_seconds=cfg.OUTBOX_STALE_SECONDS)
        if item is None:
            return False
        item_id, trace_id = item.id, item.trace_id or ""

    with trace_scope(trace_id=trace_id, worker=_worker_id):
        async with AsyncSessionLocal() as session:
            async with session.begin():
                item = await session.get(type(item), item_id, with_for_update=True)
                if item is None or item.status != "processing" or item.locked_by != _worker_id:
                    return True
                repository = OutboxRepository(session)
                try:
                    await dispatch_outbox(session, item)
                    await repository.succeed(item)
                    record_metric("outbox", "dispatch")
                    structured_log(logger, logging.INFO, "outbox_succeeded", outbox_id=item.id, topic=item.topic)
                except Exception as exc:
                    await repository.fail(item, code=type(exc).__name__, message=str(exc))
                    record_metric("outbox", "dispatch", status="failed")
                    structured_log(logger, logging.WARNING, "outbox_failed", outbox_id=item.id, topic=item.topic, error=str(exc))
        return True


async def _loop() -> None:
    assert _stop is not None and _wake is not None
    while not _stop.is_set():
        try:
            if await _process_one():
                continue
        except asyncio.CancelledError:
            break
        except Exception as exc:
            structured_log(logger, logging.ERROR, "outbox_iteration_failed", error=str(exc))
        _wake.clear()
        try:
            await asyncio.wait_for(_wake.wait(), timeout=max(1, cfg.OUTBOX_POLL_SECONDS))
        except asyncio.TimeoutError:
            pass


async def start_outbox_worker() -> None:
    global _task, _stop, _wake
    if not cfg.OUTBOX_WORKER_ENABLED or (_task and not _task.done()):
        return
    _stop, _wake = asyncio.Event(), asyncio.Event()
    _task = asyncio.create_task(_loop(), name="noteflow-outbox-worker")


async def stop_outbox_worker() -> None:
    global _task
    if _stop is not None:
        _stop.set()
    if _wake is not None:
        _wake.set()
    if _task is not None:
        try:
            await asyncio.wait_for(_task, timeout=5)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            _task.cancel()
        _task = None
