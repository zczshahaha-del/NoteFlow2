from __future__ import annotations

from sqlalchemy import select

from app.models.db import AgentCheckpoint, AgentRun, AgentStep, AgentToolTrace, ChatSession
from app.repositories.base import Repository, require_user_id


class RunRepository(Repository):
    async def get_checkpoint(self, user_id: str, checkpoint_id: str) -> AgentCheckpoint | None:
        user_id = require_user_id(user_id)
        return await self.session.scalar(
            select(AgentCheckpoint).where(
                AgentCheckpoint.id == checkpoint_id,
                AgentCheckpoint.user_id == user_id,
            )
        )

    async def get_run(self, user_id: str, run_id: str) -> AgentRun | None:
        user_id = require_user_id(user_id)
        return await self.session.scalar(select(AgentRun).where(AgentRun.id == run_id, AgentRun.user_id == user_id))

    async def get_session(self, user_id: str, session_id: str, *, active_only: bool = True) -> ChatSession | None:
        user_id = require_user_id(user_id)
        stmt = select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == user_id)
        if active_only:
            stmt = stmt.where(ChatSession.archived_at.is_(None))
        return await self.session.scalar(stmt)

    async def list_steps(self, user_id: str, run_id: str) -> list[AgentStep]:
        user_id = require_user_id(user_id)
        result = await self.session.execute(
            select(AgentStep)
            .where(AgentStep.run_id == run_id, AgentStep.user_id == user_id)
            .order_by(AgentStep.step_index)
        )
        return list(result.scalars().all())

    async def list_traces(self, user_id: str, run_id: str) -> list[AgentToolTrace]:
        user_id = require_user_id(user_id)
        result = await self.session.execute(
            select(AgentToolTrace)
            .where(AgentToolTrace.run_id == run_id, AgentToolTrace.user_id == user_id)
            .order_by(AgentToolTrace.created_at)
        )
        return list(result.scalars().all())

    async def list_waiting_checkpoints(self, user_id: str, run_id: str) -> list[AgentCheckpoint]:
        user_id = require_user_id(user_id)
        result = await self.session.execute(
            select(AgentCheckpoint).where(
                AgentCheckpoint.run_id == run_id,
                AgentCheckpoint.user_id == user_id,
                AgentCheckpoint.status == "waiting_user_confirm",
            )
        )
        return list(result.scalars().all())
