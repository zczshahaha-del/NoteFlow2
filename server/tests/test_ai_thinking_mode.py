from __future__ import annotations

import unittest

from app.services.ai import _completion_body


class AIThinkingModeTest(unittest.TestCase):
    def test_note_generation_can_explicitly_disable_thinking(self) -> None:
        body = _completion_body(
            messages=[{"role": "user", "content": "生成大纲"}],
            stream=True,
            max_tokens=1200,
            temperature=0.35,
            thinking="disabled",
        )
        self.assertEqual(body["thinking"], {"type": "disabled"})

    def test_other_calls_keep_provider_default_without_override(self) -> None:
        body = _completion_body(
            messages=[{"role": "user", "content": "复杂分析"}],
            stream=True,
            max_tokens=1200,
            temperature=0.35,
        )
        self.assertNotIn("thinking", body)


if __name__ == "__main__":
    unittest.main()
