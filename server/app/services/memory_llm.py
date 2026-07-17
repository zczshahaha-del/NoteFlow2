from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Iterable

from app.services.ai import ChatMessage, complete_chat
from app.services.memory import (
    MemoryCandidate,
    PERSISTED_MEMORY_LAYERS,
    clamp_importance,
    extract_memory_candidates,
    memory_layer_tags,
    normalize_canonical_key,
    normalize_memory_layer,
    normalize_memory_type,
    normalize_scope,
)

MAX_HISTORY_CHARS = 2200


def _clean(value: object, limit: int = 500) -> str:
    text = re.sub(r"\s+", " ", str(value or "").strip())
    return text[:limit]


def _clamp_confidence(value: object) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, number))


def _json_from_text(text: str) -> dict:
    raw = (text or "").strip()
    if not raw:
        return {"candidates": []}
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.S)
        if not match:
            return {"candidates": []}
        try:
            data = json.loads(match.group(0))
        except json.JSONDecodeError:
            return {"candidates": []}
    return data if isinstance(data, dict) else {"candidates": []}


def _candidate_content(memory_type: str, value: str) -> str:
    labels = {
        "episode": "用户历史经历",
        "identity": "用户身份信息",
        "personal_info": "用户个人信息",
        "interest": "用户兴趣爱好",
        "preference": "用户偏好",
        "goal": "用户目标或当前状态",
        "writing_style": "用户表达偏好",
        "project": "用户项目背景",
        "skill": "用户技能或学习方向",
        "constraint": "用户长期限制",
        "workflow": "用户工作习惯",
    }
    return f"{labels.get(memory_type, '用户记忆')}：{value}"


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
    items = payload.get("candidates") if isinstance(payload, dict) else []
    if not isinstance(items, list):
        return []

    candidates: list[MemoryCandidate] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        operation = _clean(item.get("operation"), 24) or "candidate"
        memory_type = normalize_memory_type(_clean(item.get("memory_type"), 40))
        layer = normalize_memory_layer(_clean(item.get("layer"), 24), memory_type)
        if layer not in PERSISTED_MEMORY_LAYERS:
            operation = "reject"
        value = _clean(item.get("value"), 500)
        content = _clean(item.get("content"), 1000) or _candidate_content(memory_type, value)
        canonical_key = normalize_canonical_key(item.get("canonical_key"), memory_type)
        confidence = _clamp_confidence(item.get("confidence"))
        source = _clean(item.get("source"), 50) or "llm_extracted"
        subject = _clean(item.get("subject"), 24) or "unknown"
        temporal_scope = _clean(item.get("temporal_scope"), 24) or "unknown"
        stability = _clean(item.get("stability"), 24) or "medium"
        tags = _candidate_tags(
            item.get("tags") or [],
            layer=layer,
            canonical_key=canonical_key,
            value=value,
            extraction_method=extraction_method,
        )
        if operation:
            tags.append(f"operation:{operation}"[:80])
        if subject:
            tags.append(f"subject:{subject}"[:80])
        if temporal_scope:
            tags.append(f"temporal:{temporal_scope}"[:80])
        tags = tags[:12]

        candidates.append(
            MemoryCandidate(
                memory_type=memory_type,
                content=content[:1000],
                importance=clamp_importance(item.get("importance")),
                confidence=confidence,
                should_save=operation in {"upsert", "candidate"} and bool(value or content),
                source=source,
                scope=normalize_scope(_clean(item.get("scope"), 50)),
                tags=tags,
                canonical_key=canonical_key,
                value=value,
                layer=layer,
                stability=stability,
                subject=subject,
                temporal_scope=temporal_scope,
                operation=operation,
                reason=_clean(item.get("reason"), 300),
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
7. 输出必须是 JSON 对象，不能有 markdown，不能有解释文字。

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
    content = await complete_chat(
        _build_messages(text, context, history),
        max_tokens=1800,
        temperature=0.0,
    )
    return candidates_from_llm_payload(_json_from_text(content), extraction_method="llm")


async def extract_memory_candidates_smart(
    text: str,
    context: str = "global",
    history: list[ChatMessage] | None = None,
) -> list[MemoryCandidate]:
    try:
        candidates = await extract_memory_candidates_llm(text, context, history)
        if candidates:
            return candidates
    except Exception:
        pass
    fallback = extract_memory_candidates(text, context)
    for candidate in fallback:
        candidate.reason = candidate.reason or "规则兜底提取"
        if "method:rule" not in candidate.tags:
            candidate.tags = (candidate.tags + ["method:rule"])[:12]
    return fallback
