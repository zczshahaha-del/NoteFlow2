from __future__ import annotations

import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.agent.langgraph_turn import (
    TurnGraphDependencies,
    graph_waiting_for_clarification,
    invoke_turn_graph,
    new_turn_state,
)
from app.services.turn_planner import (
    ChatMode,
    ContextSource,
    IntentParameters,
    PlannerFailure,
    PlanResult,
    PrimaryIntent,
    TurnPlan,
    fill_clarification,
    plan_turn_smart,
    plan_from_llm_payload,
    resume_turn_plan_smart,
    validate_turn_plan,
)
from app.memory.domain import extract_memory_candidates
from app.memory.extraction import (
    MemoryExtractionFailure,
    candidates_from_llm_payload,
    extract_memory_candidates_smart,
)


def memory_saver():
    try:
        from langgraph.checkpoint.memory import InMemorySaver
    except ImportError:
        from langgraph.checkpoint.memory import MemorySaver as InMemorySaver
    return InMemorySaver()


async def fallback_resume(_state, plan: TurnPlan, answer: str) -> TurnPlan:
    return validate_turn_plan(fill_clarification(plan, answer), page_state={})


class TurnPlannerTest(unittest.TestCase):
    def test_ask_notes_is_a_hard_mode_rule(self) -> None:
        plan = asyncio.run(plan_turn_smart(
            question="Redis 有哪些持久化方式",
            mode="ask_notes",
        ))

        self.assertEqual(plan.mode, ChatMode.ASK_NOTES)
        self.assertEqual(plan.primary_intent, PrimaryIntent.GENERAL_CHAT)
        self.assertEqual(plan.context_sources, [ContextSource.KNOWLEDGE_BASE])

    def test_topicless_note_request_clarifies_instead_of_using_raw_question(self) -> None:
        plan = validate_turn_plan(
            TurnPlan(
                primary_intent=PrimaryIntent.NOTE_CREATE,
                confidence=0.9,
            ),
            page_state={},
        )

        self.assertEqual(plan.primary_intent, PrimaryIntent.NOTE_CREATE)
        self.assertIsNone(plan.intent_parameters.topic)
        self.assertEqual(plan.missing_fields, ["topic"])
        self.assertEqual(plan.result, PlanResult.CLARIFY)

    def test_complete_note_request_executes(self) -> None:
        plan = validate_turn_plan(
            TurnPlan(
                primary_intent=PrimaryIntent.NOTE_CREATE,
                intent_parameters=IntentParameters(topic="Redis"),
                confidence=0.9,
            ),
            page_state={},
        )

        self.assertEqual(plan.primary_intent, PrimaryIntent.NOTE_CREATE)
        self.assertEqual(plan.intent_parameters.topic, "Redis")
        self.assertEqual(plan.result, PlanResult.EXECUTE)

    def test_current_note_summary_is_general_chat_with_context(self) -> None:
        plan = validate_turn_plan(
            TurnPlan(
                primary_intent=PrimaryIntent.GENERAL_CHAT,
                intent_parameters=IntentParameters(note_id="note-1"),
                context_sources=[ContextSource.CURRENT_NOTE],
                confidence=0.9,
            ),
            page_state={"currentNoteId": "note-1"},
        )

        self.assertEqual(plan.primary_intent, PrimaryIntent.GENERAL_CHAT)
        self.assertEqual(plan.context_sources, [ContextSource.CURRENT_NOTE])
        self.assertEqual(plan.result, PlanResult.EXECUTE)

    def test_memory_query_is_typed(self) -> None:
        plan = validate_turn_plan(
            TurnPlan(
                primary_intent=PrimaryIntent.MEMORY,
                intent_parameters=IntentParameters(
                    memory_action="read",
                    memory_scope="global",
                    memory_layers=["semantic"],
                    memory_key="identity.name",
                ),
                confidence=0.9,
            ),
            page_state={},
        )

        self.assertEqual(plan.primary_intent, PrimaryIntent.MEMORY)
        self.assertEqual(plan.intent_parameters.memory_action, "read")
        self.assertEqual(plan.intent_parameters.memory_key, "identity.name")
        self.assertIn(ContextSource.USER_MEMORY, plan.context_sources)

    def test_age_and_height_queries_are_typed_memory_reads(self) -> None:
        for key in ("profile.age", "profile.height"):
            with self.subTest(key=key):
                plan = validate_turn_plan(TurnPlan(
                    primary_intent=PrimaryIntent.MEMORY,
                    intent_parameters=IntentParameters(
                        memory_action="read",
                        memory_scope="global",
                        memory_layers=["semantic"],
                        memory_key=key,
                    ),
                    confidence=0.9,
                ))
                self.assertEqual(plan.primary_intent, PrimaryIntent.MEMORY)
                self.assertEqual(plan.intent_parameters.memory_action, "read")
                self.assertEqual(plan.intent_parameters.memory_key, key)
                self.assertIn(ContextSource.USER_MEMORY, plan.context_sources)

    def test_llm_classifies_explicit_age_read(self) -> None:
        completion = AsyncMock(return_value="""
        {
          "primary_intent": "memory",
            "intent_parameters": {
            "memory_action": "read",
            "memory_scope": "global",
            "memory_layers": ["semantic"],
            "memory_key": "profile.age"
          },
          "context_sources": ["user_memory"],
          "confidence": 0.94,
          "reason": "用户询问自己的年龄"
        }
        """)
        with patch("app.services.turn_planner.complete_chat", completion):
            plan = asyncio.run(plan_turn_smart(
                question="我今年多大了",
                mode="chat",
            ))

        self.assertEqual(completion.await_count, 1)
        self.assertEqual(plan.primary_intent, PrimaryIntent.MEMORY)
        self.assertEqual(plan.intent_parameters.memory_action, "read")
        self.assertEqual(plan.intent_parameters.memory_key, "profile.age")
        self.assertIn(ContextSource.USER_MEMORY, plan.context_sources)

    def test_provider_failure_is_not_misreported_as_unknown(self) -> None:
        completion = AsyncMock(side_effect=RuntimeError("planner unavailable"))
        with patch("app.services.turn_planner.complete_chat", completion):
            with self.assertRaisesRegex(PlannerFailure, "规划服务暂时不可用"):
                asyncio.run(plan_turn_smart(
                    question="我今年多大了",
                    mode="chat",
                ))
        self.assertEqual(completion.await_count, 1)

    def test_langgraph_keeps_planner_failure_distinct_from_semantic_unknown(self) -> None:
        async def unavailable(_state):
            raise PlannerFailure("规划服务暂时不可用，请稍后重试。")

        result = asyncio.run(invoke_turn_graph(
            new_turn_state(
                user_id="u",
                session_id="planner-error-session",
                question="我多大了",
                mode="chat",
            ),
            checkpointer=memory_saver(),
            thread_id="planner-error-thread",
            dependencies=TurnGraphDependencies(plan_turn=unavailable),
        ))

        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["error_code"], "planner_failed")
        self.assertIn("规划服务暂时不可用", result["error_message"])
        self.assertNotIn("turn_plan", result)

    def test_model_memory_aliases_are_normalized_by_the_typed_contract(self) -> None:
        plan = validate_turn_plan(
            plan_from_llm_payload(
                {
                    "primary_intent": "memory",
                    "intent_parameters": {
                        "requirements": None,
                        "memory_action": "retrieve",
                        "memory_scope": "personal",
                        "memory_key": "age",
                    },
                    "context_sources": [],
                    "confidence": 0.98,
                    "reason": "用户询问自己的年龄",
                },
                mode="chat",
            ),
            page_state={},
        )

        self.assertEqual(plan.primary_intent, PrimaryIntent.MEMORY)
        self.assertEqual(plan.intent_parameters.memory_action, "read")
        self.assertEqual(plan.intent_parameters.memory_scope, "global")
        self.assertEqual(plan.intent_parameters.memory_layers, ["semantic"])
        self.assertEqual(plan.intent_parameters.memory_key, "profile.age")
        self.assertIn(ContextSource.USER_MEMORY, plan.context_sources)
        self.assertEqual(plan.result, PlanResult.EXECUTE)

    def test_vague_request_is_unknown(self) -> None:
        plan = validate_turn_plan(TurnPlan(
            primary_intent=PrimaryIntent.UNKNOWN,
            confidence=0.2,
        ))

        self.assertEqual(plan.primary_intent, PrimaryIntent.UNKNOWN)
        self.assertEqual(plan.result, PlanResult.UNKNOWN)

    def test_implicit_memory_gate_is_separate_from_primary_intent(self) -> None:
        plan = TurnPlan(
            primary_intent=PrimaryIntent.NOTE_CREATE,
            intent_parameters=IntentParameters(topic="Redis"),
            confidence=0.9,
        )
        candidates = candidates_from_llm_payload({
            "candidates": [{
                "memory_type": "identity",
                "layer": "semantic",
                "canonical_key": "identity.name",
                "value": "张成",
                "content": "用户称呼：张成",
                "importance": 5,
                "confidence": 0.99,
                "source": "user_explicit",
                "scope": "global",
                "tags": ["身份"],
                "subject": "user",
                "temporal_scope": "durable",
                "stability": "high",
                "operation": "upsert",
                "reason": "用户明确陈述姓名",
            }],
        })

        self.assertEqual(plan.primary_intent, PrimaryIntent.NOTE_CREATE)
        self.assertEqual(candidates[0].canonical_key, "identity.name")

    def test_height_is_a_stable_memory_but_height_question_is_not_a_write(self) -> None:
        candidates = extract_memory_candidates("我身高180cm")

        self.assertEqual([candidate.canonical_key for candidate in candidates], ["profile.height"])
        self.assertEqual(candidates[0].value, "180")
        self.assertEqual(extract_memory_candidates("我身高多少你还记得吗？"), [])

    def test_memory_writer_uses_model_and_repairs_invalid_json_once(self) -> None:
        completion = AsyncMock(side_effect=[
            "not json",
            """
            {
              "candidates": [{
                "memory_type": "personal_info",
                "layer": "semantic",
                "canonical_key": "profile.height",
                "value": "180cm",
                "content": "用户身高：180cm",
                "importance": 4,
                "confidence": 0.98,
                "source": "user_explicit",
                "scope": "global",
                "tags": ["身高"],
                "subject": "user",
                "temporal_scope": "durable",
                "stability": "high",
                "operation": "upsert",
                "reason": "用户明确陈述身高"
              }]
            }
            """,
        ])
        with patch("app.memory.extraction.complete_chat", completion):
            candidates = asyncio.run(extract_memory_candidates_smart("我身高180cm"))

        self.assertEqual(completion.await_count, 2)
        self.assertEqual(candidates[0].canonical_key, "profile.height")
        self.assertIn("method:llm_repaired", candidates[0].tags)

    def test_memory_writer_failure_does_not_fall_back_to_regex(self) -> None:
        completion = AsyncMock(side_effect=RuntimeError("provider unavailable"))
        with patch("app.memory.extraction.complete_chat", completion):
            with self.assertRaises(MemoryExtractionFailure):
                asyncio.run(extract_memory_candidates_smart("我身高180cm"))
        self.assertEqual(completion.await_count, 1)

    def test_chat_mode_uses_the_llm_planner_on_the_normal_path(self) -> None:
        completion = AsyncMock(return_value="""
        {
          "primary_intent": "note_create",
          "intent_parameters": {"topic": "Go 语言", "requirements": "生成 Go 语言学习笔记"},
          "context_sources": [],
          "confidence": 0.96,
          "reason": "用户要求创建 Go 语言笔记"
        }
        """)
        with patch("app.services.turn_planner.complete_chat", completion):
            plan = asyncio.run(plan_turn_smart(
                question="帮我生成 Go 语言的学习笔记",
                mode="chat",
            ))

        self.assertEqual(completion.await_count, 1)
        self.assertEqual(plan.source, "llm")
        self.assertEqual(plan.primary_intent, PrimaryIntent.NOTE_CREATE)
        self.assertEqual(plan.intent_parameters.topic, "Go 语言")

    def test_invalid_json_is_repaired_once(self) -> None:
        completion = AsyncMock(side_effect=[
            "not json",
            """
            {
              "primary_intent": "memory",
              "intent_parameters": {
                "memory_action": "read",
                "memory_scope": "global",
                "memory_layers": ["semantic"],
                "memory_key": "profile.age"
              },
              "context_sources": ["user_memory"],
              "confidence": 0.96,
              "reason": "用户询问年龄"
            }
            """,
        ])
        with patch("app.services.turn_planner.complete_chat", completion):
            plan = asyncio.run(plan_turn_smart(
                question="我多大了",
                mode="chat",
            ))

        self.assertEqual(completion.await_count, 2)
        self.assertEqual(plan.source, "repaired")
        self.assertEqual(plan.intent_parameters.memory_key, "profile.age")

    def test_clarification_reply_uses_the_llm_to_merge_the_plan(self) -> None:
        original = validate_turn_plan(TurnPlan(
            mode=ChatMode.CHAT,
            primary_intent=PrimaryIntent.NOTE_CREATE,
            confidence=0.95,
            source="llm",
        ))
        completion = AsyncMock(return_value="""
        {
          "primary_intent": "note_create",
          "intent_parameters": {"topic": "go 语言的", "requirements": "写一份 Go 语言学习笔记"},
          "context_sources": [],
          "confidence": 0.97,
          "reason": "用户补充的语义主题是 Go 语言"
        }
        """)
        with patch("app.services.turn_planner.complete_chat", completion):
            plan = asyncio.run(resume_turn_plan_smart(
                original_question="帮我写一份笔记",
                answer="生成 go 语言的",
                plan=original,
            ))

        self.assertEqual(completion.await_count, 1)
        self.assertEqual(plan.source, "resume")
        self.assertEqual(plan.intent_parameters.topic, "Go 语言")
        self.assertEqual(plan.result, PlanResult.EXECUTE)

    def test_langgraph_interrupt_resumes_original_note_intent(self) -> None:
        async def fake_plan(_state):
            return TurnPlan(
                mode=ChatMode.CHAT,
                primary_intent=PrimaryIntent.NOTE_CREATE,
                confidence=1.0,
                source="llm",
            )

        async def exercise():
            saver = memory_saver()
            dependencies = TurnGraphDependencies(
                plan_turn=fake_plan,
                resume_turn=fallback_resume,
            )
            first = await invoke_turn_graph(
                new_turn_state(
                    user_id="u",
                    session_id="session",
                    question="生成笔记",
                    mode="chat",
                ),
                checkpointer=saver,
                thread_id="turn-thread",
                dependencies=dependencies,
            )
            waiting = await graph_waiting_for_clarification(
                checkpointer=saver,
                thread_id="turn-thread",
                dependencies=dependencies,
            )
            second = await invoke_turn_graph(
                None,
                checkpointer=saver,
                thread_id="turn-thread",
                dependencies=dependencies,
                resume="Redis",
            )
            finished_waiting = await graph_waiting_for_clarification(
                checkpointer=saver,
                thread_id="turn-thread",
                dependencies=dependencies,
            )
            return first, waiting, second, finished_waiting

        first, waiting, second, finished_waiting = asyncio.run(exercise())
        self.assertIn("__interrupt__", first)
        self.assertTrue(waiting)
        resumed = TurnPlan.model_validate(second["turn_plan"])
        self.assertEqual(resumed.intent_parameters.topic, "Redis")
        self.assertEqual(resumed.result, PlanResult.EXECUTE)
        self.assertEqual(second["status"], "ready")
        self.assertFalse(finished_waiting)

    def test_clarification_resume_uses_the_planner_result(self) -> None:
        async def fake_plan(_state):
            return TurnPlan(
                mode=ChatMode.CHAT,
                primary_intent=PrimaryIntent.NOTE_CREATE,
                confidence=1.0,
                source="llm",
            )

        async def fake_resume(_state, plan, _answer):
            updated = plan.model_copy(deep=True)
            updated.intent_parameters.topic = "Go 语言"
            updated.source = "resume"
            return validate_turn_plan(updated)

        async def exercise():
            saver = memory_saver()
            dependencies = TurnGraphDependencies(
                plan_turn=fake_plan,
                resume_turn=fake_resume,
            )
            await invoke_turn_graph(
                new_turn_state(
                    user_id="u",
                    session_id="session",
                    question="帮我写一份笔记",
                    mode="chat",
                ),
                checkpointer=saver,
                thread_id="topic-cleanup-thread",
                dependencies=dependencies,
            )
            return await invoke_turn_graph(
                None,
                checkpointer=saver,
                thread_id="topic-cleanup-thread",
                dependencies=dependencies,
                resume="生成 go 语言",
            )

        result = asyncio.run(exercise())
        resumed = TurnPlan.model_validate(result["turn_plan"])
        self.assertEqual(resumed.intent_parameters.topic, "Go 语言")
        self.assertEqual(resumed.result, PlanResult.EXECUTE)

    def test_langgraph_clarification_can_be_cancelled(self) -> None:
        async def fake_plan(_state):
            return TurnPlan(
                mode=ChatMode.CHAT,
                primary_intent=PrimaryIntent.NOTE_CREATE,
                confidence=1.0,
                source="llm",
            )

        async def exercise():
            saver = memory_saver()
            dependencies = TurnGraphDependencies(plan_turn=fake_plan)
            await invoke_turn_graph(
                new_turn_state(
                    user_id="u",
                    session_id="session",
                    question="生成笔记",
                    mode="chat",
                ),
                checkpointer=saver,
                thread_id="cancel-thread",
                dependencies=dependencies,
            )
            return await invoke_turn_graph(
                None,
                checkpointer=saver,
                thread_id="cancel-thread",
                dependencies=dependencies,
                resume="取消",
            )

        result = asyncio.run(exercise())
        self.assertEqual(result["status"], "cancelled")


if __name__ == "__main__":
    unittest.main()
