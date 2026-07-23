from __future__ import annotations

from datetime import datetime

from app.database import AsyncSessionLocal
from app.repositories.runs import RunRepository


class RunService:
    async def cancel(self, user_id: str, run_id: str, reason: str) -> bool:
        now = datetime.utcnow()
        async with AsyncSessionLocal() as session:
            repository = RunRepository(session)
            run = await repository.get_run(user_id, run_id)
            if run is None:
                return False
            if run.status == "running":
                run.status = "cancelled"
                run.error_message = reason or "user_cancelled"
                run.finished_at = now
            for checkpoint in await repository.list_waiting_checkpoints(user_id, run_id):
                checkpoint.status = "cancelled"
                checkpoint.resolved_at = now
                checkpoint.updated_at = now
            await session.commit()
            return True
