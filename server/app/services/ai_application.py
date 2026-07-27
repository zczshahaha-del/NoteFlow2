from __future__ import annotations

from app.memory.context import MemoryContextService


MEMORY_TYPES = [
    "identity",
    "personal_info",
    "interest",
    "preference",
    "goal",
    "writing_style",
    "constraint",
    "workflow",
    "skill",
]


class AIApplicationService:
    def __init__(self) -> None:
        self.memory = MemoryContextService()

    async def note_generation_memory(
        self,
        *,
        user_id: str,
        requested: bool,
        topic: str,
        extra_request: str,
    ) -> str:
        return await self.memory.context(
            user_id=user_id,
            requested=requested,
            query=f"{topic} {extra_request}",
            scopes=["note_generation", "learning"],
            memory_types=MEMORY_TYPES,
        )
