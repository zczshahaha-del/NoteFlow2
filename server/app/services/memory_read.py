from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime

from app.services.ai import ChatMessage, complete_chat
from app.services.memory import (
    MEMORY_SCOPES,
    MEMORY_TYPES,
    PERSISTED_MEMORY_LAYERS,
    normalize_canonical_key,
    normalize_memory_layer,
)

MAX_HISTORY_CHARS = 1800


@dataclass
class MemoryReadPlan:
    is_memory_query: bool = True
    query: str = ""
    layers: list[str] = field(default_factory=list)
    memory_types: list[str] = field(default_factory=list)
    canonical_keys: list[str] = field(default_factory=list)
    scopes: list[str] = field(default_factory=lambda: ["global"])
    limit: int = 8
    confidence: float = 0.0
    reason: str = ""


def _clean(value: object, limit: int = 500) -> str:
    text = re.sub(r"\s+", " ", str(value or "").strip())
    return text[:limit]


def _json_from_text(text: str) -> dict:
    raw = (text or "").strip()
    if not raw:
        return {}
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.S)
        if not match:
            return {}
        try:
            data = json.loads(match.group(0))
        except json.JSONDecodeError:
            return {}
    return data if isinstance(data, dict) else {}


def _clamp_confidence(value: object) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, number))


def _list_strings(value: object, *, limit: int = 8) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        text = _clean(item, 80)
        if text and text not in result:
            result.append(text)
        if len(result) >= limit:
            break
    return result


def read_plan_from_llm_payload(payload: dict, question: str = "") -> MemoryReadPlan:
    layers = [
        normalize_memory_layer(item)
        for item in _list_strings(payload.get("layers"), limit=4)
        if item in PERSISTED_MEMORY_LAYERS
    ]
    memory_types = [item for item in _list_strings(payload.get("memory_types")) if item in MEMORY_TYPES]
    canonical_keys = [
        key
        for key in (normalize_canonical_key(item) for item in _list_strings(payload.get("canonical_keys")))
        if key
    ]
    scopes = [item for item in _list_strings(payload.get("scopes"), limit=4) if item in MEMORY_SCOPES]
    try:
        limit = int(payload.get("limit") or 8)
    except (TypeError, ValueError):
        limit = 8
    return MemoryReadPlan(
        is_memory_query=bool(payload.get("is_memory_query", True)),
        query=_clean(payload.get("query"), 300) or _clean(question, 300),
        layers=layers,
        memory_types=memory_types,
        canonical_keys=canonical_keys,
        scopes=scopes or ["global"],
        limit=max(1, min(limit, 12)),
        confidence=_clamp_confidence(payload.get("confidence")),
        reason=_clean(payload.get("reason"), 300),
    )


def fallback_memory_read_plan(question: str) -> MemoryReadPlan:
    q = question or ""
    if re.search(r"(记住了.*哪些|你.*记住.*什么|长期记忆|记忆列表|查看记忆|关于我.*记得|你.*了解我)", q):
        return MemoryReadPlan(query=q, memory_types=[], canonical_keys=[], limit=12, confidence=0.55, reason="fallback:list_all")
    if re.search(r"(作息|睡眠|熬夜|早睡|晚睡|睡觉|起床)", q):
        return MemoryReadPlan(
            query="用户作息 睡眠 熬夜 生活习惯",
            layers=["semantic"],
            memory_types=["personal_info", "preference", "workflow"],
            canonical_keys=["lifestyle.sleep_schedule"],
            confidence=0.7,
            reason="fallback:sleep_schedule",
        )
    if re.search(r"(多大|几岁|年龄|身高|体重|家乡|生日|所在地|城市)", q):
        keys = []
        if re.search(r"(多大|几岁|年龄)", q):
            keys.append("profile.age")
        return MemoryReadPlan(
            query=q,
            layers=["semantic"],
            memory_types=["personal_info"],
            canonical_keys=keys,
            confidence=0.65,
            reason="fallback:personal_info",
        )
    if re.search(r"(名字|我叫|称呼|我是谁|认识我吗|记得我吗|还记得我吗)", q):
        return MemoryReadPlan(
            query="用户名字 称呼 身份",
            layers=["semantic"],
            memory_types=["identity"],
            canonical_keys=["identity.name"],
            confidence=0.65,
            reason="fallback:identity",
        )
    if re.search(r"(喜欢|爱好|兴趣|玩什么|偏好)", q):
        return MemoryReadPlan(
            query=q,
            layers=["semantic"],
            memory_types=["interest", "preference", "writing_style"],
            canonical_keys=[],
            confidence=0.6,
            reason="fallback:preference",
        )
    if re.search(r"(面试|笔试|offer|录用|没过|挂了|失败|金山|腾讯|阿里|字节|美团|快手|百度|小米|网易)", q, re.I):
        return MemoryReadPlan(
            query=f"用户面试经历 求职经历 公司 面试结果 {q}",
            layers=["episodic", "semantic"],
            memory_types=["episode", "goal", "personal_info", "skill"],
            canonical_keys=["career.interview_history"],
            confidence=0.72,
            reason="fallback:interview_history",
        )
    if re.search(r"(目标|找工作|求职|职业|工作)", q):
        return MemoryReadPlan(
            query=q,
            layers=["semantic"],
            memory_types=["goal", "personal_info", "skill"],
            canonical_keys=["career.current_status"],
            confidence=0.6,
            reason="fallback:career",
        )
    return MemoryReadPlan(query=q, memory_types=[], canonical_keys=[], confidence=0.45, reason="fallback:general")


def _format_history(history: list[ChatMessage] | None) -> str:
    if not history:
        return "无"
    lines: list[str] = []
    for message in history[-8:]:
        role = "用户" if message.role == "user" else "助手"
        text = _clean(message.text, 360)
        if text:
            lines.append(f"{role}: {text}")
    joined = "\n".join(lines)
    return joined[-MAX_HISTORY_CHARS:] or "无"


def _build_messages(question: str, history: list[ChatMessage] | None) -> list[dict]:
    today = datetime.utcnow().date().isoformat()
    system = f"""
你是 NoteFlow 的 Memory Read Planner，只负责把用户当前问题转换成“读取用户记忆”的检索计划。
当前日期：{today}

硬规则：
1. 判断用户想查询哪一类“关于用户自己的记忆”。不要回答问题，只返回 JSON。
2. “记得我/知道我/了解我”只是读取动作，不代表 identity。真正的主题要看后面的词：作息、名字、年龄、爱好、求职、风格等。
3. 优先输出 canonical_keys；无法确定具体 key 时再输出 memory_types。
4. 如果用户在问“你记住了什么/我的长期记忆/查看记忆”，memory_types 和 canonical_keys 可以为空，表示读取全部。
5. 不要把笔记知识库问题当成用户记忆读取。例如“缓存雪崩是什么”不是记忆读取。
6. 输出必须是 JSON 对象，不能有 markdown，不能有解释文字。

允许的 memory_types：
episode, identity, personal_info, interest, preference, goal, writing_style, project, skill, constraint, workflow

允许的 layers：
semantic, episodic

常见 canonical_keys：
- identity.name：用户名字/称呼
- profile.age：年龄
- lifestyle.sleep_schedule：作息、睡眠、熬夜、早睡晚睡
- career.current_status：找工作、求职、实习、当前职业状态
- career.interview_history：面试经历、公司面试、面试结果、求职挫折
- learning.current_focus：最近学习方向
- communication.answer_style：回答风格偏好
- interest.general：兴趣爱好

返回格式：
{{"is_memory_query":true,"query":"用户作息和睡眠习惯","layers":["semantic"],"memory_types":["personal_info"],"canonical_keys":["lifestyle.sleep_schedule"],"scopes":["global"],"limit":8,"confidence":0.92,"reason":"用户在问自己的作息记忆"}}

例子：
- “你还记得我的作息怎么样吗” => semantic + personal_info + lifestyle.sleep_schedule
- “我叫什么来着” => semantic + identity + identity.name
- “你知道我多大吗” => semantic + personal_info + profile.age
- “你还记得我最近在忙什么吗” => semantic + goal/personal_info/skill，query 写“用户最近状态、任务、学习或求职”
- “你还记得我金山的面试情况吗” => episodic/semantic + episode/goal，canonical_keys 写 career.interview_history，query 写“用户金山面试经历和结果”
- “你记住了我哪些东西” => 全部读取，memory_types=[]
""".strip()
    user = (
        f"最近对话：\n{_format_history(history)}\n\n"
        f"当前用户问题：\n{question.strip()}"
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


async def plan_memory_read_llm(question: str, history: list[ChatMessage] | None = None) -> MemoryReadPlan:
    content = await complete_chat(
        _build_messages(question, history),
        max_tokens=900,
        temperature=0.0,
    )
    return read_plan_from_llm_payload(_json_from_text(content), question)


async def plan_memory_read_smart(question: str, history: list[ChatMessage] | None = None) -> MemoryReadPlan:
    fallback = fallback_memory_read_plan(question)
    try:
        plan = await plan_memory_read_llm(question, history)
        if plan.is_memory_query and plan.confidence >= 0.55:
            return plan
    except Exception:
        pass
    return fallback
