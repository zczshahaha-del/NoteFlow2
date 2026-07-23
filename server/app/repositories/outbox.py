from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import IntegrationOutbox
from app.utils import random_id


class OutboxRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def enqueue(
        self, *, topic: str, aggregate_type: str, aggregate_id: str,
        idempotency_key: str, payload: dict, user_id: str | None = None,
        trace_id: str | None = None, max_attempts: int = 8,
    ) -> IntegrationOutbox:
        values = dict(
            id=random_id(), user_id=user_id, topic=topic,
            aggregate_type=aggregate_type, aggregate_id=aggregate_id,
            idempotency_key=idempotency_key, payload=payload,
            trace_id=trace_id, max_attempts=max_attempts,
        )
        statement = insert(IntegrationOutbox).values(**values).on_conflict_do_nothing(
            index_elements=[IntegrationOutbox.idempotency_key]
        ).returning(IntegrationOutbox.id)
        inserted_id = await self.session.scalar(statement)
        key = inserted_id or idempotency_key
        query = select(IntegrationOutbox).where(
            IntegrationOutbox.id == key if inserted_id else IntegrationOutbox.idempotency_key == key
        )
        item = await self.session.scalar(query)
        if item is None:
            raise RuntimeError("outbox enqueue did not return a row")
        return item

    async def claim_one(self, *, worker_id: str, stale_seconds: int) -> IntegrationOutbox | None:
        now = datetime.utcnow()
        stale_at = now - timedelta(seconds=max(1, stale_seconds))
        item = await self.session.scalar(
            select(IntegrationOutbox)
            .where(
                IntegrationOutbox.attempts < IntegrationOutbox.max_attempts,
                or_(
                    (IntegrationOutbox.status == "pending") & (IntegrationOutbox.available_at <= now),
                    (IntegrationOutbox.status == "processing") & (IntegrationOutbox.heartbeat_at < stale_at),
                    (IntegrationOutbox.status == "processing") & (IntegrationOutbox.heartbeat_at.is_(None)) & (IntegrationOutbox.locked_at < stale_at),
                ),
            )
            .order_by(IntegrationOutbox.available_at, IntegrationOutbox.created_at)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if item is None:
            return None
        item.status = "processing"
        item.locked_by = worker_id
        item.locked_at = now
        item.heartbeat_at = now
        item.attempts += 1
        await self.session.flush()
        return item

    async def succeed(self, item: IntegrationOutbox) -> None:
        item.status = "succeeded"
        item.processed_at = datetime.utcnow()
        item.locked_by = None
        item.locked_at = None
        item.heartbeat_at = None
        item.error_code = None
        item.last_error = None

    async def fail(self, item: IntegrationOutbox, *, code: str, message: str) -> None:
        item.error_code = code[:80]
        item.last_error = message[:2000]
        item.locked_by = None
        item.locked_at = None
        item.heartbeat_at = None
        if item.attempts >= item.max_attempts:
            item.status = "dead"
            item.processed_at = datetime.utcnow()
        else:
            item.status = "pending"
            item.available_at = datetime.utcnow() + timedelta(seconds=min(300, 2 ** min(item.attempts, 8)))
