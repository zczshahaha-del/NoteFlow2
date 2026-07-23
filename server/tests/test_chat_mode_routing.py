import unittest

from app.routers.agent import AgentChatPayload, AgentChatPageState, _chat_mode_plan, _classify_intent, _should_use_memory_plan
from app.services.context_planner import ContextPlan, apply_context_policy
from app.services.memory_read import MemoryReadPlan


class ChatModeRoutingTests(unittest.TestCase):
    def test_chat_mode_never_uses_note_search(self):
        use_notes, plan = _chat_mode_plan("chat")

        self.assertFalse(use_notes)
        self.assertEqual(plan.primary_intent, "general_chat")
        self.assertEqual(plan.reason, "explicit:chat")

    def test_ask_notes_mode_always_uses_note_search(self):
        use_notes, plan = _chat_mode_plan("ask_notes")

        self.assertTrue(use_notes)
        self.assertEqual(plan.primary_intent, "note_search")
        self.assertTrue(plan.context_plan["strict_note_answer"])

    def test_unknown_mode_fails_safe_to_normal_chat(self):
        use_notes, plan = _chat_mode_plan("anything_else")

        self.assertFalse(use_notes)
        self.assertEqual(plan.primary_intent, "general_chat")

    def test_chat_mode_still_allows_note_draft_tasks(self):
        intent = _classify_intent(
            AgentChatPayload(question="帮我生成一篇 Redis 缓存雪崩学习笔记", mode="chat")
        )

        self.assertEqual(intent, "note_draft_create")

    def test_explicit_learning_note_request_never_gets_stuck_in_clarification(self):
        planned_clarification = ContextPlan(
            primary_intent="clarify",
            confidence=0.94,
            reply_surface="chat_bubble",
            should_ask_clarification=True,
            clarification_question="请先告诉我你的基础和学习方向。",
            source="llm",
        )

        result = apply_context_policy(planned_clarification, "帮我生成一份 Python 学习笔记")

        self.assertEqual(result.primary_intent, "note_draft_create")
        self.assertEqual(result.reply_surface, "draft_workspace")
        self.assertEqual(result.draft_request["topic"], "Python")
        self.assertFalse(result.should_ask_clarification)
        self.assertEqual(result.tool_plan[0]["action"], "open_draft_workspace")

    def test_chat_mode_does_not_silently_use_full_library_search(self):
        intent = _classify_intent(
            AgentChatPayload(
                question="我的笔记里有没有 Redis 缓存雪崩相关内容",
                mode="chat",
                pageState=AgentChatPageState(currentNoteId="note_1", contextScope="current_note"),
            )
        )

        self.assertEqual(intent, "general_chat")

    def test_ask_notes_mode_explicitly_uses_full_library_search(self):
        intent = _classify_intent(
            AgentChatPayload(question="我的笔记里有没有 Redis 缓存雪崩相关内容", mode="ask_notes")
        )

        self.assertEqual(intent, "note_search")

    def test_memory_use_requires_a_confident_model_plan(self):
        self.assertTrue(_should_use_memory_plan(MemoryReadPlan(is_memory_query=True, confidence=0.8)))
        self.assertFalse(_should_use_memory_plan(MemoryReadPlan(is_memory_query=True, confidence=0.4)))
        self.assertFalse(_should_use_memory_plan(MemoryReadPlan(is_memory_query=False, confidence=0.9)))


if __name__ == "__main__":
    unittest.main()
