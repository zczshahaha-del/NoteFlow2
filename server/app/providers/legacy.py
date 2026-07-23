from __future__ import annotations

from typing import AsyncIterator

from app.database import AsyncSessionLocal
from app.providers.contracts import (
    ChatProviderRequest,
    EmbeddingProviderResult,
    ProviderChatMessage,
    RerankCandidate,
    VectorSearchRequest,
)
from app.services.ai import ChatMessage, ChatRequest, stream_chat
from app.services.embeddings import embed_texts
from app.services.memory import find_memories
from app.services.note_library import hybrid_search_notes, source_to_dict


class LegacyChatModelProvider:
    name = "legacy"

    async def stream(self, request: ChatProviderRequest) -> AsyncIterator[dict]:
        payload = ChatRequest(
            question=request.question,
            documentTitle=request.document_title,
            documentContent=request.document_content,
            memoryContext=request.memory_context,
            history=[ChatMessage(role=item.role, text=item.text) for item in request.history],
            maxTokens=request.max_tokens,
            temperature=request.temperature,
            strictNoteAnswer=request.strict_note_answer,
        )
        async for chunk in stream_chat(payload):
            yield chunk


class LegacyEmbeddingProvider:
    name = "legacy"

    async def embed(self, texts: list[str]) -> EmbeddingProviderResult:
        result = await embed_texts(texts)
        return EmbeddingProviderResult(result.embeddings, result.provider, result.model, result.dimensions)


class LegacyRerankerProvider:
    name = "legacy"

    async def rerank(self, query: str, candidates: list[RerankCandidate], limit: int) -> list[RerankCandidate]:
        del query
        return sorted(candidates, key=lambda item: item.score, reverse=True)[: max(0, limit)]


class LegacyVectorStoreProvider:
    name = "legacy"

    async def search(self, request: VectorSearchRequest) -> list[RerankCandidate]:
        async with AsyncSessionLocal() as session:
            sources = await hybrid_search_notes(
                session,
                request.user_id,
                request.query,
                note_id=request.note_id,
                limit=request.limit,
            )
        return [
            RerankCandidate(
                id=source.chunk_id or source.section_id or source.note_id,
                text=source.snippet,
                score=source.score,
                metadata=source_to_dict(source),
            )
            for source in sources
        ]


class LegacyMemoryProvider:
    name = "legacy"

    async def search(self, *, user_id: str, query: str, limit: int = 8) -> list[dict]:
        async with AsyncSessionLocal() as session:
            rows = await find_memories(session, user_id, query=query, limit=limit)
            return [
                {
                    "id": row.id,
                    "content": row.content,
                    "memoryType": row.memory_type,
                    "scope": row.scope,
                    "status": row.status,
                }
                for row in rows
            ]

    async def add(self, *, user_id: str, content: str, metadata: dict | None = None) -> dict:
        raise NotImplementedError("legacy memory writes must go through MemoryService")

    async def delete(self, *, user_id: str, memory_id: str) -> bool:
        raise NotImplementedError("legacy memory writes must go through MemoryService")
