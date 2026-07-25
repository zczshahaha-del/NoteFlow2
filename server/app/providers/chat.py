from __future__ import annotations

from typing import AsyncIterator

from app.providers.contracts import ChatProviderRequest
from app.services.ai import ChatMessage, ChatRequest, stream_chat


class DeepSeekChatModelProvider:
    """Chat provider used by the LangGraph runtime."""

    name = "deepseek"

    async def stream(self, request: ChatProviderRequest) -> AsyncIterator[dict]:
        payload = ChatRequest(
            question=request.question,
            documentTitle=request.document_title,
            documentContent=request.document_content,
            memoryContext=request.memory_context,
            history=[
                ChatMessage(role=item.role, text=item.text)
                for item in request.history
            ],
            maxTokens=request.max_tokens,
            temperature=request.temperature,
            strictNoteAnswer=request.strict_note_answer,
        )
        async for chunk in stream_chat(payload):
            yield chunk
