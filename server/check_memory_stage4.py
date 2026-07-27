from __future__ import annotations

from app.routers.agent import _classify_intent, AgentChatPayload, AgentChatPageState
from app.memory.domain import (
    candidate_review_tags,
    extract_memory_candidates,
    is_single_value_key,
    memory_candidate_status,
    normalize_canonical_key,
)
from app.memory.extraction import candidates_from_llm_payload
from app.memory.planning import fallback_memory_read_plan, read_plan_from_llm_payload


def _assert(condition: bool, message: str):
    if not condition:
        raise AssertionError(message)


def _first(text: str):
    candidates = extract_memory_candidates(text, "global")
    _assert(bool(candidates), f"expected candidate for: {text}")
    return candidates[0]


def main():
    name = _first("我叫张成")
    _assert(name.canonical_key == "identity.name", "name should use normalized identity key")
    _assert(memory_candidate_status(name) == "active", "explicit name should become active memory")

    age = _first("我今年24岁了")
    _assert(age.canonical_key == "profile.age", "age should use normalized age key")
    _assert(memory_candidate_status(age) == "active", "age statement should become active memory")

    _assert(
        normalize_canonical_key("personal_info.sleep_habit", "personal_info") == "lifestyle.sleep_schedule",
        "sleep key aliases should normalize to lifestyle.sleep_schedule",
    )
    _assert(
        normalize_canonical_key("career.interview_result", "episode") == "career.interview_history",
        "interview key aliases should normalize to career.interview_history",
    )
    _assert(is_single_value_key("personal_info.sleep_habit"), "sleep schedule should behave as a single-value memory")

    body = _first("我很瘦你知道吗")
    _assert(body.memory_type == "personal_info", "personal body info should be personal_info")
    _assert(memory_candidate_status(body) == "active", "clear personal info should become active memory")

    workflow = _first("我写代码前喜欢先画流程图")
    _assert(workflow.memory_type == "workflow", "workflow habit should keep workflow type")
    _assert(memory_candidate_status(workflow) == "pending", "long-tail workflow habit should become pending candidate")
    _assert("candidate:needs_review" in candidate_review_tags(workflow), "pending candidate should carry review tag")

    skill = _first("我最近在学 Redis")
    _assert(memory_candidate_status(skill) == "pending", "recent learning signal should become pending candidate")
    _assert(_classify_intent(AgentChatPayload(question="我最近在学 Redis")) == "general_chat", "recent learning statement should not route to history recall")

    llm_candidates = candidates_from_llm_payload(
        {
            "candidates": [
                {
                    "memory_type": "personal_info",
                    "canonical_key": "personal_info.sleep_habit",
                    "value": "作息较乱，经常熬夜",
                    "content": "用户生活习惯：作息较乱，经常熬夜",
                    "importance": 4,
                    "confidence": 0.88,
                    "source": "user_explicit",
                    "scope": "global",
                    "tags": ["生活习惯", "睡眠"],
                    "subject": "user",
                    "temporal_scope": "durable",
                    "stability": "medium",
                    "operation": "upsert",
                },
                {
                    "memory_type": "identity",
                    "canonical_key": "friend.name",
                    "value": "李雷",
                    "content": "用户朋友叫李雷",
                    "importance": 2,
                    "confidence": 0.93,
                    "source": "user_explicit",
                    "scope": "global",
                    "tags": ["朋友"],
                    "subject": "third_party",
                    "temporal_scope": "durable",
                    "stability": "high",
                    "operation": "upsert",
                },
                {
                    "memory_type": "personal_info",
                    "canonical_key": "mood.today",
                    "value": "今天有点累",
                    "content": "用户今天有点累",
                    "importance": 2,
                    "confidence": 0.91,
                    "source": "user_explicit",
                    "scope": "global",
                    "tags": ["状态"],
                    "subject": "user",
                    "temporal_scope": "temporary",
                    "stability": "low",
                    "operation": "upsert",
                },
                {
                    "memory_type": "episode",
                    "canonical_key": "career.interview_history",
                    "value": "上个月金山面试没有通过，准备了三个月，很可惜",
                    "content": "用户历史经历：上个月金山面试没有通过，准备了三个月，很可惜",
                    "importance": 4,
                    "confidence": 0.9,
                    "source": "user_explicit",
                    "scope": "global",
                    "tags": ["面试经历", "求职"],
                    "subject": "user",
                    "temporal_scope": "durable",
                    "stability": "medium",
                    "operation": "upsert",
                },
                {
                    "memory_type": "preference",
                    "layer": "working",
                    "canonical_key": "scratch.note",
                    "value": "临时草稿状态",
                    "content": "用户临时草稿状态：临时草稿状态",
                    "importance": 2,
                    "confidence": 0.95,
                    "source": "user_explicit",
                    "scope": "global",
                    "tags": ["临时"],
                    "subject": "user",
                    "temporal_scope": "durable",
                    "stability": "low",
                    "operation": "upsert",
                },
            ]
        }
    )
    sleep, friend, temporary, interview, invalid_layer = llm_candidates
    _assert(sleep.canonical_key == "lifestyle.sleep_schedule", "llm extractor should preserve long-tail canonical key")
    _assert(sleep.layer == "semantic", "profile facts should stay in semantic layer")
    _assert("layer:semantic" in sleep.tags, "semantic candidate should carry semantic layer tag")
    _assert(memory_candidate_status(sleep) == "active", "direct sleep schedule statement should become active")
    _assert(memory_candidate_status(friend) == "rejected", "third-party candidate should be rejected by policy")
    _assert(memory_candidate_status(temporary) == "rejected", "temporary candidate should be rejected by policy")
    _assert(interview.memory_type == "episode", "interview history should be episodic memory")
    _assert(interview.layer == "episodic", "episode memory should use episodic layer")
    _assert("layer:episodic" in interview.tags, "episodic candidate should carry episodic layer tag")
    _assert("layer:semantic" not in interview.tags, "episodic candidate should not be tagged semantic")
    _assert(interview.canonical_key == "career.interview_history", "interview history should keep canonical key")
    _assert(memory_candidate_status(interview) == "active", "explicit interview history should become active")
    _assert(memory_candidate_status(invalid_layer) == "rejected", "non-persisted memory layers should not be saved to long-term memory")
    _assert(_classify_intent(AgentChatPayload(question="诶，你还记得我的作息怎么样来着")) == "memory_manage", "sleep schedule query should route to memory")

    sleep_plan = read_plan_from_llm_payload(
        {
            "is_memory_query": True,
            "query": "用户作息和睡眠习惯",
            "layers": ["semantic"],
            "memory_types": ["personal_info"],
            "canonical_keys": ["sleep.routine"],
            "scopes": ["global"],
            "limit": 8,
            "confidence": 0.92,
            "reason": "用户在问自己的作息记忆",
        },
        "你还记得我的作息怎么样吗",
    )
    _assert(sleep_plan.layers == ["semantic"], "read planner should select semantic layer for profile facts")
    _assert(sleep_plan.memory_types == ["personal_info"], "read planner should select personal_info")
    _assert(sleep_plan.canonical_keys == ["lifestyle.sleep_schedule"], "read planner should select sleep canonical key")

    fallback_plan = fallback_memory_read_plan("你还记得我的作息怎么样吗")
    _assert(fallback_plan.layers == ["semantic"], "fallback read plan should select semantic layer for sleep query")
    _assert("identity" not in fallback_plan.memory_types, "fallback read plan must not map sleep query to identity")
    _assert("lifestyle.sleep_schedule" in fallback_plan.canonical_keys, "fallback read plan should target sleep key")

    interview_plan = read_plan_from_llm_payload(
        {
            "is_memory_query": True,
            "query": "用户金山面试经历和结果",
            "layers": ["episodic", "semantic"],
            "memory_types": ["episode", "goal"],
            "canonical_keys": ["career.interview_history"],
            "scopes": ["global"],
            "limit": 8,
            "confidence": 0.93,
            "reason": "用户在问过去的公司面试经历",
        },
        "你还记得我金山的面试情况吗",
    )
    _assert("episodic" in interview_plan.layers, "read planner should target episodic layer for interview history")
    _assert("episode" in interview_plan.memory_types, "read planner should allow episodic interview memory")
    _assert("career.interview_history" in interview_plan.canonical_keys, "read planner should target interview history key")

    fallback_interview = fallback_memory_read_plan("你还记得我金山的面试情况吗")
    _assert("episodic" in fallback_interview.layers, "fallback interview read plan should include episodic layer")
    _assert("episode" in fallback_interview.memory_types, "fallback interview read plan should include episode")
    _assert("career.interview_history" in fallback_interview.canonical_keys, "fallback interview read plan should target interview key")
    _assert(_classify_intent(AgentChatPayload(question="你还记得我金山的面试情况吗")) == "memory_manage", "interview recall query should route to memory")

    personal_chat_with_note = AgentChatPayload(
        question="我现在没有女朋友，我太瘦了，我感觉我不好找对象",
        pageState=AgentChatPageState(currentNoteId="note_1"),
    )
    _assert(
        _classify_intent(personal_chat_with_note) == "general_chat",
        "personal emotional chat should not become current note QA just because a note is open",
    )

    note_qa = AgentChatPayload(
        question="这篇笔记里缓存雪崩是什么意思",
        pageState=AgentChatPageState(currentNoteId="note_1"),
    )
    _assert(_classify_intent(note_qa) == "note_context_qa", "explicit current-note question should use current note QA")

    _assert(extract_memory_candidates("今天我有点累", "global") == [], "temporary state should be rejected")
    _assert(extract_memory_candidates("我朋友叫李雷", "global") == [], "third-party fact should be rejected")

    print("memory stage4 checks passed")


if __name__ == "__main__":
    main()
