import unittest
from unittest.mock import patch

from app.services.prompt_templates import render_prompt


class PromptTemplateTest(unittest.TestCase):
    def test_render_keeps_literal_user_text_and_logs_only_template_identity(self):
        document = "私有笔记包含 {{memory}}"
        with patch("app.services.prompt_templates.structured_log") as log:
            rendered = render_prompt("chat/memory-context", memory="合成偏好", document=document)
        self.assertIn(document, rendered)
        self.assertIn("合成偏好", rendered)
        self.assertEqual(log.call_args.args[-1], "prompt.rendered")
        self.assertEqual(log.call_args.kwargs["prompt_name"], "chat/memory-context")
        self.assertEqual(log.call_args.kwargs["prompt_version"], "v1")
        self.assertRegex(log.call_args.kwargs["prompt_digest"], r"^[a-f0-9]{64}$")
        self.assertEqual(set(log.call_args.kwargs), {"prompt_name", "prompt_version", "prompt_digest"})

    def test_render_rejects_missing_extra_and_unregistered_inputs(self):
        with self.assertRaisesRegex(ValueError, "missing"):
            render_prompt("chat/memory-context", memory="合成偏好")
        with self.assertRaisesRegex(ValueError, "unexpected"):
            render_prompt("memory/default-mission", query="不接受")
        with self.assertRaises(ValueError):
            render_prompt("../memory/default-mission")
