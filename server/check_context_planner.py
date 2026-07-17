from __future__ import annotations

from app.routers.agent import (
    AgentChatPageState,
    AgentChatPayload,
    _classify_intent,
    _draft_seed_for_continue,
    _draft_seed_from_plan,
)
from app.services.context_planner import apply_context_policy, context_plan_from_llm_payload, fallback_context_plan
from app.services.note_library import route_context_mode


def _assert(condition: bool, message: str):
    if not condition:
        raise AssertionError(message)


def _fallback(question: str, page_state: dict | None = None, checkpoint: dict | None = None):
    return fallback_context_plan(question, page_state=page_state, checkpoint=checkpoint)


def _assert_fallback_intent(question: str, intent: str, page_state: dict | None = None):
    plan = _fallback(question, page_state)
    _assert(plan.primary_intent == intent, f"{question!r} should route to {intent}, got {plan.primary_intent}")
    return plan


def main():
    draft_cases = [
        ("帮我写一篇 SSE 知识笔记", "SSE 知识"),
        ("生成 Redis 缓存雪崩学习笔记", "Redis 缓存雪崩"),
        ("整理一份 MySQL 索引面试笔记", "MySQL 索引"),
        ("创建一个长轮询和 SSE 对比教程", "长轮询和 SSE 对比"),
        ("帮我整理一篇 WebSocket 文档", "WebSocket"),
    ]
    for question, topic in draft_cases:
        plan = _assert_fallback_intent(question, "note_draft_create")
        _assert(plan.reply_surface == "draft_workspace", "draft should open draft workspace")
        _assert(plan.draft_request.get("topic") == topic, f"draft topic should be {topic!r}")
        _assert(any(item.get("tool") == "note_draft_tool" for item in plan.tool_plan), "draft should call draft tool")

    chat_cases = [
        "SSE 是什么",
        "缓存雪崩怎么理解",
        "我现在没有女朋友，我太瘦了，我感觉我不好找对象",
        "我的作息很乱，总是熬夜",
        "我今年都 24 岁了",
    ]
    for question in chat_cases:
        plan = _assert_fallback_intent(question, "general_chat", {"currentNoteId": "note_1"})
        _assert(not plan.context_plan.get("use_current_note"), f"{question!r} should not use current note by default")

    memory_read_cases = [
        "你还记得我叫什么吗",
        "你还记得我的作息怎么样吗",
        "你知道我多大了吗",
        "你还记得我金山的面试情况吗",
    ]
    for question in memory_read_cases:
        plan = _assert_fallback_intent(question, "memory_manage")
        _assert(plan.memory_action == "read", f"{question!r} should read memory")
        _assert(plan.context_plan.get("read_user_memory"), f"{question!r} should set read_user_memory")

    memory_list_cases = [
        "你记住了我哪些东西",
        "查看记忆列表",
    ]
    for question in memory_list_cases:
        plan = _assert_fallback_intent(question, "memory_manage")
        _assert(plan.memory_action == "list", f"{question!r} should list memories")

    memory_write_cases = [
        "记住我喜欢通俗解释",
        "以后叫我张成",
        "你要记得我写代码前喜欢先画流程图",
    ]
    for question in memory_write_cases:
        plan = _assert_fallback_intent(question, "memory_manage")
        _assert(plan.memory_action == "write", f"{question!r} should write memory")

    note_search_cases = [
        "我的笔记里有没有缓存雪崩相关内容",
        "文章里面有相关的文章吗",
        "查一下笔记里有没有 SSE",
        "搜索笔记里关于 WebSocket 的内容",
    ]
    for question in note_search_cases:
        plan = _assert_fallback_intent(question, "note_search", {"currentNoteId": "note_1"})
        _assert(plan.context_plan.get("search_note_library"), f"{question!r} should search note library")

    current_note_cases = [
        "这篇笔记里缓存雪崩是什么意思",
        "根据笔记解释一下 SSE",
        "这里说的 data 字段是什么意思",
        "这段是什么意思",
    ]
    for question in current_note_cases:
        plan = _assert_fallback_intent(question, "note_context_qa", {"currentNoteId": "note_1"})
        _assert(plan.context_plan.get("use_current_note"), f"{question!r} should use current note")

    selected_plan = _assert_fallback_intent(
        "解释一下",
        "note_context_qa",
        {"currentNoteId": "note_1", "selectedText": "event: custom\ndata: {...}"},
    )
    _assert(selected_plan.context_plan.get("use_current_selection"), "selected text should be current selection context")
    _assert(
        route_context_mode("啥意思", "设置热点 key 永不过期，定期异步刷新") == "selection",
        "joined selection should stay selection even when the question is only '啥意思'",
    )
    _assert(
        route_context_mode("为什么这么做", "设置热点 key 永不过期，定期异步刷新") == "selection",
        "joined selection should stay selection for follow-up style questions",
    )

    edit_cases = [
        "把这段改得通俗一点",
        "补充一个项目例子",
        "删掉这句话",
    ]
    for question in edit_cases:
        plan = _assert_fallback_intent(question, "note_edit_create", {"currentNoteId": "note_1"})
        _assert(plan.reply_surface == "editor_patch", f"{question!r} should use editor patch surface")

    resume_cases = [
        "继续",
        "继续上次那个草稿任务",
        "接着做之前那个修改",
    ]
    for question in resume_cases:
        _assert_fallback_intent(question, "resume_work")

    history_cases = [
        "你还记得那天我们聊过的笔记项目吗",
        "我们之前讨论过什么",
        "我最近在忙什么",
    ]
    for question in history_cases:
        _assert_fallback_intent(question, "history_recall")

    checkpoint = {"checkpointType": "edit_preview"}
    _assert(_fallback("应用吧", checkpoint=checkpoint).primary_intent == "confirm_action", "edit preview confirm should confirm")
    _assert(_fallback("取消", checkpoint=checkpoint).primary_intent == "cancel_action", "edit preview cancel should cancel")
    _assert(_fallback("再通俗一点", checkpoint=checkpoint).primary_intent == "note_edit_revise", "edit preview revise should revise")

    llm_missed_preview_confirm = apply_context_policy(
        context_plan_from_llm_payload(
            {
                "primary_intent": "general_chat",
                "confidence": 0.92,
                "reply_surface": "chat_bubble",
                "reason": "模型误判为普通对话",
            },
            "可以",
        ),
        "可以",
        checkpoint=checkpoint,
    )
    _assert(
        llm_missed_preview_confirm.primary_intent == "confirm_action",
        "policy should override high-confidence LLM output for edit preview confirm",
    )
    llm_missed_preview_revise = apply_context_policy(
        context_plan_from_llm_payload(
            {
                "primary_intent": "general_chat",
                "confidence": 0.9,
                "reply_surface": "chat_bubble",
                "reason": "模型误判为普通对话",
            },
            "再通俗一点",
        ),
        "再通俗一点",
        checkpoint=checkpoint,
    )
    _assert(
        llm_missed_preview_revise.primary_intent == "note_edit_revise",
        "policy should override high-confidence LLM output for edit preview revision",
    )

    draft_checkpoint = {"checkpointType": "draft_workspace", "payload": {"seed": "Go 并发编程"}}
    draft_feedback_cases = [
        "大纲不够详细",
        "再详细一点",
        "重新生成大纲",
        "换个结构，章节多一点",
    ]
    for question in draft_feedback_cases:
        plan = _fallback(question, checkpoint=draft_checkpoint)
        _assert(plan.primary_intent == "note_draft_continue", f"{question!r} should continue draft")
        _assert(plan.reply_surface == "draft_workspace", "draft feedback should stay in draft workspace")
        _assert(
            any(item.get("tool") == "note_draft_tool" and item.get("action") == "regenerate_outline" for item in plan.tool_plan),
            "draft feedback should call regenerate_outline",
        )

    draft_page_state = {"centerMode": "draft", "draftSeed": "SSE 知识"}
    draft_feedback_without_checkpoint = _fallback(
        "你这大纲为什么这么不对劲啊，他不像那种学习笔记啊",
        page_state=draft_page_state,
    )
    _assert(
        draft_feedback_without_checkpoint.primary_intent == "note_draft_continue",
        "draft feedback should continue draft even when checkpoint is missing",
    )
    _assert(
        draft_feedback_without_checkpoint.reply_surface == "draft_workspace",
        "draft feedback without checkpoint should stay in draft workspace",
    )
    _assert(
        any(
            item.get("tool") == "note_draft_tool" and item.get("action") == "regenerate_outline"
            for item in draft_feedback_without_checkpoint.tool_plan
        ),
        "draft feedback without checkpoint should regenerate outline",
    )
    llm_missed_draft_feedback = apply_context_policy(
        context_plan_from_llm_payload(
            {
                "primary_intent": "general_chat",
                "confidence": 0.88,
                "reply_surface": "chat_bubble",
                "reason": "模型误判为普通聊天",
            },
            "能不能再简洁一点这个大纲",
        ),
        "能不能再简洁一点这个大纲",
        page_state={"centerMode": "draft", "activeDraftTopic": "FastAPI"},
    )
    _assert(
        llm_missed_draft_feedback.primary_intent == "note_draft_continue",
        "policy should override high-confidence LLM output for draft feedback",
    )
    _assert(
        any(
            item.get("tool") == "note_draft_tool" and item.get("action") == "regenerate_outline"
            for item in llm_missed_draft_feedback.tool_plan
        ),
        "policy-overridden draft feedback should regenerate outline",
    )
    draft_cancel = _fallback("算了，不写了", checkpoint=draft_checkpoint)
    _assert(draft_cancel.primary_intent == "cancel_action", "draft cancel should route to cancel_action")
    mismatched_seed = _draft_seed_for_continue(
        draft_feedback_without_checkpoint,
        {"checkpointType": "draft_workspace", "payload": {"seed": "SSE 知识"}},
        AgentChatPageState(centerMode="draft", draftSeed="SSE 知识", activeDraftTitle="FastAPI 学习笔记", activeDraftTopic="FastAPI"),
        "能不能再简洁一点这个大纲",
    )
    _assert(mismatched_seed == "FastAPI", f"active draft topic should win over stale seed, got {mismatched_seed!r}")

    llm_draft = context_plan_from_llm_payload(
        {
            "primary_intent": "note_draft_create",
            "confidence": 0.94,
            "reply_surface": "draft_workspace",
            "memory_action": "none",
            "context_plan": {"topic": "SSE", "read_user_memory": False},
            "tool_plan": [{"tool": "note_draft_tool", "action": "open_draft_workspace"}],
            "draft_request": {"topic": "SSE", "note_type": "智能笔记", "source_mode": "model_knowledge"},
            "should_ask_clarification": False,
            "reason": "用户明确要求创建笔记",
        },
        "帮我写一篇 SSE 笔记",
    )
    _assert(llm_draft.primary_intent == "note_draft_create", "llm payload should keep draft intent")
    _assert(_draft_seed_from_plan(llm_draft, "帮我写一篇 SSE 笔记") == "SSE", "draft seed should use planned topic")

    llm_memory_draft = context_plan_from_llm_payload(
        {
            "primary_intent": "note_draft_create",
            "confidence": 0.9,
            "reply_surface": "draft_workspace",
            "context_plan": {"topic": "金山面试复盘", "read_user_memory": True},
            "tool_plan": [{"tool": "memory_tool", "action": "read"}, {"tool": "note_draft_tool", "action": "open_draft_workspace"}],
            "draft_request": {"topic": "金山面试复盘", "source_mode": "user_memory"},
        },
        "帮我写一篇关于我金山面试复盘的笔记",
    )
    _assert(llm_memory_draft.context_plan.get("read_user_memory"), "memory-backed draft should request memory")
    _assert(any(item.get("tool") == "note_draft_tool" for item in llm_memory_draft.tool_plan), "memory-backed draft should still open draft")

    _assert(_classify_intent(AgentChatPayload(question="帮我写一篇 SSE 知识笔记")) == "note_draft_create", "sync fallback should route draft create")
    _assert(
        _classify_intent(
            AgentChatPayload(
                question="你好",
                pageState=AgentChatPageState(currentNoteId="note_1"),
            )
        )
        == "general_chat",
        "open note should not hijack smalltalk",
    )

    print("context planner matrix checks passed")


if __name__ == "__main__":
    main()
