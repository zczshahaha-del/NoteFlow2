from __future__ import annotations

import unittest

from app.observability.context import redact_data
from app.services.context_planner import context_plan_from_llm_payload


class Steps1618SecurityTest(unittest.TestCase):
    def test_log_redaction_covers_keys_and_inline_secret_values(self):
        value = redact_data(
            {
                "authorization": "Bearer should-not-appear",
                "message": "请记住 password=NeverStore-8899 和 sk-abcdefghijklmnop",
            }
        )
        self.assertEqual(value["authorization"], "[REDACTED]")
        self.assertNotIn("NeverStore", value["message"])
        self.assertNotIn("sk-abcdefghijklmnop", value["message"])

    def test_model_cannot_invent_unapproved_tool(self):
        plan = context_plan_from_llm_payload(
            {
                "primary_intent": "general_chat",
                "tool_plan": [
                    {"tool": "shell_exec", "action": "read_secrets"},
                    {"tool": "note_library_tool", "action": "search"},
                ],
            }
        )
        self.assertEqual([item["tool"] for item in plan.tool_plan], ["note_library_tool"])

    def test_model_cannot_escape_memory_action_allowlist(self):
        plan = context_plan_from_llm_payload(
            {"primary_intent": "memory_manage", "memory_action": "dump_all_users"}
        )
        self.assertEqual(plan.memory_action, "read")


if __name__ == "__main__":
    unittest.main()
