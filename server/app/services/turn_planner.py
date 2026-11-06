from __future__ import annotations

import json
import logging
import re
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.services.prompt_templates import render_prompt
from app.services.ai import ChatMessage, complete_chat

logger = logging.getLogger(__name__)


class ChatMode(str, Enum):
    CHAT = "chat"
    ASK_NOTES = "ask_notes"


class PrimaryIntent(str, Enum):
    GENERAL_CHAT = "general_chat"
    NOTE_CREATE = "note_create"
    NOTE_EDIT = "note_edit"
    MEMORY = "memory"
    UNKNOWN = "unknown"


class ContextSource(str, Enum):
    CURRENT_NOTE = "current_note"
    SELECTED_TEXT = "selected_text"
    KNOWLEDGE_BASE = "knowledge_base"
    USER_MEMORY = "user_memory"


class PlanResult(str, Enum):
    EXECUTE = "execute"
    CLARIFY = "clarify"
    UNKNOWN = "unknown"


MemoryAction = Literal["none", "read", "list", "write", "update", "delete", "disable"]
MemoryLayer = Literal["semantic", "episodic"]
MemoryScope = Literal[
    "global",
    "note_generation",
    "note_editing",
    "note_search",
    "job_search",
    "learning",
]
MemoryType = Literal[
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


class PlannerFailure(RuntimeError):
    """The model planner was unavailable or could not satisfy its contract."""


class IntentParameters(BaseModel):
    """Strongly typed parameters produced once and consumed by executors."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    topic: str | None = Field(default=None, max_length=160)
    requirements: str = Field(default="", max_length=2000)
    note_id: str | None = Field(default=None, max_length=64)
    instruction: str = Field(default="", max_length=600)
    memory_action: MemoryAction = "none"
    memory_scope: MemoryScope | None = None
    memory_layers: list[MemoryLayer] = Field(default_factory=list, max_length=2)
    memory_types: list[MemoryType] = Field(default_factory=list, max_length=8)
    memory_key: str | None = Field(default=None, max_length=120)
    memory_query: str = Field(default="", max_length=300)


class PlannerOutput(BaseModel):
    """Exact JSON contract requested from the model."""

    model_config = ConfigDict(extra="forbid")

    primary_intent: PrimaryIntent
    intent_parameters: IntentParameters = Field(default_factory=IntentParameters)
    context_sources: list[ContextSource] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)
    reason: str = Field(default="", max_length=400)


class TurnPlan(BaseModel):
    """Validated plan stored in LangGraph AgentState."""

    model_config = ConfigDict(extra="forbid")

    mode: ChatMode = ChatMode.CHAT
    primary_intent: PrimaryIntent = PrimaryIntent.GENERAL_CHAT
    intent_parameters: IntentParameters = Field(default_factory=IntentParameters)
    context_sources: list[ContextSource] = Field(default_factory=list)
    missing_fields: list[str] = Field(default_factory=list)
    result: PlanResult = PlanResult.EXECUTE
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    reason: str = Field(default="", max_length=400)
    source: Literal["llm", "ui_mode", "resume", "repaired"] = "llm"


def _clean(value: object, limit: int = 500) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())[:limit]


def _json_from_text(text: str) -> dict[str, Any]:
    raw = (text or "").strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.S)
        if not match:
            raise ValueError("Planner did not return a JSON object")
        value = json.loads(match.group(0))
    if not isinstance(value, dict):
        raise ValueError("Planner JSON must be an object")
    return value


def _mode(value: object) -> ChatMode:
    return ChatMode.ASK_NOTES if str(value or "") == ChatMode.ASK_NOTES.value else ChatMode.CHAT


def _dedupe(values: list[Any]) -> list[Any]:
    result: list[Any] = []
    for value in values:
        if value not in result:
            result.append(value)
    return result


def _normalize_planner_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Adapt structured provider aliases without inspecting the user message."""

    intent_aliases = {
        "chat": "general_chat",
        "smalltalk": "general_chat",
        "create_note": "note_create",
        "generate_note": "note_create",
        "edit_note": "note_edit",
        "memory_manage": "memory",
        "memory_read": "memory",
    }
    source_aliases = {
        "note": "current_note",
        "document": "current_note",
        "current_document": "current_note",
        "selection": "selected_text",
        "selected": "selected_text",
        "knowledge": "knowledge_base",
        "notes": "knowledge_base",
        "memory": "user_memory",
        "memories": "user_memory",
    }
    action_aliases = {
        "": "none",
        "retrieve": "read",
        "get": "read",
        "query": "read",
        "search": "read",
        "show": "list",
        "save": "write",
        "store": "write",
        "add": "write",
        "modify": "update",
        "remove": "delete",
        "forget": "delete",
        "off": "disable",
    }
    scope_aliases = {
        "personal": "global",
        "profile": "global",
        "user": "global",
        "conversation": "global",
        "chat": "global",
        "task": "global",
    }
    layer_aliases = {
        "personal": "semantic",
        "profile": "semantic",
        "user": "semantic",
        "history": "episodic",
    }
    key_aliases = {
        "name": "identity.name",
        "identity": "identity.name",
        "age": "profile.age",
        "height": "profile.height",
        "sleep": "lifestyle.sleep_schedule",
        "career": "career.current_status",
        "interest": "interest.general",
    }

    normalized = dict(payload)
    raw_intent = str(normalized.get("primary_intent") or "").strip().lower()
    normalized["primary_intent"] = intent_aliases.get(raw_intent, raw_intent)

    raw_sources = normalized.get("context_sources")
    if raw_sources is None:
        raw_sources = []
    if not isinstance(raw_sources, list):
        raise ValueError("context_sources must be an array")
    normalized["context_sources"] = _dedupe(
        [
            source_aliases.get(str(item).strip().lower(), str(item).strip().lower())
            for item in raw_sources
        ]
    )

    raw_parameters = normalized.get("intent_parameters")
    if raw_parameters is None:
        raw_parameters = {}
    if not isinstance(raw_parameters, dict):
        raise ValueError("intent_parameters must be an object")
    allowed = set(IntentParameters.model_fields)
    parameters = {key: item for key, item in raw_parameters.items() if key in allowed}

    action = str(parameters.get("memory_action") or "none").strip().lower()
    parameters["memory_action"] = action_aliases.get(action, action)

    legacy_scope = str(parameters.get("memory_scope") or "").strip().lower()
    raw_layers = parameters.get("memory_layers")
    if raw_layers is None:
        raw_layers = []
    if not isinstance(raw_layers, list):
        raw_layers = [raw_layers]
    layers = [
        layer_aliases.get(str(item).strip().lower(), str(item).strip().lower())
        for item in raw_layers
        if str(item or "").strip()
    ]
    if legacy_scope in {"semantic", "episodic", "history", "personal", "profile", "user"}:
        layer = layer_aliases.get(legacy_scope, legacy_scope)
        if layer not in layers:
            layers.append(layer)
        legacy_scope = "global"
    elif legacy_scope in {"conversation", "chat", "task"}:
        if "episodic" not in layers:
            layers.append("episodic")
    parameters["memory_scope"] = scope_aliases.get(legacy_scope, legacy_scope) or None
    parameters["memory_layers"] = _dedupe(layers)

    raw_types = parameters.get("memory_types")
    if raw_types is None:
        raw_types = []
    if not isinstance(raw_types, list):
        raw_types = [raw_types]
    parameters["memory_types"] = _dedupe(
        [str(item).strip().lower() for item in raw_types if str(item or "").strip()]
    )

    memory_key = str(parameters.get("memory_key") or "").strip()
    parameters["memory_key"] = key_aliases.get(memory_key.lower(), memory_key or None)
    parameters["requirements"] = str(parameters.get("requirements") or "")
    parameters["instruction"] = str(parameters.get("instruction") or "")
    parameters["memory_query"] = str(parameters.get("memory_query") or "")
    parameters["topic"] = parameters.get("topic") or None
    parameters["note_id"] = parameters.get("note_id") or None
    normalized["intent_parameters"] = parameters
    normalized["reason"] = str(normalized.get("reason") or "")
    return normalized


def plan_from_llm_payload(
    payload: dict[str, Any],
    *,
    mode: str,
    source: Literal["llm", "resume", "repaired"] = "llm",
) -> TurnPlan:
    output = PlannerOutput.model_validate(_normalize_planner_payload(payload))
    return TurnPlan(
        mode=_mode(mode),
        primary_intent=output.primary_intent,
        intent_parameters=output.intent_parameters,
        context_sources=output.context_sources,
        confidence=output.confidence,
        reason=output.reason,
        source=source,
    )


def _normalize_topic_field(value: object) -> str | None:
    """Normalize presentation only; semantic intent remains model-owned."""

    topic = _clean(value, 160)
    # Remove only a complete outer quotation. strip(chars) corrupts work
    # names inside titles such as 《两小儿辩日》教案 or 比较《甲》和《乙》.
    for opening, closing in (("“", "”"), ('"', '"'), ("'", "'")):
        if topic.startswith(opening) and topic.endswith(closing) and len(topic) > 1:
            topic = topic[1:-1].strip()
            break
    if len(topic) > 1 and topic.endswith("的"):
        topic = topic[:-1].rstrip()
    if topic.replace(" ", "").casefold() in {"go语言", "golang"}:
        return "Go 语言"
    return topic or None


def validate_turn_plan(
    plan: TurnPlan,
    *,
    page_state: dict[str, Any] | None = None,
) -> TurnPlan:
    state = page_state or {}
    validated = plan.model_copy(deep=True)
    validated.context_sources = _dedupe(validated.context_sources)
    missing: list[str] = []

    if validated.mode == ChatMode.ASK_NOTES:
        validated.context_sources = [ContextSource.KNOWLEDGE_BASE]
        validated.primary_intent = PrimaryIntent.GENERAL_CHAT
    else:
        validated.context_sources = [
            source
            for source in validated.context_sources
            if source != ContextSource.KNOWLEDGE_BASE
        ]

    parameters = validated.intent_parameters
    if validated.primary_intent == PrimaryIntent.NOTE_CREATE:
        parameters.topic = _normalize_topic_field(parameters.topic)
        if not parameters.topic:
            missing.append("topic")
    elif validated.primary_intent == PrimaryIntent.NOTE_EDIT:
        note_id = parameters.note_id or state.get("currentNoteId")
        parameters.note_id = str(note_id) if note_id else None
        if not note_id:
            missing.append("target_note")
        if not _clean(parameters.instruction, 600):
            missing.append("instruction")
    elif validated.primary_intent == PrimaryIntent.MEMORY:
        if parameters.memory_action == "none":
            missing.append("memory_action")
        if parameters.memory_scope is None:
            parameters.memory_scope = "global"
        if (
            parameters.memory_action in {"read", "list", "delete"}
            and ContextSource.USER_MEMORY not in validated.context_sources
        ):
            validated.context_sources.append(ContextSource.USER_MEMORY)

    if ContextSource.USER_MEMORY in validated.context_sources:
        if parameters.memory_action == "none":
            parameters.memory_action = "read"
        if parameters.memory_scope is None:
            parameters.memory_scope = "global"

    if (
        ContextSource.SELECTED_TEXT in validated.context_sources
        and not str(state.get("selectedText") or "").strip()
    ):
        validated.context_sources.remove(ContextSource.SELECTED_TEXT)
        if validated.primary_intent == PrimaryIntent.NOTE_EDIT and not state.get("currentNoteId"):
            missing.append("target_note")
    if ContextSource.CURRENT_NOTE in validated.context_sources and not state.get("currentNoteId"):
        validated.context_sources.remove(ContextSource.CURRENT_NOTE)
        if validated.primary_intent == PrimaryIntent.NOTE_EDIT:
            missing.append("target_note")

    validated.missing_fields = list(dict.fromkeys(missing))
    if validated.primary_intent == PrimaryIntent.UNKNOWN:
        validated.result = PlanResult.UNKNOWN
    elif validated.missing_fields:
        validated.result = PlanResult.CLARIFY
    else:
        validated.result = PlanResult.EXECUTE
    return validated


def clarification_question(plan: TurnPlan) -> str:
    if "topic" in plan.missing_fields:
        return "你想生成什么主题的笔记？"
    if "target_note" in plan.missing_fields:
        return "你想修改哪篇笔记？请先打开目标笔记后再告诉我修改要求。"
    if "instruction" in plan.missing_fields:
        return "你希望怎样修改这篇笔记？"
    if "memory_action" in plan.missing_fields:
        return "你希望我读取、保存、修改还是删除哪项个人信息？"
    return "还缺少一些必要信息，可以再具体说明一下吗？"


def fill_clarification(plan: TurnPlan, answer: str) -> TurnPlan:
    """Deterministic state merge used only by injected/offline graph tests."""

    updated = plan.model_copy(deep=True)
    value = _clean(answer, 600)
    if "topic" in updated.missing_fields:
        updated.intent_parameters.topic = value or None
    elif "instruction" in updated.missing_fields:
        updated.intent_parameters.instruction = value
    elif "target_note" in updated.missing_fields:
        updated.intent_parameters.requirements = value
    updated.source = "resume"
    return updated


def _history_text(history: list[ChatMessage] | None) -> str:
    if not history:
        return "无"
    lines = [
        f"{'用户' if item.role == 'user' else '助手'}：{_clean(item.text, 360)}"
        for item in history[-8:]
        if _clean(item.text, 360)
    ]
    return "\n".join(lines)[-2200:] or "无"


def _planner_schema_text() -> str:
    return json.dumps(PlannerOutput.model_json_schema(), ensure_ascii=False)


def _planner_messages(
    *,
    question: str,
    mode: str,
    history: list[ChatMessage] | None,
    page_state: dict[str, Any] | None,
) -> list[dict[str, str]]:
    state = page_state or {}
    system = render_prompt("planner/plan-system", schema=_planner_schema_text()).strip()
    user = (
        render_prompt(
            "planner/plan-input",
            mode=_mode(mode).value,
            note_id=state.get('currentNoteId') or '无',
            selection=_clean(state.get('selectedText'), 320) or '无',
            history=_history_text(history),
            question=question.strip(),
        )
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _repair_messages(
    *,
    messages: list[dict[str, str]],
    invalid_output: str,
    error: Exception,
) -> list[dict[str, str]]:
    return [
        *messages,
        {"role": "assistant", "content": invalid_output[:5000]},
        {
            "role": "user",
            "content": (
                render_prompt("planner/repair", error_type=type(error).__name__)
            ),
        },
    ]


def _validated_model_plan(
    content: str,
    *,
    mode: str,
    source: Literal["llm", "resume", "repaired"],
    page_state: dict[str, Any] | None,
) -> TurnPlan:
    plan = plan_from_llm_payload(_json_from_text(content), mode=mode, source=source)
    if plan.primary_intent != PrimaryIntent.UNKNOWN and plan.confidence < 0.55:
        raise ValueError("Planner confidence is below execution threshold")
    return validate_turn_plan(plan, page_state=page_state)


async def _request_validated_plan(
    messages: list[dict[str, str]],
    *,
    mode: str,
    source: Literal["llm", "resume"],
    page_state: dict[str, Any] | None,
) -> TurnPlan:
    try:
        content = await complete_chat(
            messages,
            max_tokens=1400,
            temperature=0.0,
            response_format={"type": "json_object"},
        )
    except Exception as exc:
        logger.warning("TurnPlanner provider failed: %s", type(exc).__name__)
        raise PlannerFailure("规划服务暂时不可用，请稍后重试。") from exc

    contract_error: Exception | None = None
    try:
        return _validated_model_plan(
            content,
            mode=mode,
            source=source,
            page_state=page_state,
        )
    except Exception as exc:
        contract_error = exc
        logger.info("TurnPlanner contract repair requested: %s", type(exc).__name__)

    try:
        repaired = await complete_chat(
            _repair_messages(
                messages=messages,
                invalid_output=content,
                error=contract_error or ValueError("invalid planner output"),
            ),
            max_tokens=1400,
            temperature=0.0,
            response_format={"type": "json_object"},
        )
        return _validated_model_plan(
            repaired,
            mode=mode,
            source="repaired",
            page_state=page_state,
        )
    except Exception as exc:
        logger.warning("TurnPlanner contract repair failed: %s", type(exc).__name__)
        raise PlannerFailure("规划结果格式异常，系统已自动修复但仍未成功，请重试。") from exc


async def plan_turn_smart(
    *,
    question: str,
    mode: str,
    history: list[ChatMessage] | None = None,
    page_state: dict[str, Any] | None = None,
) -> TurnPlan:
    if _mode(mode) == ChatMode.ASK_NOTES:
        return validate_turn_plan(
            TurnPlan(
                mode=ChatMode.ASK_NOTES,
                primary_intent=PrimaryIntent.GENERAL_CHAT,
                context_sources=[ContextSource.KNOWLEDGE_BASE],
                confidence=1.0,
                reason="ui_mode:ask_notes",
                source="ui_mode",
            ),
            page_state=page_state,
        )
    return await _request_validated_plan(
        _planner_messages(
            question=question,
            mode=mode,
            history=history,
            page_state=page_state,
        ),
        mode=mode,
        source="llm",
        page_state=page_state,
    )


def _resume_planner_messages(
    *,
    original_question: str,
    answer: str,
    plan: TurnPlan,
    history: list[ChatMessage] | None,
    page_state: dict[str, Any] | None,
) -> list[dict[str, str]]:
    state = page_state or {}
    system = render_prompt("planner/resume-system", schema=_planner_schema_text()).strip()
    user = (
        render_prompt(
            "planner/resume-input",
            note_id=state.get('currentNoteId') or '无',
            selection=_clean(state.get('selectedText'), 320) or '无',
            history=_history_text(history),
            question=_clean(original_question, 600),
            plan=json.dumps(plan.model_dump(mode='json'), ensure_ascii=False),
            missing_fields=json.dumps(plan.missing_fields, ensure_ascii=False),
            answer=_clean(answer, 600),
        )
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


async def resume_turn_plan_smart(
    *,
    original_question: str,
    answer: str,
    plan: TurnPlan,
    history: list[ChatMessage] | None = None,
    page_state: dict[str, Any] | None = None,
) -> TurnPlan:
    merged = await _request_validated_plan(
        _resume_planner_messages(
            original_question=original_question,
            answer=answer,
            plan=plan,
            history=history,
            page_state=page_state,
        ),
        mode=plan.mode.value,
        source="resume",
        page_state=page_state,
    )
    if plan.primary_intent != PrimaryIntent.UNKNOWN:
        merged.primary_intent = plan.primary_intent
        merged = validate_turn_plan(merged, page_state=page_state)
    return merged
