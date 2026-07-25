from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Iterable, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.services.ai import ChatMessage, complete_chat
from app.services.memory import (
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
    system = f"""
你是 NoteFlow 的 Memory Extractor，只负责把用户当前这句话里的长期可复用信息提取成结构化 JSON。
当前日期：{today}

硬规则：
1. 只从“当前用户消息”提取记忆；最近对话只用于理解“这个/那样/它”等指代。
2. 只记录用户本人明确表达的事实、偏好、长期习惯、目标、约束、项目背景、技能方向、回答风格、重要历史经历。
3. 不要记录助手自己说的话，不要记录第三方事实，除非该事实直接描述用户与第三方的稳定关系或用户偏好。
4. 临时状态不要保存，例如“今天累”“这次先这样”“刚才不想写”。但“最近正在找工作/最近在学 Redis”属于当前阶段状态，可以提取。
5. 不要把提问当成记忆写入，例如“你还记得我叫什么吗”应返回空 candidates。
6. 不要做没有依据的推断：频繁问 Redis 不等于喜欢 Redis。
7. 输出必须严格符合末尾 JSON Schema，不能有 markdown，不能有解释文字。

允许的 memory_type：
episode, identity, personal_info, interest, preference, goal, writing_style, project, skill, constraint, workflow

字段要求：
- operation: upsert / candidate / reject
- layer: semantic / episodic。用户画像、事实、偏好、长期习惯、目标、约束、项目背景用 semantic；过去发生且对用户有意义的经历、阶段结果、面试结果、项目节点用 episodic。不要输出 instant、short_term、working。
- subject: user / third_party / assistant / unknown
- temporal_scope: durable / current_phase / temporary / unknown
- stability: high / medium / low
- source: 用户直接第一人称陈述用 user_explicit；需要轻微归纳用 ai_inferred
- canonical_key 使用英文点分 snake 名称，例如 identity.name, lifestyle.sleep_schedule, career.current_status, learning.current_focus, career.interview_history
- 同义信息要使用稳定 key：名字用 identity.name；年龄用 profile.age；作息/熬夜/睡眠习惯用 lifestyle.sleep_schedule；求职状态用 career.current_status；面试经历/面试结果用 career.interview_history；回答风格用 communication.answer_style。
- 用户提到过去发生的、对本人有意义的经历或事件，使用 episode，例如面试结果、求职挫折、项目阶段结果。

返回格式：
{{"candidates":[{{"memory_type":"personal_info","layer":"semantic","canonical_key":"lifestyle.sleep_schedule","value":"作息较乱，经常熬夜","content":"用户生活习惯：作息较乱，经常熬夜","importance":4,"confidence":0.86,"source":"user_explicit","scope":"global","tags":["生活习惯","睡眠"],"subject":"user","temporal_scope":"durable","stability":"medium","operation":"upsert","reason":"用户第一人称描述自己的长期作息习惯"}}]}}

正例：
- “我的作息很乱，总是熬夜” => lifestyle.sleep_schedule，personal_info，upsert
- “我写代码前喜欢先画流程图” => workflow.coding_planning，workflow，upsert
- “我不喜欢太官方的回答” => communication.answer_style，writing_style，upsert
- “我最近在找后端实习” => career.current_status，goal，upsert
- “我上个月某公司面试没过，准备了三个月很可惜” => career.interview_history，episode，episodic，upsert

反例：
- “我朋友叫李雷” => 空 candidates
- “今天我有点累” => 空 candidates
- “缓存雪崩是什么” => 空 candidates
- “你还记得我多大了吗” => 空 candidates

JSON Schema：
{schema}
""".strip()
    user = (
        f"上下文类型：{context or 'global'}\n"
        f"最近对话：\n{_format_history(history)}\n\n"
        f"当前用户消息：\n{text.strip()}"
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
            "content": (
                "上一份 JSON 未通过协议校验。"
                "请严格按照 JSON Schema 修复，只返回完整 JSON 对象。"
            ),
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
