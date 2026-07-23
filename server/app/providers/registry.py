from __future__ import annotations

from dataclasses import dataclass

from app.config import cfg
from app.providers.contracts import (
    ChatModelProvider,
    EmbeddingProvider,
    MemoryProvider,
    RerankerProvider,
    VectorStoreProvider,
)
from app.providers.legacy import (
    LegacyChatModelProvider,
    LegacyEmbeddingProvider,
    LegacyMemoryProvider,
    LegacyRerankerProvider,
    LegacyVectorStoreProvider,
)
from app.providers.mem0 import get_mem0_provider


@dataclass(frozen=True)
class ProviderRegistry:
    chat: ChatModelProvider
    embedding: EmbeddingProvider
    reranker: RerankerProvider
    vector_store: VectorStoreProvider
    memory: MemoryProvider


def legacy_provider_registry() -> ProviderRegistry:
    # This compatibility registry only owns the old /api/ai chat/model boundary.
    # RAG and Memory are selected by their application services, so enabling one
    # must not make an otherwise healthy legacy chat endpoint fail at startup.
    return ProviderRegistry(
        chat=LegacyChatModelProvider(),
        embedding=LegacyEmbeddingProvider(),
        reranker=LegacyRerankerProvider(),
        vector_store=LegacyVectorStoreProvider(),
        memory=get_mem0_provider() if cfg.MEMORY_PROVIDER == "mem0" else LegacyMemoryProvider(),
    )
