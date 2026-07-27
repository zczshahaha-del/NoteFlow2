from __future__ import annotations

import unittest

from app.schemas.agent import AgentChatMessageIn
from app.memory.agent import (
    chat_history_for_memory,
    episode_summary_from_checkpoint,
    memory_context_from_records,
    memory_fallback_answer,
    memory_tool_context,
)


class AgentMemoryServiceTest(unittest.TestCase):
    def test_chat_history_is_trimmed_and_roles_are_normalized(self) -> None:
        history = [AgentChatMessageIn(role="assistant", text="old")]
        history.extend(AgentChatMessageIn(role="system", text=f"message-{index}") for index in range(9))

        result = chat_history_for_memory(history)

        self.assertEqual(len(result), 8)
        self.assertEqual(result[0].text, "message-1")
        self.assertTrue(all(item.role == "user" for item in result))

    def test_memory_context_and_tool_context_do_not_expose_internal_mechanics(self) -> None:
        records = [
            {"memoryType": "identity", "scope": "global", "content": "用户叫小程", "status": "active"},
            {
                "memoryType": "preference",
                "scope": "note_generation",
                "content": "偏好简洁表达",
                "status": "active",
            },
        ]

        context = memory_context_from_records(records)
        tool_context = memory_tool_context("list_memories", records, "我叫什么？")

        self.assertIn("用户叫小程", context)
        self.assertIn("偏好简洁表达", context)
        self.assertIn("不要提‘长期记忆’", tool_context)
        self.assertEqual(memory_fallback_answer("save_memory", records), "明白。")

    def test_episode_summary_captures_edit_outcome(self) -> None:
        event_type, summary, tags = episode_summary_from_checkpoint(
            "edit_preview",
            {"title": "周报", "instruction": "压缩第二节并保留结论", "noteId": "note-1"},
            "resolved",
        )

        self.assertEqual(event_type, "work_completed")
        self.assertIn("压缩第二节", summary)
        self.assertIn("edit_preview", tags)
        self.assertIn("note:note-1", tags)


if __name__ == "__main__":
    unittest.main()
