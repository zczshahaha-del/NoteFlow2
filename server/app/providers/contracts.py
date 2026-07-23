from __future__ import annotations

from dataclasses import dataclass, field
from typing import AsyncIterator, Protocol, runtime_checkable


@dataclass(frozen=True)
class ProviderChatMessage:
    role: str
    text: str


@dataclass(frozen=True)
class ChatProviderRequest:
    question: str
    document_title: str = ""
    document_content: str = ""
    memory_context: str = ""
    history: list[ProviderChatMessage] = field(default_factory=list)
    max_tokens: int = 0
    temperature: float | None = None
    strict_note_answer: bool = False


@dataclass(frozen=True)
class EmbeddingProviderResult:
    embeddings: list[list[float]]
    provider: str
    model: str
    dimensions: int


@dataclass(frozen=True)
class RerankCandidate:
    id: str
    text: str
    score: float
    metadata: dict = field(default_factory=dict)


@dataclass(frozen=True)
class VectorSearchRequest:
    user_id: str
    query: str
    limit: int = 8
    note_id: str | None = None


@runtime_checkable
class ChatModelProvider(Protocol):
    name: str

    def stream(self, request: ChatProviderRequest) -> AsyncIterator[dict]: ...


@runtime_checkable
class EmbeddingProvider(Protocol):
    name: str

    async def embed(self, texts: list[str]) -> EmbeddingProviderResult: ...


@runtime_checkable
class RerankerProvider(Protocol):
    name: str

    async def rerank(self, query: str, candidates: list[RerankCandidate], limit: int) -> list[RerankCandidate]: ...


@runtime_checkable
class VectorStoreProvider(Protocol):
    name: str

    async def search(self, request: VectorSearchRequest) -> list[RerankCandidate]: ...


@runtime_checkable
class MemoryProvider(Protocol):
    name: str

    async def search(self, *, user_id: str, query: str, limit: int = 8) -> list[dict]: ...

    async def add(self, *, user_id: str, content: str, metadata: dict | None = None) -> dict: ...

    async def delete(self, *, user_id: str, memory_id: str) -> bool: ...
