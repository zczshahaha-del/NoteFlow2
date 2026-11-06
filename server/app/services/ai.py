from __future__ import annotations

import json
import logging
import asyncio
from dataclasses import dataclass, field
from typing import AsyncIterator

import httpx

from app.services.prompt_templates import render_prompt
from app.config import cfg
from app.services.ai_cache import (
    ai_cache_key,
    ai_cache_lock,
    cached_delta,
    cached_stop_delta,
    get_cached_ai_text,
    set_cached_ai_text,
)
from app.services.prompts import NoteGenerateRequest, build_note_generate_prompt
from app.services.observability import record_metric, record_provider_usage

logger = logging.getLogger(__name__)

ERR_NOT_CONFIGURED = "DeepSeek API Key is not configured on server"
ERR_RATE_LIMITED = "AI_RATE_LIMITED"

MAX_DOC_RUNES = 12000
MAX_HISTORY = 8


def _estimate_tokens(value: str) -> int:
    return max(1, (len(value or "") + 3) // 4)


def _message_tokens(messages: list[dict]) -> int:
    return sum(_estimate_tokens(str(message.get("content") or "")) for message in messages)


def _llm_cost(input_tokens: int, output_tokens: int) -> float:
    return (
        input_tokens * cfg.LLM_INPUT_USD_PER_MILLION_TOKENS
        + output_tokens * cfg.LLM_OUTPUT_USD_PER_MILLION_TOKENS
    ) / 1_000_000


@dataclass
class ChatMessage:
    role: str
    text: str


@dataclass
class ChatRequest:
    question: str
    documentTitle: str = ""
    documentContent: str = ""
    memoryContext: str = ""
    history: list[ChatMessage] = field(default_factory=list)
    maxTokens: int = 0
    temperature: float | None = None
    strictNoteAnswer: bool = False


def _trim_document(content: str) -> str:
    if len(content) <= MAX_DOC_RUNES:
        return content
    return content[:MAX_DOC_RUNES] + "\n\n[Document truncated]"


def _normalize_max_tokens(value: int) -> int:
    if value <= 0:
        return 0
    if value < 512:
        return 512
    if value > 24000:
        return 24000
    return value


def _clamp_temperature(value: float | None) -> float:
    if value is None:
        return 0.7
    if value < 0 or value > 2:
        return 0.7
    return value


def _build_chat_messages(payload: ChatRequest) -> list[dict]:
    memory_text = payload.memoryContext.strip()
    if payload.documentContent and payload.documentContent.strip():
        title = payload.documentTitle.strip() or "Untitled"
        context_text = render_prompt("chat/document", title=title, document=_trim_document(payload.documentContent))
    else:
        context_text = render_prompt("chat/no-document")

    if memory_text:
        context_text = render_prompt("chat/memory-context", memory=memory_text, document=context_text)

    strict_note_instruction = render_prompt("chat/strict-notes") + " " if payload.strictNoteAnswer else ""

    messages = [
        {
            "role": "system",
            "content": render_prompt("chat/answer", strict_notes=strict_note_instruction),
        },
        {"role": "user", "content": context_text},
    ]

    history = payload.history
    if len(history) > MAX_HISTORY:
        history = history[-MAX_HISTORY:]

    for msg in history:
        text = (msg.text or "").strip()
        if not text:
            continue
        if msg.role == "user":
            messages.append({"role": "user", "content": text})
        elif msg.role == "assistant":
            messages.append({"role": "assistant", "content": text})

    messages.append({"role": "user", "content": payload.question})
    return messages


def _build_prompt_messages(prompt: str) -> list[dict]:
    return [
        {
            "role": "system",
            "content": render_prompt("notes/generation-system"),
        },
        {"role": "user", "content": prompt},
    ]


def _completion_body(
    *,
    messages: list[dict],
    stream: bool,
    max_tokens: int,
    temperature: float,
    thinking: str | None = None,
    response_format: dict | None = None,
) -> dict:
    body: dict = {
        "model": cfg.DEEPSEEK_MODEL,
        "messages": messages,
        "stream": stream,
        "temperature": temperature,
    }
    if max_tokens > 0:
        body["max_tokens"] = max_tokens
    if thinking in {"enabled", "disabled"}:
        body["thinking"] = {"type": thinking}
    if response_format:
        body["response_format"] = response_format
    return body


def _is_rate_limit_response(status_code: int, text: str) -> bool:
    lower = (text or "").lower()
    return status_code in {429, 503} or "too many" in lower or "rate limit" in lower or "requests" in lower and "later" in lower


async def _stream_deepseek(body: dict) -> AsyncIterator[dict]:
    retry_delays = [1.5, 3.0, 6.0]
    last_error = ""
    for attempt in range(len(retry_delays) + 1):
        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0)) as client:
            async with client.stream(
                "POST",
                f"{cfg.DEEPSEEK_BASE_URL}/chat/completions",
                headers={"Authorization": f"Bearer {cfg.DEEPSEEK_API_KEY}"},
                json=body,
            ) as resp:
                if resp.status_code != 200:
                    error_text = (await resp.aread()).decode(errors="ignore")
                    last_error = error_text
                    if _is_rate_limit_response(resp.status_code, error_text) and attempt < len(retry_delays):
                        await asyncio.sleep(retry_delays[attempt])
                        continue
                    if _is_rate_limit_response(resp.status_code, error_text):
                        raise ValueError(ERR_RATE_LIMITED)
                    raise ValueError(f"DeepSeek API error: {error_text}")
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data_str = line[5:].strip()
                    if not data_str or data_str == "[DONE]":
                        return
                    try:
                        data = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue
                    yield data
                return
    raise ValueError(ERR_RATE_LIMITED if _is_rate_limit_response(429, last_error) else f"DeepSeek API error: {last_error}")


def _delta_text(chunk: dict) -> str:
    choice = (chunk.get("choices") or [{}])[0]
    delta = choice.get("delta") or {}
    return str(delta.get("content") or "")


async def stream_chat(payload: ChatRequest) -> AsyncIterator[dict]:
    if not payload.question or not payload.question.strip():
        raise ValueError("question is required")

    messages = _build_chat_messages(payload)
    max_tokens = _normalize_max_tokens(payload.maxTokens)
    temperature = _clamp_temperature(payload.temperature)
    body = _completion_body(
        messages=messages,
        stream=True,
        max_tokens=max_tokens,
        temperature=temperature,
    )
    cache_key = ai_cache_key("stream-chat", body)
    cached = await get_cached_ai_text(cache_key)
    if cached is not None:
        record_provider_usage("deepseek", "chat", cache_hit=True)
        yield cached_delta(cached)
        yield cached_stop_delta()
        return

    if not cfg.DEEPSEEK_API_KEY:
        raise ValueError(ERR_NOT_CONFIGURED)

    async with ai_cache_lock(cache_key):
        cached = await get_cached_ai_text(cache_key)
        if cached is not None:
            record_provider_usage("deepseek", "chat", cache_hit=True)
            yield cached_delta(cached)
            yield cached_stop_delta()
            return

        parts: list[str] = []
        started = asyncio.get_running_loop().time()
        try:
            async for chunk in _stream_deepseek(body):
                text = _delta_text(chunk)
                if text:
                    parts.append(text)
                yield chunk
        except Exception:
            record_provider_usage("deepseek", "chat", failed=True)
            record_metric("provider", "chat", status="failed", duration_ms=(asyncio.get_running_loop().time() - started) * 1000)
            raise
        input_tokens = _message_tokens(messages)
        output_tokens = _estimate_tokens("".join(parts))
        record_provider_usage(
            "deepseek", "chat", input_tokens=input_tokens, output_tokens=output_tokens,
            estimated_cost_usd=_llm_cost(input_tokens, output_tokens),
        )
        record_metric("provider", "chat", duration_ms=(asyncio.get_running_loop().time() - started) * 1000)
        await set_cached_ai_text(cache_key, "".join(parts).strip())


async def complete_chat(
    messages: list[dict],
    *,
    max_tokens: int = 1200,
    temperature: float = 0.0,
    thinking: str | None = None,
    response_format: dict | None = None,
) -> str:
    if not messages:
        raise ValueError("messages are required")

    normalized_max_tokens = _normalize_max_tokens(max_tokens)
    body = _completion_body(
        messages=messages,
        stream=False,
        max_tokens=normalized_max_tokens,
        temperature=_clamp_temperature(temperature),
        thinking=thinking,
        response_format=response_format,
    )
    cache_key = ai_cache_key("complete-chat", body)
    cached = await get_cached_ai_text(cache_key)
    if cached is not None:
        record_provider_usage("deepseek", "completion", cache_hit=True)
        return cached

    if not cfg.DEEPSEEK_API_KEY:
        raise ValueError(ERR_NOT_CONFIGURED)

    async with ai_cache_lock(cache_key):
        cached = await get_cached_ai_text(cache_key)
        if cached is not None:
            record_provider_usage("deepseek", "completion", cache_hit=True)
            return cached

        started = asyncio.get_running_loop().time()
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
            resp = await client.post(
                f"{cfg.DEEPSEEK_BASE_URL}/chat/completions",
                headers={"Authorization": f"Bearer {cfg.DEEPSEEK_API_KEY}"},
                json=body,
            )
            if resp.status_code != 200:
                raise ValueError(f"DeepSeek API error: {resp.text}")
            data = resp.json()
            usage = data.get("usage") or {}
            input_tokens = int(usage.get("prompt_tokens") or _message_tokens(messages))
            output_tokens = int(usage.get("completion_tokens") or 0)
            record_provider_usage(
                "deepseek", "completion", input_tokens=input_tokens, output_tokens=output_tokens,
                estimated_cost_usd=_llm_cost(input_tokens, output_tokens),
            )
            record_metric("provider", "completion", duration_ms=(asyncio.get_running_loop().time() - started) * 1000)
            choices = data.get("choices") or []
            if not choices:
                return ""
            message = choices[0].get("message") or {}
            content = str(message.get("content") or "")
            await set_cached_ai_text(cache_key, content)
            return content


async def stream_note_generate(req: NoteGenerateRequest) -> AsyncIterator[dict]:
    prompt = build_note_generate_prompt(req)
    if not prompt.strip():
        raise ValueError("prompt is required")

    messages = _build_prompt_messages(prompt)
    max_tokens = _normalize_max_tokens(req.maxTokens)
    temperature = _clamp_temperature(req.temperature)
    body = _completion_body(
        messages=messages,
        stream=True,
        max_tokens=max_tokens,
        temperature=temperature,
        thinking="disabled",
    )
    cache_key = ai_cache_key("stream-note", body)
    cached = await get_cached_ai_text(cache_key)
    if cached is not None:
        yield cached_delta(cached)
        yield cached_stop_delta()
        return

    if not cfg.DEEPSEEK_API_KEY:
        raise ValueError(ERR_NOT_CONFIGURED)

    async with ai_cache_lock(cache_key):
        cached = await get_cached_ai_text(cache_key)
        if cached is not None:
            yield cached_delta(cached)
            yield cached_stop_delta()
            return

        parts: list[str] = []
        async for chunk in _stream_deepseek(body):
            text = _delta_text(chunk)
            if text:
                parts.append(text)
            yield chunk
        await set_cached_ai_text(cache_key, "".join(parts).strip())
