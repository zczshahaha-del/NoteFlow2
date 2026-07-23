from __future__ import annotations

from dataclasses import asdict, dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.memory.policy import memory_is_eligible
from app.models.db import IntegrationOutbox, UserMemory
from app.services.outbox import enqueue_memory_sync


@dataclass(frozen=True)
class Mem0BackfillReport:
    total: int
    eligible: int
    already_linked: int
    already_queued: int
    enqueued: int
    skipped_ineligible: int
    dry_run: bool
    batch_id: str

    def to_dict(self) -> dict:
        return asdict(self)


def _eligible_backfill_memories(memories: list[UserMemory]) -> list[UserMemory]:
    return [
        memory
        for memory in memories
        if memory_is_eligible(memory)
        and not (memory.external_provider == "mem0" and memory.external_id)
    ]


def _backfill_version(batch_id: str) -> str:
    return f"mem0-backfill:{batch_id}"


def _backfill_key(memory_id: str, batch_id: str) -> str:
    return f"memory:{memory_id}:upsert:{_backfill_version(batch_id)}"


async def enqueue_mem0_backfill(
    session: AsyncSession,
    *,
    batch_id: str,
    dry_run: bool = True,
) -> Mem0BackfillReport:
    memories = list((await session.scalars(select(UserMemory).order_by(UserMemory.created_at))).all())
    candidates = _eligible_backfill_memories(memories)
    keys = [_backfill_key(memory.id, batch_id) for memory in candidates]
    existing_keys: set[str] = set()
    if keys:
        existing_keys = set(
            (await session.scalars(
                select(IntegrationOutbox.idempotency_key).where(
                    IntegrationOutbox.idempotency_key.in_(keys)
                )
            )).all()
        )

    pending = [memory for memory in candidates if _backfill_key(memory.id, batch_id) not in existing_keys]
    if not dry_run:
        for memory in pending:
            await enqueue_memory_sync(
                session,
                memory_id=memory.id,
                user_id=memory.user_id,
                operation="upsert",
                version=_backfill_version(batch_id),
            )
        await session.commit()

    return Mem0BackfillReport(
        total=len(memories),
        eligible=len(candidates),
        already_linked=sum(
            1 for memory in memories if memory.external_provider == "mem0" and bool(memory.external_id)
        ),
        already_queued=len(existing_keys),
        enqueued=0 if dry_run else len(pending),
        skipped_ineligible=len(memories) - len(candidates) - sum(
            1
            for memory in memories
            if memory_is_eligible(memory)
            and memory.external_provider == "mem0"
            and bool(memory.external_id)
        ),
        dry_run=dry_run,
        batch_id=batch_id,
    )
