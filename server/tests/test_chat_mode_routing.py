import unittest

from app.services.turn_planner import (
    ChatMode,
    ContextSource,
    IntentParameters,
    PlanResult,
    PrimaryIntent,
    TurnPlan,
    validate_turn_plan,
)


class ChatModeRoutingTests(unittest.TestCase):
    def test_chat_mode_never_uses_note_search(self):
        plan = validate_turn_plan(TurnPlan(
            mode=ChatMode.CHAT,
            primary_intent=PrimaryIntent.GENERAL_CHAT,
            confidence=0.9,
        ))

        self.assertEqual(plan.mode, ChatMode.CHAT)
        self.assertEqual(plan.primary_intent, PrimaryIntent.GENERAL_CHAT)
        self.assertNotIn(ContextSource.KNOWLEDGE_BASE, plan.context_sources)

    def test_ask_notes_mode_always_uses_note_search(self):
        plan = validate_turn_plan(TurnPlan(
            mode=ChatMode.ASK_NOTES,
            primary_intent=PrimaryIntent.NOTE_CREATE,
            confidence=0.9,
        ))

        self.assertEqual(plan.mode, ChatMode.ASK_NOTES)
        self.assertEqual(plan.context_sources, [ContextSource.KNOWLEDGE_BASE])

    def test_unknown_mode_fails_safe_to_normal_chat(self):
        plan = validate_turn_plan(TurnPlan(
            mode=ChatMode.CHAT,
            primary_intent=PrimaryIntent.GENERAL_CHAT,
            confidence=0.9,
        ))

        self.assertEqual(plan.mode, ChatMode.CHAT)
        self.assertEqual(plan.primary_intent, PrimaryIntent.GENERAL_CHAT)

    def test_chat_mode_still_allows_note_draft_tasks(self):
        plan = validate_turn_plan(
            TurnPlan(
                primary_intent=PrimaryIntent.NOTE_CREATE,
                intent_parameters=IntentParameters(topic="Redis 缓存雪崩"),
                confidence=0.9,
            )
        )

        self.assertEqual(plan.primary_intent, PrimaryIntent.NOTE_CREATE)
        self.assertEqual(plan.result, PlanResult.EXECUTE)

    def test_chat_mode_does_not_silently_use_full_library_search(self):
        plan = validate_turn_plan(
            TurnPlan(
                mode=ChatMode.CHAT,
                primary_intent=PrimaryIntent.GENERAL_CHAT,
                context_sources=[ContextSource.KNOWLEDGE_BASE],
                confidence=0.9,
            ),
            page_state={"currentNoteId": "note_1", "contextScope": "current_note"},
        )

        self.assertEqual(plan.primary_intent, PrimaryIntent.GENERAL_CHAT)
        self.assertNotIn(ContextSource.KNOWLEDGE_BASE, plan.context_sources)

    def test_ask_notes_mode_explicitly_uses_full_library_search(self):
        plan = validate_turn_plan(
            TurnPlan(
                mode=ChatMode.ASK_NOTES,
                primary_intent=PrimaryIntent.GENERAL_CHAT,
                confidence=0.9,
            )
        )

        self.assertEqual(plan.context_sources, [ContextSource.KNOWLEDGE_BASE])

if __name__ == "__main__":
    unittest.main()
