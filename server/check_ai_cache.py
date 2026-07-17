from __future__ import annotations

import asyncio

from app import database as db
from app.config import cfg
from app.services import ai as ai_service
from app.services.ai_cache import (
    ai_cache_key,
    clear_ai_memory_cache_for_tests,
    get_cached_ai_text,
    set_cached_ai_text,
)
from app.services.prompts import NoteGenerateRequest, build_note_generate_prompt


def _assert(condition: bool, message: str):
    if not condition:
        raise AssertionError(message)


def _chunk_text(chunk: dict) -> str:
    choice = (chunk.get("choices") or [{}])[0]
    delta = choice.get("delta") or {}
    return str(delta.get("content") or "")


async def _collect_stream(iterator) -> tuple[str, list[dict]]:
    chunks: list[dict] = []
    parts: list[str] = []
    async for chunk in iterator:
        chunks.append(chunk)
        text = _chunk_text(chunk)
        if text:
            parts.append(text)
    return "".join(parts), chunks


def _stream_chat_key(payload: ai_service.ChatRequest) -> str:
    body = ai_service._completion_body(
        messages=ai_service._build_chat_messages(payload),
        stream=True,
        max_tokens=ai_service._normalize_max_tokens(payload.maxTokens),
        temperature=ai_service._clamp_temperature(payload.temperature),
    )
    return ai_cache_key("stream-chat", body)


def _complete_chat_key(messages: list[dict], max_tokens: int = 1200, temperature: float = 0.0) -> str:
    body = ai_service._completion_body(
        messages=messages,
        stream=False,
        max_tokens=ai_service._normalize_max_tokens(max_tokens),
        temperature=ai_service._clamp_temperature(temperature),
    )
    return ai_cache_key("complete-chat", body)


def _stream_note_key(req: NoteGenerateRequest) -> str:
    body = ai_service._completion_body(
        messages=ai_service._build_prompt_messages(build_note_generate_prompt(req)),
        stream=True,
        max_tokens=ai_service._normalize_max_tokens(req.maxTokens),
        temperature=ai_service._clamp_temperature(req.temperature),
    )
    return ai_cache_key("stream-note", body)


async def main_async():
    old_key = cfg.DEEPSEEK_API_KEY
    old_cache_enabled = cfg.AI_CACHE_ENABLED
    old_cache_ttl = cfg.AI_CACHE_TTL_SECONDS
    old_redis = db.redis_client
    old_stream_deepseek = ai_service._stream_deepseek

    db.redis_client = None
    cfg.AI_CACHE_ENABLED = True
    cfg.AI_CACHE_TTL_SECONDS = 60
    clear_ai_memory_cache_for_tests()

    try:
        stable_a = ai_cache_key("x", {"b": 2, "a": 1})
        stable_b = ai_cache_key("x", {"a": 1, "b": 2})
        different_namespace = ai_cache_key("y", {"a": 1, "b": 2})
        _assert(stable_a == stable_b, "cache key should ignore object key order")
        _assert(stable_a != different_namespace, "cache namespace should affect key")

        await set_cached_ai_text(stable_a, "命中缓存")
        _assert(await get_cached_ai_text(stable_a) == "命中缓存", "memory cache should store and read text")

        cfg.DEEPSEEK_API_KEY = ""
        chat_payload = ai_service.ChatRequest(question="重复问一遍 SSE 是什么")
        await set_cached_ai_text(_stream_chat_key(chat_payload), "SSE 是服务器向浏览器单向推送事件流。")
        chat_text, chat_chunks = await _collect_stream(ai_service.stream_chat(chat_payload))
        _assert(chat_text == "SSE 是服务器向浏览器单向推送事件流。", "stream_chat should return cached text")
        _assert(chat_chunks[0].get("cached") is True, "stream_chat cache hit should mark cached chunk")

        complete_messages = [{"role": "user", "content": "缓存雪崩是什么"}]
        await set_cached_ai_text(_complete_chat_key(complete_messages), "缓存雪崩是大量缓存同时失效。")
        complete_text = await ai_service.complete_chat(complete_messages)
        _assert(complete_text == "缓存雪崩是大量缓存同时失效。", "complete_chat should return cached text")

        note_req = NoteGenerateRequest(mode="outline", topic="SSE 知识")
        await set_cached_ai_text(_stream_note_key(note_req), "# SSE 知识\n\n## 1. 基本概念")
        note_text, note_chunks = await _collect_stream(ai_service.stream_note_generate(note_req))
        _assert(note_text.startswith("# SSE 知识"), "stream_note_generate should return cached text")
        _assert(note_chunks[0].get("cached") is True, "stream_note_generate cache hit should mark cached chunk")

        try:
            await ai_service.complete_chat([{"role": "user", "content": "这条没有缓存"}])
            raise AssertionError("cache miss without API key should raise configuration error")
        except ValueError as exc:
            _assert(ai_service.ERR_NOT_CONFIGURED in str(exc), "cache miss should still require model key")

        cfg.DEEPSEEK_API_KEY = "test-key"
        clear_ai_memory_cache_for_tests()
        calls: list[dict] = []

        async def fake_stream(body: dict):
            calls.append(body)
            await asyncio.sleep(0.02)
            yield {"choices": [{"delta": {"content": "第一段"}, "finish_reason": None}]}
            yield {"choices": [{"delta": {"content": "第二段"}, "finish_reason": None}]}

        ai_service._stream_deepseek = fake_stream
        lock_payload = ai_service.ChatRequest(question="并发重复问题")
        first, second = await asyncio.gather(
            _collect_stream(ai_service.stream_chat(lock_payload)),
            _collect_stream(ai_service.stream_chat(lock_payload)),
        )
        _assert(first[0] == "第一段第二段", "first concurrent request should stream model text")
        _assert(second[0] == "第一段第二段", "second concurrent request should reuse cached model text")
        _assert(len(calls) == 1, f"same cache key should only call model once, got {len(calls)}")
    finally:
        cfg.DEEPSEEK_API_KEY = old_key
        cfg.AI_CACHE_ENABLED = old_cache_enabled
        cfg.AI_CACHE_TTL_SECONDS = old_cache_ttl
        db.redis_client = old_redis
        ai_service._stream_deepseek = old_stream_deepseek
        clear_ai_memory_cache_for_tests()


def main():
    asyncio.run(main_async())


if __name__ == "__main__":
    main()
