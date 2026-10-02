from __future__ import annotations

import unittest
from unittest.mock import patch

from app.config import cfg
from app.services.ai import _completion_body


class AIThinkingModeTest(unittest.TestCase):
    def test_model_comes_from_configuration(self) -> None:
        for model in ("deepseek-flash", "deepseek-v4-pro"):
            with self.subTest(model=model), patch.object(cfg, "DEEPSEEK_MODEL", model):
                body = _completion_body(
                    messages=[{"role": "user", "content": "只回复 OK"}],
                    stream=True,
                    max_tokens=1200,
                    temperature=0.35,
                )
                self.assertEqual(body["model"], model)

    def test_flash_json_requests_keep_existing_nonthinking_policy(self) -> None:
        with patch.object(cfg, "DEEPSEEK_MODEL", "deepseek-flash"):
            body = _completion_body(
                messages=[{"role": "user", "content": "只返回 JSON"}],
                stream=False,
                max_tokens=1200,
                temperature=0.0,
                thinking="disabled",
                response_format={"type": "json_object"},
            )
        self.assertEqual(body["model"], "deepseek-flash")
        self.assertFalse(body["stream"])
        self.assertEqual(body["thinking"], {"type": "disabled"})
        self.assertEqual(body["response_format"], {"type": "json_object"})

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
