import json
import shutil
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from app.config import cfg
from app.services.prompt_templates import ROOT, activate_prompt_release, render_prompt


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

    def test_atomic_activation_changes_live_output_and_rejects_incompatible_release(self):
        baseline = render_prompt("memory/default-mission")
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            shutil.copytree(ROOT, root / "v1")
            shutil.copytree(ROOT, root / "v2")
            manifest_path = root / "v2" / "versions.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["memory/default-mission"] = "v2"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            (root / "v2/memory/default-mission.v2.md").write_text("只记学习偏好。", encoding="utf-8")
            shutil.copytree(ROOT, root / "v3")
            (root / "v3/memory/default-mission.v1.md").write_text("{{unknown}}", encoding="utf-8")
            with patch.object(cfg, "PROMPT_RELEASE_ROOT", tmp):
                activate_prompt_release(root, "v1")
                self.assertEqual(render_prompt("memory/default-mission"), baseline)
                activate_prompt_release(root, "v2")
                self.assertEqual(render_prompt("memory/default-mission"), "只记学习偏好。")
                with self.assertRaisesRegex(ValueError, "Prompt variables changed"):
                    activate_prompt_release(root, "v3")
                self.assertEqual(render_prompt("memory/default-mission"), "只记学习偏好。")
                activate_prompt_release(root, "v1")
                self.assertEqual(render_prompt("memory/default-mission"), baseline)
