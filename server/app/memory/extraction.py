from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Iterable, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.services.prompt_templates import render_prompt
from app.services.ai import ChatMessage, complete_chat
from app.memory.domain import (
    MemoryCandidate,
    memory_layer_tags,
)

MAX_HISTORY_CHARS = 2200
logger = logging.getLogger(__name__)


class MemoryExtractionFailure(RuntimeError):
    """The MemoryWriter model was unavailable or violated its JSON contract."""


class MemoryCandidateOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    memory_type: Literal[
        "episode",
        "identity",
        "personal_info",
        "interest",
        "preference",
        "goal",
        "writing_style",
        "project",
        "skill",
        "constraint",
        "workflow",
    ]
    layer: Literal["semantic", "episodic"]
    canonical_key: str = Field(min_length=3, max_length=80)
    value: str = Field(min_length=1, max_length=500)
    content: str = Field(min_length=1, max_length=1000)
    importance: int = Field(ge=1, le=5)
    confidence: float = Field(ge=0.0, le=1.0)
    source: Literal["user_explicit", "ai_inferred"]
    scope: Literal[
        "global",
        "note_generation",
        "note_editing",
        "note_search",
        "job_search",
        "learning",
    ] = "global"
    tags: list[str] = Field(default_factory=list, max_length=12)
    subject: Literal["user", "third_party", "assistant", "unknown"]
    temporal_scope: Literal["durable", "current_phase", "temporary", "unknown"]
    stability: Literal["high", "medium", "low"]
    operation: Literal["upsert", "candidate", "reject"]
    reason: str = Field(default="", max_length=300)


class MemoryExtractionOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    candidates: list[MemoryCandidateOutput] = Field(default_factory=list, max_length=12)


def _clean(value: object, limit: int = 500) -> str:
    text = re.sub(r"\s+", " ", str(value or "").strip())
    return text[:limit]


def _json_from_text(text: str) -> dict:
    raw = (text or "").strip()
    if not raw:
        raise ValueError("MemoryWriter returned an empty response")
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.S)
        if not match:
            raise ValueError("MemoryWriter did not return a JSON object")
        data = json.loads(match.group(0))
    if not isinstance(data, dict):
        raise ValueError("MemoryWriter JSON must be an object")
    return data


def _candidate_tags(
    tags: Iterable[object],
    *,
    layer: str,
    canonical_key: str,
    value: str,
    extraction_method: str,
) -> list[str]:
    result: list[str] = [f"key:{canonical_key}", f"method:{extraction_method}"]
    if value:
        result.append(f"value:{value}"[:120])
    for tag in tags:
        item = _clean(tag, 24)
        if item and item not in result:
            result.append(item)
    return memory_layer_tags(layer, result)


def candidates_from_llm_payload(payload: dict, *, extraction_method: str = "llm") -> list[MemoryCandidate]:
    output = MemoryExtractionOutput.model_validate(payload)

    candidates: list[MemoryCandidate] = []
    for item in output.candidates:
        tags = _candidate_tags(
            item.tags,
            layer=item.layer,
            canonical_key=item.canonical_key,
            value=item.value,
            extraction_method=extraction_method,
        )
        tags.append(f"operation:{item.operation}"[:80])
        tags.append(f"subject:{item.subject}"[:80])
        tags.append(f"temporal:{item.temporal_scope}"[:80])
        tags = tags[:12]

        candidates.append(
            MemoryCandidate(
                memory_type=item.memory_type,
                content=item.content,
                importance=item.importance,
                confidence=item.confidence,
                should_save=item.operation in {"upsert", "candidate"},
                source=item.source,
                scope=item.scope,
                tags=tags,
                canonical_key=item.canonical_key,
                value=item.value,
                layer=item.layer,
                stability=item.stability,
                subject=item.subject,
                temporal_scope=item.temporal_scope,
                operation=item.operation,
                reason=item.reason,
            )
        )
    return candidates


def _format_history(history: list[ChatMessage] | None) -> str:
    if not history:
        return "无"
    lines: list[str] = []
    for message in history[-8:]:
        role = "用户" if message.role == "user" else "助手"
        text = _clean(message.text, 420)
        if text:
            lines.append(f"{role}: {text}")
    joined = "\n".join(lines)
    return joined[-MAX_HISTORY_CHARS:] or "无"


def _build_messages(text: str, context: str, history: list[ChatMessage] | None) -> list[dict]:
    today = datetime.utcnow().date().isoformat()
    schema = json.dumps(MemoryExtractionOutput.model_json_schema(), ensure_ascii=False)
    system = render_prompt("memory/extract", today=today, schema=schema).strip()
    user = (
        render_prompt(
            "memory/extract-input",
            scope=context or 'global',
            history=_format_history(history),
            message=text.strip(),
        )
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


async def extract_memory_candidates_llm(
    text: str,
    context: str = "global",
    history: list[ChatMessage] | None = None,
) -> list[MemoryCandidate]:
    if not text or not text.strip():
        return []
    messages = _build_messages(text, context, history)
    try:
        content = await complete_chat(
            messages,
            max_tokens=1800,
            temperature=0.0,
            response_format={"type": "json_object"},
        )
    except Exception as exc:
        logger.warning("MemoryWriter provider failed: %s", type(exc).__name__)
        raise MemoryExtractionFailure("记忆提取服务暂时不可用。") from exc

    try:
        return candidates_from_llm_payload(_json_from_text(content), extraction_method="llm")
    except Exception as contract_error:
        logger.info("MemoryWriter contract repair requested: %s", type(contract_error).__name__)

    repair_messages = [
        *messages,
        {"role": "assistant", "content": content[:5000]},
        {
            "role": "user",
            "content": render_prompt("memory/extract-repair"),
        },
    ]
    try:
        repaired = await complete_chat(
            repair_messages,
            max_tokens=1800,
            temperature=0.0,
            response_format={"type": "json_object"},
        )
        return candidates_from_llm_payload(
            _json_from_text(repaired),
            extraction_method="llm_repaired",
        )
    except Exception as exc:
        logger.warning("MemoryWriter contract repair failed: %s", type(exc).__name__)
        raise MemoryExtractionFailure("记忆提取结果格式异常，自动修复后仍未成功。") from exc


async def extract_memory_candidates_smart(
    text: str,
    context: str = "global",
    history: list[ChatMessage] | None = None,
) -> list[MemoryCandidate]:
    """Compatibility entry point: semantic extraction is model-only."""

    return await extract_memory_candidates_llm(text, context, history)
