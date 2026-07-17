from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.services.ai import ChatMessage, complete_chat

MAX_HISTORY_CHARS = 2200

INTENTS = {
    "general_chat",
    "note_draft_create",
    "note_draft_continue",
    "note_edit_create",
    "note_edit_revise",
    "note_context_qa",
    "note_search",
    "memory_manage",
    "history_recall",
    "resume_work",
    "confirm_action",
    "cancel_action",
    "clarify",
}

REPLY_SURFACES = {
    "chat_bubble",
    "draft_workspace",
    "editor_patch",
    "note_reference",
    "none",
}

MEMORY_ACTIONS = {"none", "read", "list", "write"}

TOOL_NAMES = {
    "ai_chat",
    "note_draft_tool",
    "note_edit_tool",
    "note_library_tool",
    "memory_tool",
    "agent_working_memory",
}

CONFIRM_ACTIONS = {
    "继续",
    "继续吧",
    "可以",
    "可以了",
    "确认",
    "确认吧",
    "应用",
    "应用吧",
    "保存",
    "保存吧",
    "就这样",
    "就用这个",
    "这样可以",
}

CANCEL_ACTIONS = {
    "取消",
    "取消吧",
    "取消修改",
    "取消预览",
    "算了",
    "不要改了",
    "不要写了",
    "先不改",
    "先不写",
    "放弃",
}

EDIT_PREVIEW_INTERRUPTION_INTENTS = {
    "memory_manage",
    "history_recall",
    "note_draft_create",
    "note_search",
    "note_context_qa",
    "resume_work",
}


@dataclass
class ContextPlan:
    primary_intent: str = "general_chat"
    confidence: float = 0.0
    reply_surface: str = "chat_bubble"
    memory_action: str = "none"
    context_plan: dict[str, Any] = field(default_factory=dict)
    tool_plan: list[dict[str, Any]] = field(default_factory=list)
    draft_request: dict[str, Any] = field(default_factory=dict)
    edit_request: dict[str, Any] = field(default_factory=dict)
    memory_read_request: dict[str, Any] = field(default_factory=dict)
    should_ask_clarification: bool = False
    clarification_question: str = ""
    reason: str = ""
    source: str = "fallback"

    def to_metadata(self) -> dict[str, Any]:
        return {
            "primaryIntent": self.primary_intent,
            "confidence": self.confidence,
            "replySurface": self.reply_surface,
            "memoryAction": self.memory_action,
            "contextPlan": self.context_plan,
            "toolPlan": self.tool_plan,
            "draftRequest": self.draft_request,
            "editRequest": self.edit_request,
            "memoryReadRequest": self.memory_read_request,
            "shouldAskClarification": self.should_ask_clarification,
            "clarificationQuestion": self.clarification_question,
            "reason": self.reason,
            "source": self.source,
        }


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


def _bool(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"true", "1", "yes", "y"}
    return bool(value)


def _dict(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _list_dicts(value: object, *, limit: int = 5) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    result: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        tool = _clean(item.get("tool"), 60)
        if tool and tool not in TOOL_NAMES:
            continue
        result.append(
            {
                "tool": tool,
                "action": _clean(item.get("action"), 80),
                "reason": _clean(item.get("reason"), 260),
            }
        )
        if len(result) >= limit:
            break
    return result


def _normalized_intent(value: object) -> str:
    intent = _clean(value, 60)
    return intent if intent in INTENTS else "general_chat"


def _normalized_surface(value: object, intent: str) -> str:
    surface = _clean(value, 60)
    if surface in REPLY_SURFACES:
        return surface
    if intent in {"note_draft_create", "note_draft_continue"}:
        return "draft_workspace"
    if intent in {"note_edit_create", "note_edit_revise"}:
        return "editor_patch"
    if intent in {"note_search", "note_context_qa"}:
        return "note_reference"
    return "chat_bubble"


def _normalized_memory_action(value: object, intent: str) -> str:
    action = _clean(value, 30)
    if action in MEMORY_ACTIONS:
        return action
    return "read" if intent == "memory_manage" else "none"


def _normalize_context_plan(value: object) -> dict[str, Any]:
    raw = _dict(value)
    return {
        "use_current_selection": _bool(raw.get("use_current_selection")),
        "use_current_note": _bool(raw.get("use_current_note")),
        "search_note_library": _bool(raw.get("search_note_library")),
        "read_user_memory": _bool(raw.get("read_user_memory")),
        "write_user_memory": _bool(raw.get("write_user_memory")),
        "continue_working_task": _bool(raw.get("continue_working_task")),
        "topic": _clean(raw.get("topic"), 160),
        "focus": _clean(raw.get("focus"), 260),
    }


def context_plan_from_llm_payload(payload: dict, question: str = "") -> ContextPlan:
    intent = _normalized_intent(payload.get("primary_intent"))
    confidence = _clamp_confidence(payload.get("confidence"))
    memory_action = _normalized_memory_action(payload.get("memory_action"), intent)
    context = _normalize_context_plan(payload.get("context_plan"))
    draft_request = _dict(payload.get("draft_request")).copy()
    if draft_request:
        draft_request["topic"] = _clean(draft_request.get("topic"), 160)
        draft_request["source_mode"] = _clean(draft_request.get("source_mode"), 60)
        draft_request["note_type"] = _clean(draft_request.get("note_type"), 80)
        draft_request["style"] = _clean(draft_request.get("style"), 120)
        draft_request["brief"] = _clean(draft_request.get("brief"), 2000)
    if intent == "note_draft_create" and not draft_request.get("topic"):
        draft_request["topic"] = _infer_draft_topic(question)

    edit_request = _dict(payload.get("edit_request")).copy()
    if edit_request:
        edit_request["target_type"] = _clean(edit_request.get("target_type"), 60)
        edit_request["instruction"] = _clean(edit_request.get("instruction"), 300)

    memory_read_request = _dict(payload.get("memory_read_request")).copy()
    if memory_read_request:
        memory_read_request["query"] = _clean(memory_read_request.get("query"), 300)

    plan = ContextPlan(
        primary_intent=intent,
        confidence=confidence,
        reply_surface=_normalized_surface(payload.get("reply_surface"), intent),
        memory_action=memory_action,
        context_plan=context,
        tool_plan=_list_dicts(payload.get("tool_plan")),
        draft_request=draft_request,
        edit_request=edit_request,
        memory_read_request=memory_read_request,
        should_ask_clarification=_bool(payload.get("should_ask_clarification")),
        clarification_question=_clean(payload.get("clarification_question"), 260),
        reason=_clean(payload.get("reason"), 400),
        source="llm",
    )
    return _validate_plan(plan)


def _validate_plan(plan: ContextPlan) -> ContextPlan:
    if plan.primary_intent == "note_draft_create":
        plan.reply_surface = "draft_workspace"
        if not any(item.get("tool") == "note_draft_tool" for item in plan.tool_plan):
            plan.tool_plan.insert(
                0,
                {
                    "tool": "note_draft_tool",
                    "action": "open_draft_workspace",
                    "reason": "创建 AI 笔记草稿",
                },
            )
    elif plan.primary_intent == "note_draft_continue":
        plan.reply_surface = "draft_workspace"
        plan.context_plan["continue_working_task"] = True
        if not any(item.get("tool") == "note_draft_tool" for item in plan.tool_plan):
            plan.tool_plan.insert(
                0,
                {
                    "tool": "note_draft_tool",
                    "action": "regenerate_outline",
                    "reason": "根据用户反馈重新生成草稿大纲",
                },
            )
    elif plan.primary_intent == "note_edit_create":
        plan.reply_surface = "editor_patch"
        plan.context_plan["use_current_note"] = True
    elif plan.primary_intent == "note_context_qa":
        plan.reply_surface = "note_reference"
        plan.context_plan["use_current_note"] = True
    elif plan.primary_intent == "note_search":
        plan.reply_surface = "note_reference"
        plan.context_plan["search_note_library"] = True
    elif plan.primary_intent == "memory_manage":
        plan.reply_surface = "chat_bubble"
        if plan.memory_action == "none":
            plan.memory_action = "read"
        plan.context_plan["read_user_memory"] = plan.memory_action in {"read", "list"}
        plan.context_plan["write_user_memory"] = plan.memory_action == "write"
    elif plan.primary_intent in {"confirm_action", "cancel_action"}:
        plan.reply_surface = "none"
    elif plan.primary_intent == "resume_work":
        plan.context_plan["continue_working_task"] = True
    return plan


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


def _state_summary(page_state: dict[str, Any] | None, checkpoint: dict[str, Any] | None) -> str:
    state = page_state or {}
    checkpoint_payload = (checkpoint or {}).get("payload") or {}
    working = (checkpoint or {}).get("workingMemory") or checkpoint_payload.get("workingMemory") or {}
    selected = _clean(state.get("selectedText"), 320)
    lines = [
        f"current_note_open: {bool(state.get('currentNoteId'))}",
        f"current_note_title: {_clean(state.get('documentTitle'), 120) or '无'}",
        f"selected_text: {selected or '无'}",
        f"center_mode: {_clean(state.get('centerMode'), 60) or 'unknown'}",
        f"active_draft_title: {_clean(state.get('activeDraftTitle'), 160) or '无'}",
        f"active_draft_topic: {_clean(state.get('activeDraftTopic'), 160) or '无'}",
        f"has_active_checkpoint: {bool(checkpoint)}",
        f"checkpoint_type: {_clean((checkpoint or {}).get('checkpointType'), 80) or '无'}",
        f"working_task: {_clean(working.get('title'), 220) or '无'}",
        f"working_status: {_clean(working.get('status'), 60) or '无'}",
    ]
    return "\n".join(lines)


def _build_messages(
    *,
    question: str,
    history: list[ChatMessage] | None,
    page_state: dict[str, Any] | None,
    checkpoint: dict[str, Any] | None,
) -> list[dict]:
    today = datetime.utcnow().date().isoformat()
    system = f"""
你是 NoteFlow 的 Context Planner。你只负责把用户当前输入转换成结构化执行计划，不回答用户问题。
当前日期：{today}

你要判断“用户真正要 NoteFlow 做什么”，并选择一个 primary_intent：
- general_chat：普通问答/聊天/解释常识，不直接创建或修改笔记。
- note_draft_create：创建一篇新的 AI 笔记草稿。用户说“写一篇/生成/整理一份/创建 xxx 笔记、教程、文档、学习资料”都属于这个意图。
- note_draft_continue：继续当前草稿工作区里的草稿任务。
- note_edit_create：修改当前正式笔记，必须输出修改预览，而不是直接回答。
- note_edit_revise：继续调整已有修改预览。
- note_context_qa：基于当前笔记或选中文本回答。只有用户明确把问题指向当前笔记/选中文本/这段内容时才用；仅仅打开笔记不算。
- note_search：搜索用户本地笔记库。用户问“我的笔记里有没有/文章里面有相关的吗/查一下笔记/搜索笔记”属于这个意图。
- memory_manage：用户在问你记不记得关于他的事，或明确要求保存个人信息。
- history_recall：用户问过去聊天或过去任务，例如“那天我们聊过什么/上次那个项目”。
- resume_work：继续上次任务。
- confirm_action / cancel_action：确认或取消当前等待操作。
- clarify：信息不足，必须先追问。

关键边界：
1. “帮我写一篇 SSE 笔记”必须是 note_draft_create，reply_surface=draft_workspace，tool_plan 使用 note_draft_tool/open_draft_workspace，draft_request.topic 应为“SSE”。
2. “SSE 是什么”通常是 general_chat，不要自动创建笔记。
3. “根据这篇笔记解释 SSE”才是 note_context_qa；如果 selected_text 存在，用户问“这段/它/什么意思”也可以用选中内容。
4. “我的笔记里有缓存雪崩相关内容吗”是 note_search，不是联网，也不是普通聊天。
5. “你还记得我作息/名字/金山面试吗”是 memory_manage，memory_action=read。
6. 用户自然分享“我作息很乱/我最近在找工作”通常 primary_intent=general_chat，同时 context_plan.write_user_memory=true；不要把它当成笔记问答。
7. 如果用户要“基于我的经历写一篇笔记”，可以 primary_intent=note_draft_create，同时 context_plan.read_user_memory=true。
8. 如果当前有 draft_workspace 任务，用户说“大纲不够详细/重新生成大纲/换个结构/章节太少/再详细一点”，必须是 note_draft_continue，tool_plan 使用 note_draft_tool/regenerate_outline，不要在聊天气泡里直接生成正文。
9. 如果用户要生成一门较宽的学习课程或学习笔记，但从当前输入和最近对话里还看不出他的基础、学习目标或希望的深度，不要急着打开草稿。此时 primary_intent=clarify，should_ask_clarification=true，并自然地追问最影响课程结构的缺失信息。一次只问一组真正有用的问题，不要让用户填写表格。若信息已经足够，就直接 note_draft_create，不要为了追问而追问。创建草稿时，draft_request.topic 必须是简洁准确的课程名，不能取用户回答的开头；draft_request.brief 要综合最近对话中已经确认的基础、目标、深度、重点和内容偏好，不能只复制当前一句。
10. 输出必须是 JSON 对象，不能有 markdown，不能有解释文字。

返回格式：
{{
  "primary_intent": "note_draft_create",
  "confidence": 0.93,
  "reply_surface": "draft_workspace",
  "memory_action": "none",
  "context_plan": {{
    "use_current_selection": false,
    "use_current_note": false,
    "search_note_library": false,
    "read_user_memory": false,
    "write_user_memory": false,
    "continue_working_task": false,
    "topic": "SSE",
    "focus": "创建 SSE 智能笔记草稿"
  }},
  "tool_plan": [
    {{"tool": "note_draft_tool", "action": "open_draft_workspace", "reason": "用户明确要求写一篇笔记"}}
  ],
  "draft_request": {{"topic": "SSE", "note_type": "智能笔记", "source_mode": "model_knowledge", "style": "按用户需求自动组织", "brief": "用户已经确认的完整生成需求"}},
  "edit_request": {{}},
  "memory_read_request": {{}},
  "should_ask_clarification": false,
  "clarification_question": "",
  "reason": "用户明确要求创建笔记"
}}
""".strip()
    user = (
        f"页面和任务状态：\n{_state_summary(page_state, checkpoint)}\n\n"
        f"最近对话：\n{_format_history(history)}\n\n"
        f"当前用户输入：\n{question.strip()}"
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


async def plan_context_llm(
    *,
    question: str,
    history: list[ChatMessage] | None = None,
    page_state: dict[str, Any] | None = None,
    checkpoint: dict[str, Any] | None = None,
) -> ContextPlan:
    content = await complete_chat(
        _build_messages(
            question=question,
            history=history,
            page_state=page_state,
            checkpoint=checkpoint,
        ),
        max_tokens=1600,
        temperature=0.0,
    )
    return context_plan_from_llm_payload(_json_from_text(content), question)


async def plan_context_smart(
    *,
    question: str,
    history: list[ChatMessage] | None = None,
    page_state: dict[str, Any] | None = None,
    checkpoint: dict[str, Any] | None = None,
) -> ContextPlan:
    fallback = fallback_context_plan(question, page_state=page_state, checkpoint=checkpoint)
    try:
        plan = await plan_context_llm(
            question=question,
            history=history,
            page_state=page_state,
            checkpoint=checkpoint,
        )
        if plan.confidence >= 0.55:
            return apply_context_policy(plan, question, page_state=page_state, checkpoint=checkpoint)
    except Exception:
        pass
    return apply_context_policy(fallback, question, page_state=page_state, checkpoint=checkpoint)


def _normalized_question(question: str) -> str:
    return re.sub(r"[\s,，。,.!！?？~～]+", "", question.strip().lower())


def _is_confirm_text(question: str) -> bool:
    return _normalized_question(question) in CONFIRM_ACTIONS


def _is_cancel_text(question: str) -> bool:
    normalized = _normalized_question(question)
    return normalized in CANCEL_ACTIONS or bool(
        re.search(r"^(算了|取消|放弃|先不改|先不写|不要改了|不要写了|不改了|不写了)", normalized)
    )


def _is_draft_feedback_question(question: str) -> bool:
    normalized = _normalized_question(question)
    if normalized in {"继续", "继续吧", "接着来", "接着做"}:
        return True
    return bool(
        re.search(
            r"(大纲|结构|目录|标题|章节|内容|笔记|风格|类型).{0,30}(不对|不对劲|不像|跑偏|偏了|有问题|详细|太少|不够|简单|简洁|啰嗦|太长|重新|重来|再生成|换|调整|补充|丰富|学习笔记)|"
            r"(不像.{0,10}学习笔记|学习笔记.{0,10}不像|详细一点|更详细|再详细|简洁一点|精简一点|重新生成|重来|换个结构|补充一点|丰富一点)",
            question,
        )
    )


def _draft_continue_plan(*, reason: str, source: str, confidence: float = 0.68) -> ContextPlan:
    return _validate_plan(
        ContextPlan(
            "note_draft_continue",
            confidence,
            "draft_workspace",
            context_plan={"continue_working_task": True, "focus": "根据反馈重新生成草稿大纲"},
            tool_plan=[
                {
                    "tool": "note_draft_tool",
                    "action": "regenerate_outline",
                    "reason": "用户正在反馈当前草稿大纲",
                }
            ],
            reason=reason,
            source=source,
        )
    )


def _with_policy_reason(plan: ContextPlan, label: str) -> ContextPlan:
    plan.reason = f"{plan.reason};{label}" if plan.reason else label
    return plan


def apply_context_policy(
    plan: ContextPlan,
    question: str,
    *,
    page_state: dict[str, Any] | None = None,
    checkpoint: dict[str, Any] | None = None,
) -> ContextPlan:
    """Apply deterministic UI-state policy after semantic planning.

    The LLM decides user intent from language; this layer resolves product state
    conflicts such as an active edit preview or draft workspace.
    """
    plan = _validate_plan(plan)
    state = page_state or {}
    checkpoint_type = (checkpoint or {}).get("checkpointType")
    center_mode = _clean(state.get("centerMode"), 60)
    has_edit_preview = checkpoint_type == "edit_preview" or bool(state.get("activeEditPreviewId"))
    draft_active = (
        checkpoint_type == "draft_workspace"
        or center_mode == "draft"
        or bool(state.get("activeDraftId"))
        or bool(state.get("activeDraftTopic"))
        or bool(state.get("draftSeed"))
    )

    if has_edit_preview:
        if _is_confirm_text(question):
            return _with_policy_reason(
                ContextPlan("confirm_action", max(plan.confidence, 0.7), "none", reason=plan.reason, source=plan.source),
                "policy:edit_preview_confirm",
            )
        if _is_cancel_text(question):
            return _with_policy_reason(
                ContextPlan("cancel_action", max(plan.confidence, 0.7), "none", reason=plan.reason, source=plan.source),
                "policy:edit_preview_cancel",
            )
        if plan.primary_intent not in EDIT_PREVIEW_INTERRUPTION_INTENTS:
            plan.primary_intent = "note_edit_revise"
            plan.reply_surface = "editor_patch"
            return _with_policy_reason(_validate_plan(plan), "policy:edit_preview_revise")
        return _validate_plan(plan)

    if draft_active:
        if _is_cancel_text(question):
            return _with_policy_reason(
                ContextPlan("cancel_action", max(plan.confidence, 0.62), "none", reason=plan.reason, source=plan.source),
                "policy:draft_cancel",
            )
        if _is_draft_feedback_question(question):
            return _draft_continue_plan(reason=f"{plan.reason};policy:draft_feedback" if plan.reason else "policy:draft_feedback", source=plan.source, confidence=max(plan.confidence, 0.68))

    return _validate_plan(plan)


def _infer_draft_topic(question: str) -> str:
    text = _clean(question, 180)
    text = re.sub(r"^(帮我|请|麻烦|给我|我想要|我要|能不能|可以)?\s*", "", text)
    text = re.sub(r"(生成|创建|新建|写一篇|写一个|写份|写|整理一篇|整理一个|整理一份|整理)", "", text)
    text = re.sub(r"^(一篇|一个|一份|一套|篇|个|份)\s*", "", text)
    text = re.sub(r"(学习笔记|面试笔记|复习笔记|项目笔记|笔记|文档|教程|学习资料)", "", text)
    text = re.sub(r"[，。,.!！?？]", " ", text)
    text = re.sub(r"\s+", " ", text).strip(" ：:")
    return text[:120] or _clean(question, 120)


def fallback_context_plan(
    question: str,
    *,
    page_state: dict[str, Any] | None = None,
    checkpoint: dict[str, Any] | None = None,
) -> ContextPlan:
    q = question or ""
    normalized = _normalized_question(q)
    state = page_state or {}
    checkpoint_type = (checkpoint or {}).get("checkpointType")
    center_mode = _clean(state.get("centerMode"), 60)
    has_current_note = bool(state.get("currentNoteId"))
    has_selection = bool(str(state.get("selectedText") or "").strip())
    draft_active = (
        checkpoint_type == "draft_workspace"
        or center_mode == "draft"
        or bool(state.get("activeDraftId"))
        or bool(state.get("activeDraftTopic"))
        or bool(state.get("draftSeed"))
    )

    if checkpoint_type == "edit_preview":
        if _is_confirm_text(q):
            return ContextPlan("confirm_action", 0.7, "none", reason="fallback:confirm", source="fallback")
        if _is_cancel_text(q):
            return ContextPlan("cancel_action", 0.7, "none", reason="fallback:cancel", source="fallback")
        return ContextPlan("note_edit_revise", 0.6, "editor_patch", reason="fallback:edit_preview", source="fallback")

    if draft_active:
        if _is_cancel_text(q):
            return ContextPlan("cancel_action", 0.62, "none", reason="fallback:cancel_draft", source="fallback")
        if _is_draft_feedback_question(q):
            return _draft_continue_plan(reason="fallback:draft_continue", source="fallback")

    if normalized in {"", "你好", "您好", "hello", "hi", "嗨", "哈喽", "在吗", "谢谢", "感谢", "再见"}:
        return ContextPlan("general_chat", 0.7, "chat_bubble", reason="fallback:smalltalk", source="fallback")

    if normalized in {"继续", "继续吧", "接着来", "接着做", "继续上次", "继续昨天"} or re.search(
        r"(继续|接着|恢复|打开).{0,16}(上次|昨天|刚才|之前|那个|任务|草稿|预览|修改)",
        q,
    ):
        return ContextPlan("resume_work", 0.65, "chat_bubble", reason="fallback:resume", source="fallback")

    if re.search(r"(生成|创建|新建|写|整理).{0,50}(笔记|文档|教程|学习资料)|(?:笔记|文档|教程).{0,30}(生成|创建|新建|写|整理)", q):
        topic = _infer_draft_topic(q)
        return _validate_plan(
            ContextPlan(
                "note_draft_create",
                0.72,
                "draft_workspace",
                draft_request={"topic": topic, "note_type": "智能笔记", "source_mode": "model_knowledge"},
                context_plan={"topic": topic, "focus": f"创建 {topic} 笔记草稿"},
                reason="fallback:note_draft_create",
                source="fallback",
            )
        )

    if re.search(
        r"(那天|之前|以前|上次|昨天|最近|前面).{0,30}(聊|说|讨论|做|写|生成|修改|项目|任务|笔记|忙)|"
        r"(我们|咱们).{0,20}(聊过|说过|讨论过|做过|写过)|"
        r"(我最近|最近我).{0,20}(忙|做|聊|学).{0,12}(什么|啥|哪些|吗|\?)",
        q,
    ):
        return ContextPlan("history_recall", 0.6, "chat_bubble", reason="fallback:history_recall", source="fallback")

    if re.search(r"(记住.*哪些|记住.*什么|你.*记住.*什么|长期记忆|记忆列表|查看记忆|关于我.*记得|你.*了解我)", q):
        return _validate_plan(
            ContextPlan(
                "memory_manage",
                0.68,
                "chat_bubble",
                memory_action="list",
                context_plan={"read_user_memory": True},
                reason="fallback:memory_list",
                source="fallback",
            )
        )

    if re.search(r"(记住|你要记得|以后都?|从现在开始|默认|后面都|今后|你可以叫我|以后叫我|叫我)", q):
        return _validate_plan(
            ContextPlan(
                "memory_manage",
                0.62,
                "chat_bubble",
                memory_action="write",
                context_plan={"write_user_memory": True},
                reason="fallback:memory_write",
                source="fallback",
            )
        )

    if re.search(r"(你.*记住|还记得|记得.*我|知道.*我|我的.*记忆|我叫啥|我叫什么|我的名字)", q):
        return _validate_plan(
            ContextPlan(
                "memory_manage",
                0.68,
                "chat_bubble",
                memory_action="read",
                context_plan={"read_user_memory": True},
                reason="fallback:memory_read",
                source="fallback",
            )
        )

    if re.search(r"(我的笔记|笔记里|文章里|文档里|知识库|查一下|搜索).{0,30}(有没有|相关|包含|关于|内容|资料|笔记)", q):
        return _validate_plan(ContextPlan("note_search", 0.65, "note_reference", reason="fallback:note_search", source="fallback"))

    if has_current_note and re.search(r"(改|修改|改写|润色|优化|调整|重写|扩写|补充|添加|加入|加上|删掉|删除|移除|插入|替换|换成|改成|整理成|通俗一点|更通俗)", q):
        return _validate_plan(ContextPlan("note_edit_create", 0.64, "editor_patch", reason="fallback:note_edit", source="fallback"))

    if has_selection or (has_current_note and re.search(r"(当前笔记|当前文档|这篇|本文|这个笔记|这个文档|这段|这句|选中|根据笔记|基于笔记|结合笔记|这里说|里面说|这是什么意思)", q)):
        return _validate_plan(
            ContextPlan(
                "note_context_qa",
                0.63,
                "note_reference",
                context_plan={"use_current_selection": has_selection, "use_current_note": True},
                reason="fallback:current_note_context",
                source="fallback",
            )
        )

    read_memory = bool(re.search(r"(根据我|结合我|适合我|推荐|建议|规划|帮我分析|我应该|我的情况)", q))
    return ContextPlan(
        "general_chat",
        0.55,
        "chat_bubble",
        context_plan={"read_user_memory": read_memory},
        reason="fallback:general",
        source="fallback",
    )
