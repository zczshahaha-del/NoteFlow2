from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Iterable, Optional

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import UserMemory, UserMemoryEvent
from app.memory.policy import classify_memory_content, filter_eligible_memories
from app.utils import random_id

MEMORY_TYPES = {
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
}

MEMORY_SCOPES = {
    "global",
    "note_generation",
    "note_editing",
    "note_search",
    "job_search",
    "learning",
}

MEMORY_LAYERS = {
    "instant",
    "short_term",
    "semantic",
    "episodic",
    "working",
}

PERSISTED_MEMORY_LAYERS = {
    "semantic",
    "episodic",
}

EXPLICIT_MEMORY_RE = re.compile(r"(记住|你要记得|以后都?|从现在开始|默认|后面都|今后)", re.I)
TEMPORARY_RE = re.compile(r"(这次|这篇|当前|这一节|这个小节|刚才|今天|先别|临时)")
IDENTITY_QUESTION_RE = re.compile(r"(我叫(啥|什么)|我叫什么|我的名字.*(啥|什么)|我名字.*(啥|什么)|叫我什么|怎么称呼我)")
THIRD_PARTY_RE = re.compile(r"(我(?:朋友|同学|同事|室友|对象|家人|哥哥|姐姐|弟弟|妹妹|爸爸|妈妈)|他|她|别人|有人).{0,12}(叫|喜欢|今年|正在|想|准备)")
IDENTITY_NAME_RE = re.compile(
    r"(?:我叫|我的名字(?:叫|是)|我名字(?:叫|是)|本人叫|你可以叫我|以后叫我|叫我)\s*"
    r"([\w\u4e00-\u9fff·•]{1,30})"
)
PERSONAL_INFO_QUESTION_RE = re.compile(
    r"(我(?:今年|现在)?(?:多大|几岁)|我的年龄.*(?:多少|多大)|"
    r"你.*(?:记得|知道).*我.*(?:多大|几岁|年龄))"
)
AGE_STATEMENT_RE = re.compile(
    r"(我(?:今年|现在)?(?:都|已经|刚)?\s*\d{1,3}\s*岁|"
    r"(?:今年|现在)(?:都|已经|刚)?\s*\d{1,3}\s*岁)"
)
AGE_VALUE_RE = re.compile(r"(?:我)?(?:今年|现在)?(?:都|已经|刚)?\s*(\d{1,3})\s*岁")
INTEREST_RE = re.compile(r"(我(?:很|特别|挺|比较)?(?:喜欢|爱|常玩|经常玩|平时玩|在玩|想玩)|我的爱好是)")
INTEREST_VALUE_RE = re.compile(
    r"(?:我(?:很|特别|挺|比较)?(?:喜欢|爱|常玩|经常玩|平时玩|在玩|想玩)|我的爱好是)"
    r"(?:玩|看|用|做)?\s*([^，。,.!！?？；;]{1,60})"
)
PERSONAL_INFO_RE = re.compile(
    r"(我(?:很|特别|挺|比较|有点)?(?:瘦|胖|高|矮|内向|外向|社恐|健谈|忙|焦虑|紧张)|"
    r"我的(?:身高|体重|年龄|生日|家乡|学校|专业|职业|工作|公司|城市|所在地|\s*MBTI|\s*mbti))"
)
JOB_GOAL_RE = re.compile(
    r"(我.*(?:找工作|找.{0,20}工作|求职|投简历|准备面试|正在面试|面试中)|"
    r"(?:找工作|找.{0,20}工作|求职|投简历|准备面试))"
)
ANSWER_STYLE_RE = re.compile(r"(简洁|详细|通俗|专业|正式|口语|直接|别啰嗦|多举例|少废话)")

SINGLE_VALUE_KEYS = {
    "identity.name",
    "profile.age",
    "lifestyle.sleep_schedule",
    "career.current_status",
    "career.current_goal",
    "communication.answer_style",
}

AUTO_ACTIVE_KEYS = {
    "identity.name",
    "profile.age",
    "lifestyle.sleep_schedule",
    "career.current_status",
    "interest.general",
    "communication.answer_style",
}

CANONICAL_KEY_ALIASES = {
    "identity.nickname": "identity.name",
    "identity.username": "identity.name",
    "identity.user_name": "identity.name",
    "profile.name": "identity.name",
    "personal_info.name": "identity.name",
    "personal_info.age": "profile.age",
    "profile.current_age": "profile.age",
    "profile.user_age": "profile.age",
    "age.general": "profile.age",
    "lifestyle.sleep": "lifestyle.sleep_schedule",
    "lifestyle.sleep_habit": "lifestyle.sleep_schedule",
    "lifestyle.sleep_pattern": "lifestyle.sleep_schedule",
    "lifestyle.sleep_routine": "lifestyle.sleep_schedule",
    "lifestyle.routine": "lifestyle.sleep_schedule",
    "lifestyle.daily_routine": "lifestyle.sleep_schedule",
    "personal_info.sleep_schedule": "lifestyle.sleep_schedule",
    "personal_info.sleep_habit": "lifestyle.sleep_schedule",
    "personal_info.routine": "lifestyle.sleep_schedule",
    "profile.sleep_schedule": "lifestyle.sleep_schedule",
    "profile.routine": "lifestyle.sleep_schedule",
    "sleep.schedule": "lifestyle.sleep_schedule",
    "sleep.sleep_schedule": "lifestyle.sleep_schedule",
    "sleep.routine": "lifestyle.sleep_schedule",
    "career.status": "career.current_status",
    "career.job_status": "career.current_status",
    "career.current_phase": "career.current_status",
    "job.current_status": "career.current_status",
    "goal.current_status": "career.current_status",
    "career.goal": "career.current_goal",
    "career.target": "career.current_goal",
    "goal.career": "career.current_goal",
    "career.interview": "career.interview_history",
    "career.interviews": "career.interview_history",
    "career.interview_result": "career.interview_history",
    "career.interview_experience": "career.interview_history",
    "job.interview_history": "career.interview_history",
    "interview.history": "career.interview_history",
    "episode.interview_history": "career.interview_history",
    "learning.focus": "learning.current_focus",
    "learning.topic": "learning.current_focus",
    "learning.current_topic": "learning.current_focus",
    "learning.subject": "learning.current_focus",
    "communication.style": "communication.answer_style",
    "communication.response_style": "communication.answer_style",
    "writing_style.general": "communication.answer_style",
    "preference.answer_style": "communication.answer_style",
}


@dataclass
class MemoryCandidate:
    memory_type: str
    content: str
    importance: int
    confidence: float
    should_save: bool
    source: str
    scope: str
    tags: list[str]
    canonical_key: str = ""
    value: str = ""
    layer: str = "semantic"
    stability: str = "medium"
    subject: str = "user"
    temporal_scope: str = "durable"
    operation: str = "upsert"
    reason: str = ""


def normalize_memory_type(value: str | None) -> str:
    memory_type = (value or "").strip()
    return memory_type if memory_type in MEMORY_TYPES else "preference"


def normalize_scope(value: str | None) -> str:
    scope = (value or "").strip()
    return scope if scope in MEMORY_SCOPES else "global"


def normalize_canonical_key(value: object, memory_type: str | None = None) -> str:
    key = str(value or "").strip().lower()
    key = re.sub(r"[^a-z0-9_.:-]+", "_", key)
    key = re.sub(r"_+", "_", key).strip("_.:-")
    normalized_type = normalize_memory_type(memory_type)
    if not key:
        key = f"{normalized_type}.general"
    if "." not in key:
        key = f"{normalized_type}.{key}"
    key = CANONICAL_KEY_ALIASES.get(key, key)
    return key[:80]


def normalize_memory_layer(value: str | None, memory_type: str | None = None) -> str:
    layer = (value or "").strip()
    if layer in MEMORY_LAYERS:
        return layer
    if memory_type == "episode":
        return "episodic"
    return "semantic"


def memory_layer_tags(layer: str, tags: list[str] | None = None) -> list[str]:
    normalized_layer = normalize_memory_layer(layer)
    cleaned = [tag for tag in (tags or []) if isinstance(tag, str) and tag and not tag.startswith("layer:")]
    return [f"layer:{normalized_layer}", *cleaned][:12]


def clamp_importance(value: int | None) -> int:
    if value is None:
        return 3
    return max(1, min(5, int(value)))


def _clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip(" ，。,.!！?？\n\t"))


def _strip_chat_suffix(value: str) -> str:
    text = _clean_text(value)
    text = re.sub(r"(你知道吗|知道吗|你知道不|你晓得吗|对吧|是不是|啊|呀|呢)$", "", text)
    return _clean_text(text)


def _semantic_tags(tags: list[str], canonical_key: str = "", value: str = "") -> list[str]:
    result = [tag for tag in tags if tag and not tag.startswith("layer:")]
    normalized_key = normalize_canonical_key(canonical_key) if canonical_key else ""
    if normalized_key and f"key:{normalized_key}" not in result:
        result.append(f"key:{normalized_key}")
    if value and f"value:{value}" not in result:
        result.append(f"value:{value}"[:120])
    return memory_layer_tags("semantic", result)


def episodic_tags(event_type: str, tags: list[str] | None = None, value: str = "") -> list[str]:
    result = [f"event:{event_type}"]
    for tag in tags or []:
        if tag and not tag.startswith("layer:") and tag not in result:
            result.append(tag)
    if value:
        result.append(f"value:{value}"[:120])
    return memory_layer_tags("episodic", result)


def memory_layer(memory: UserMemory) -> str:
    for tag in memory.tags or []:
        if isinstance(tag, str) and tag.startswith("layer:"):
            return normalize_memory_layer(tag[6:], memory.memory_type)
    return normalize_memory_layer(None, memory.memory_type)


def memory_canonical_key(memory: UserMemory) -> str:
    for tag in memory.tags or []:
        if isinstance(tag, str) and tag.startswith("key:"):
            return normalize_canonical_key(tag[4:], memory.memory_type)
    legacy = {
        "episode": "episode.general",
        "identity": "identity.name",
        "personal_info": "profile.info",
        "interest": "interest.general",
        "goal": "career.current_goal",
        "writing_style": "communication.answer_style",
        "constraint": "communication.constraint",
    }
    return normalize_canonical_key(legacy.get(memory.memory_type, ""), memory.memory_type)


def memory_value(memory: UserMemory) -> str:
    for tag in memory.tags or []:
        if isinstance(tag, str) and tag.startswith("value:"):
            return tag[6:]
    return _clean_text(memory.content)


def is_single_value_key(canonical_key: str) -> bool:
    return normalize_canonical_key(canonical_key) in SINGLE_VALUE_KEYS


def is_episodic_memory(memory: UserMemory) -> bool:
    return memory_layer(memory) == "episodic"


def memory_candidate_status(candidate: MemoryCandidate) -> str:
    policy = classify_memory_content(candidate.content or candidate.value)
    if not policy.allowed:
        candidate.reason = policy.reason
        return "rejected"
    if not candidate.value and not candidate.content:
        return "rejected"
    if candidate.operation == "reject" or not candidate.should_save:
        return "rejected"
    if candidate.subject not in {"", "user"}:
        return "rejected"
    if candidate.temporal_scope == "temporary":
        return "rejected"
    if normalize_memory_layer(candidate.layer, candidate.memory_type) not in PERSISTED_MEMORY_LAYERS:
        return "rejected"
    if candidate.confidence < 0.62:
        return "rejected"
    if candidate.operation == "candidate":
        return "pending"
    if candidate.source == "user_explicit" and candidate.confidence >= 0.76:
        return "active"
    if candidate.canonical_key in AUTO_ACTIVE_KEYS and candidate.confidence >= 0.84 and candidate.should_save:
        return "active"
    if candidate.memory_type in {"personal_info", "interest", "goal"} and candidate.confidence >= 0.86 and candidate.should_save:
        return "active"
    if candidate.confidence >= 0.72:
        return "pending"
    return "rejected"


def candidate_review_tags(candidate: MemoryCandidate) -> list[str]:
    tags = [tag for tag in (candidate.tags or []) if tag != "candidate:needs_review"]
    return memory_layer_tags(
        normalize_memory_layer(candidate.layer, candidate.memory_type),
        ["candidate:needs_review", *tags],
    )


def _candidate(
    *,
    memory_type: str,
    content: str,
    importance: int,
    confidence: float,
    source: str,
    scope: str,
    tags: list[str],
    canonical_key: str,
    value: str,
    should_save: bool = True,
) -> MemoryCandidate:
    canonical_key = normalize_canonical_key(canonical_key, memory_type)
    return MemoryCandidate(
        memory_type=memory_type,
        content=content[:1000],
        importance=importance,
        confidence=confidence,
        should_save=should_save,
        source=source,
        scope=scope,
        tags=_semantic_tags(tags, canonical_key, value),
        canonical_key=canonical_key,
        value=value,
    )


def _dedupe_candidates(candidates: list[MemoryCandidate]) -> list[MemoryCandidate]:
    seen: set[tuple[str, str, str]] = set()
    result: list[MemoryCandidate] = []
    for candidate in candidates:
        key = (candidate.memory_type, candidate.canonical_key, candidate.value or candidate.content)
        if key in seen:
            continue
        seen.add(key)
        result.append(candidate)
    return result


def classify_memory(text: str, context: str = "global") -> tuple[str, str, list[str]]:
    normalized = _clean_text(text)
    tags: list[str] = []
    scope = normalize_scope(context)

    if IDENTITY_NAME_RE.search(normalized) or re.search(r"(我的称呼|我的名字|怎么称呼我)", normalized):
        return "identity", "global", ["身份", "称呼"]

    if JOB_GOAL_RE.search(normalized):
        return "goal", "job_search", ["目标", "求职"]

    if PERSONAL_INFO_RE.search(normalized) or AGE_STATEMENT_RE.search(normalized):
        return "personal_info", "global", ["个人信息"]

    if INTEREST_RE.search(normalized):
        return "interest", "global", ["兴趣"]

    if re.search(r"(不要|别|不想|不希望|禁止|不能|不准|少给|测验|练习题|题目)", normalized):
        tags.append("限制")
        if "测验" in normalized or "练习题" in normalized or "题目" in normalized:
            tags.append("练习题")
        return "constraint", scope, tags

    if re.search(r"(通俗|官方|正式|口吻|风格|表达|写作|结构|例子|案例|大纲|标题)", normalized):
        tags.extend(["写作风格", "笔记"])
        return "writing_style", "note_generation" if scope == "global" else scope, tags

    if re.search(r"(目标|准备|面试|学习|近期|现在主要|刷题|求职|找工作)", normalized):
        tags.append("目标")
        if "面试" in normalized:
            tags.append("面试")
        return "goal", "learning" if scope == "global" else scope, tags

    if re.search(r"(项目|NoteFlow|系统|产品|工程|架构)", normalized, re.I):
        tags.append("项目")
        return "project", scope, tags

    if re.search(r"(Java|Spring|Redis|MySQL|Python|React|Agent|后端|前端)", normalized, re.I):
        tags.append("技能")
        return "skill", "learning" if scope == "global" else scope, tags

    if re.search(r"(流程|工作流|先.*大纲|分节|确认|预览|保存)", normalized):
        tags.append("工作流")
        return "workflow", scope, tags

    return "preference", scope, ["偏好"]


def extract_memory_candidates(text: str, context: str = "global") -> list[MemoryCandidate]:
    normalized = _clean_text(text)
    if not normalized:
        return []
    if IDENTITY_QUESTION_RE.search(normalized) or PERSONAL_INFO_QUESTION_RE.search(normalized):
        return []
    if THIRD_PARTY_RE.search(normalized):
        return []

    explicit = bool(EXPLICIT_MEMORY_RE.search(normalized))
    temporary = bool(TEMPORARY_RE.search(normalized)) and not explicit
    if temporary:
        return []

    candidates: list[MemoryCandidate] = []
    scope = normalize_scope(context)
    identity_name = ""
    identity_match = IDENTITY_NAME_RE.search(normalized)
    if identity_match:
        identity_name = _clean_text(identity_match.group(1))
        if re.search(r"(啥|什么|吗|么)", identity_name):
            return []
        candidates.append(
            _candidate(
                memory_type="identity",
                content=f"用户称呼：{identity_name}",
                importance=5 if explicit else 4,
                confidence=0.96 if explicit else 0.9,
                source="user_explicit",
                scope="global",
                tags=["身份", "称呼"],
                canonical_key="identity.name",
                value=identity_name,
            )
        )

    age_match = AGE_VALUE_RE.search(normalized) if AGE_STATEMENT_RE.search(normalized) else None
    if age_match:
        age = age_match.group(1)
        today = datetime.utcnow().date().isoformat()
        candidates.append(
            _candidate(
                memory_type="personal_info",
                content=f"用户年龄：用户在 {today} 表示自己 {age} 岁",
                importance=4,
                confidence=0.9,
                source="user_explicit",
                scope="global",
                tags=["个人信息", "年龄"],
                canonical_key="profile.age",
                value=age,
            )
        )

    if JOB_GOAL_RE.search(normalized):
        value = "求职中"
        if re.search(r"(后端|前端|Python|Java|Go|测试|产品|运营)", normalized, re.I):
            value = _strip_chat_suffix(normalized)
        candidates.append(
            _candidate(
                memory_type="goal",
                content=f"用户职业状态或目标：{_strip_chat_suffix(normalized)}",
                importance=4,
                confidence=0.86,
                source="user_explicit",
                scope="job_search",
                tags=["目标", "求职"],
                canonical_key="career.current_status",
                value=value,
            )
        )

    interest_match = INTEREST_VALUE_RE.search(normalized)
    if interest_match:
        value = _strip_chat_suffix(interest_match.group(1))
        if value and not re.search(r"(吗|么|啥|什么|不)", value):
            candidates.append(
                _candidate(
                    memory_type="interest",
                    content=f"用户兴趣爱好：喜欢{value}",
                    importance=4,
                    confidence=0.86,
                    source="user_explicit",
                    scope="global",
                    tags=["兴趣"],
                    canonical_key="interest.general",
                    value=value,
                )
            )

    if explicit and ANSWER_STYLE_RE.search(normalized):
        style = "、".join(sorted(set(ANSWER_STYLE_RE.findall(normalized))))
        candidates.append(
            _candidate(
                memory_type="writing_style",
                content=f"用户回答风格偏好：{_strip_chat_suffix(normalized)}",
                importance=5,
                confidence=0.92,
                source="user_explicit",
                scope="global",
                tags=["写作风格", "表达偏好"],
                canonical_key="communication.answer_style",
                value=style,
            )
        )

    if candidates:
        return _dedupe_candidates(candidates)

    memory_type, scope, tags = classify_memory(normalized, context)
    if not explicit and memory_type == "preference":
        return []

    content = _strip_chat_suffix(normalized)
    content = re.sub(r"^(请|麻烦|帮我)?\s*(记住|你要记得)[，,:：\s]*", "", content)
    content = re.sub(r"^(以后|以后都|今后|从现在开始|默认)[，,:：\s]*", "", content)
    content = _strip_chat_suffix(content)
    if not content:
        return []

    if memory_type == "personal_info":
        memory_content = f"用户个人信息：{content}"
    elif memory_type == "interest":
        memory_content = f"用户兴趣爱好：{content}"
    elif memory_type == "constraint":
        memory_content = f"用户长期限制：{content}"
    elif memory_type == "writing_style":
        memory_content = f"用户写作偏好：{content}"
    elif memory_type == "goal":
        memory_content = f"用户长期目标：{content}"
    else:
        memory_content = f"用户长期偏好：{content}"

    first_person = bool(re.search(r"(^我|我的|本人|自己)", normalized))

    return [
        _candidate(
            memory_type=memory_type,
            content=memory_content[:1000],
            importance=5 if explicit else 4,
            confidence=0.96 if explicit else 0.86 if memory_type in {"identity", "personal_info", "interest"} else 0.78,
            should_save=explicit
            or memory_type in {"identity", "personal_info", "interest", "constraint", "goal", "writing_style"}
            or (first_person and memory_type in {"workflow", "skill"}),
            source="user_explicit" if explicit else "ai_inferred",
            scope=scope,
            tags=tags,
            canonical_key=f"{memory_type}.general",
            value=content,
        )
    ]


def add_memory_event(
    session: AsyncSession,
    *,
    memory: UserMemory | None,
    user_id: str,
    event_type: str,
    old_content: str | None = None,
    new_content: str | None = None,
    reason: str | None = None,
) -> UserMemoryEvent:
    event = UserMemoryEvent(
        id=random_id(),
        memory_id=memory.id if memory is not None else None,
        user_id=user_id,
        event_type=event_type,
        old_content=old_content,
        new_content=new_content,
        reason=reason,
    )
    session.add(event)
    return event


def _query_terms(value: str) -> list[str]:
    terms = re.findall(r"[\w一-鿿]{2,}", value)
    return [term.lower() for term in terms[:12]]


def score_memory(memory: UserMemory, query: str) -> int:
    score = clamp_importance(memory.importance) * 10
    canonical_key = memory_canonical_key(memory)
    text = f"{memory.memory_type} {memory.scope} {canonical_key} {memory.content} {' '.join(memory.tags or [])}".lower()
    for term in _query_terms(query):
        if term in text:
            score += 12
    if memory.scope == "global":
        score += 2
    return score


async def find_memories(
    session: AsyncSession,
    user_id: str,
    *,
    query: str = "",
    memory_types: Iterable[str] | None = None,
    canonical_keys: Iterable[str] | None = None,
    layers: Iterable[str] | None = None,
    scopes: Iterable[str] | None = None,
    include_deleted: bool = False,
    limit: int = 20,
) -> list[UserMemory]:
    conditions = [UserMemory.user_id == user_id]
    if not include_deleted:
        conditions.append(UserMemory.status != "deleted")
        conditions.append(UserMemory.deleted_at.is_(None))

    normalized_types = [normalize_memory_type(item) for item in (memory_types or []) if item]
    if normalized_types:
        conditions.append(UserMemory.memory_type.in_(normalized_types))

    normalized_scopes = [normalize_scope(item) for item in (scopes or []) if item]
    if normalized_scopes:
        conditions.append(or_(UserMemory.scope.in_(normalized_scopes), UserMemory.scope == "global"))

    result = await session.execute(select(UserMemory).where(and_(*conditions)))
    memories = list(result.scalars().all())

    normalized_layers = [
        normalize_memory_layer(item)
        for item in (layers or [])
        if str(item or "").strip() in PERSISTED_MEMORY_LAYERS
    ]
    if normalized_layers:
        memories = [memory for memory in memories if memory_layer(memory) in normalized_layers]

    normalized_keys = [str(item).strip().lower() for item in (canonical_keys or []) if str(item).strip()]
    normalized_keys = [normalize_canonical_key(item) for item in normalized_keys]
    if normalized_keys:
        def key_rank(memory: UserMemory) -> int:
            key = memory_canonical_key(memory).lower()
            if key in normalized_keys:
                return 0
            if any(key.startswith(prefix + ".") or prefix.startswith(key + ".") for prefix in normalized_keys):
                return 1
            return 2

        memories.sort(key=lambda memory: (key_rank(memory), -score_memory(memory, query), memory.created_at))
    else:
        memories.sort(key=lambda memory: (-score_memory(memory, query), memory.created_at), reverse=False)
    return memories[: max(1, min(limit, 50))]


async def mark_memories_used(
    session: AsyncSession,
    user_id: str,
    memories: Iterable[UserMemory],
    reason: str = "search_memory",
):
    now = datetime.utcnow()
    for memory in memories:
        memory.last_used_at = now
        memory.access_count = (memory.access_count or 0) + 1
        add_memory_event(
            session,
            memory=memory,
            user_id=user_id,
            event_type="used",
            new_content=memory.content,
            reason=reason,
        )


async def build_memory_context(
    session: AsyncSession,
    user_id: str,
    *,
    query: str = "",
    scopes: Iterable[str] | None = None,
    memory_types: Iterable[str] | None = None,
    limit: int = 6,
) -> str:
    memories = await find_memories(
        session,
        user_id,
        query=query,
        memory_types=memory_types,
        scopes=scopes,
        limit=limit,
    )
    active = [memory for memory in memories if memory.status == "active"]
    active = filter_eligible_memories(active, limit=limit)
    if not active:
        return ""
    lines = [
        "长期记忆（只作为默认偏好；用户当前明确要求优先级最高）：",
    ]
    for index, memory in enumerate(active, start=1):
        lines.append(
            f"{index}. [{memory.memory_type}/{memory.scope}/重要度{memory.importance}] {memory.content}"
        )
    return "\n".join(lines)
