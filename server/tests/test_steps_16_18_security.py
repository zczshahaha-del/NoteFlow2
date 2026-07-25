from __future__ import annotations

import unittest

from app.observability.context import redact_data
from pydantic import ValidationError

from app.services.turn_planner import plan_from_llm_payload


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
        with self.assertRaises(ValidationError):
            plan_from_llm_payload(
                {
                    "primary_intent": "general_chat",
                    "intent_parameters": {},
                    "context_sources": [],
                    "confidence": 0.9,
                    "reason": "test",
                    "tool_plan": [
                        {"tool": "shell_exec", "action": "read_secrets"},
                    ],
                },
                mode="chat",
            )

    def test_model_cannot_escape_memory_action_allowlist(self):
        with self.assertRaises(ValidationError):
            plan_from_llm_payload(
                {
                    "primary_intent": "memory",
                    "intent_parameters": {"memory_action": "dump_all_users"},
                    "context_sources": ["user_memory"],
                    "confidence": 0.9,
                    "reason": "test",
                },
                mode="chat",
            )


if __name__ == "__main__":
    unittest.main()
