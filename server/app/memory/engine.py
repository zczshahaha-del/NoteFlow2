"""Engine-neutral contracts. Provider IDs never select the authenticated owner."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol


class MemoryUnavailable(RuntimeError):
    pass


@dataclass
class MemoryRecord:
    id: str
    content: str
    source_ref: str = ""
    memory_type: str = "personal_info"
    status: str = "active"
    source: str = "user_message"
    scope: str = "global"
    memory_layer: str = "semantic"
    canonical_key: str = ""
    importance: int = 3
    confidence: float | None = None
    tags: list[str] = field(default_factory=list)
    created_at: datetime | None = None
    updated_at: datetime | None = None
    deleted_at: datetime | None = None
    last_used_at: datetime | None = None
    expires_at: datetime | None = None
    access_count: int = 0
    provider: str = "hindsight"


class MemoryEngine(Protocol):
    name: str

    async def ensure_bank(self, user_id: str, mission: str) -> None: ...
    async def list(self, user_id: str, **filters) -> list[dict]: ...
    async def recall(self, user_id: str, query: str) -> list[dict]: ...
    async def get(self, user_id: str, memory_id: str) -> dict: ...
    async def retain(self, user_id: str, *, content: str, source_id: str, metadata: dict) -> None: ...
    async def curate(self, user_id: str, memory_id: str, changes: dict) -> dict: ...
    async def delete_source(self, user_id: str, source_id: str) -> None: ...
    async def configure(self, user_id: str, mission: str) -> None: ...
    async def graph(self, user_id: str) -> dict: ...
    async def document(self, user_id: str, source_id: str) -> dict | None: ...
    async def delete_bank(self, user_id: str) -> None: ...


def configured_engine() -> MemoryEngine:
    from app.providers.hindsight import HindsightProvider
    return HindsightProvider()
