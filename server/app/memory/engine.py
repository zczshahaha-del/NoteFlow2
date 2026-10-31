"""Engine-neutral contracts. Provider IDs never select the authenticated owner."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal, Protocol


class MemoryUnavailable(RuntimeError):
    pass


FactStatus = Literal["active", "archived", "unavailable"]


@dataclass(frozen=True)
class MemoryFact:
    """Normalized engine result, before applying NoteFlow's source policy."""

    id: str
    content: str
    source_id: str = ""
    status: FactStatus = "unavailable"
    derived: bool = False
    updated_at: datetime | None = None
    tags: tuple[str, ...] = ()


@dataclass(frozen=True)
class MemoryChanges:
    content: str | None = None
    status: Literal["active", "archived"] | None = None
    reason: str = ""


@dataclass(frozen=True)
class MemoryDocument:
    id: str
    content: str


@dataclass(frozen=True)
class MemoryGraphNode:
    id: str
    content: str
    source_id: str = ""


@dataclass(frozen=True)
class MemoryGraphEdge:
    source: str
    target: str
    relation: str = "关联"


@dataclass(frozen=True)
class MemoryGraph:
    nodes: tuple[MemoryGraphNode, ...] = ()
    edges: tuple[MemoryGraphEdge, ...] = ()


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
    provider: str = ""


class MemoryEngine(Protocol):
    name: str

    async def ensure_bank(self, user_id: str, mission: str) -> None: ...
    async def list(self, user_id: str, *, source_id: str | None = None,
                   status: Literal["active", "archived"] | None = None) -> list[MemoryFact]: ...
    async def recall(self, user_id: str, query: str) -> list[MemoryFact]: ...
    async def get(self, user_id: str, memory_id: str) -> MemoryFact: ...
    async def retain(self, user_id: str, *, content: str, source_id: str, metadata: dict) -> None: ...
    async def curate(self, user_id: str, memory_id: str, changes: MemoryChanges) -> MemoryFact: ...
    async def delete_source(self, user_id: str, source_id: str) -> None: ...
    async def configure(self, user_id: str, mission: str) -> None: ...
    async def graph(self, user_id: str) -> MemoryGraph: ...
    async def document(self, user_id: str, source_id: str) -> MemoryDocument | None: ...
    async def delete_bank(self, user_id: str) -> None: ...
