from __future__ import annotations

import os
from pathlib import Path
import runpy
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]


class ModelConfigTest(unittest.TestCase):
    def _model(self, value: str) -> str:
        # Do not load local credentials or change the application's cfg singleton.
        with patch("pathlib.Path.exists", return_value=False), patch.dict(
            os.environ, {"DEEPSEEK_MODEL": value}
        ):
            config = runpy.run_path(str(ROOT / "server/app/config.py"))
        return config["cfg"].DEEPSEEK_MODEL

    def test_missing_model_uses_flash(self) -> None:
        with patch.dict(os.environ):
            os.environ.pop("DEEPSEEK_MODEL", None)
            with patch("pathlib.Path.exists", return_value=False):
                config = runpy.run_path(str(ROOT / "server/app/config.py"))
        self.assertEqual(config["cfg"].DEEPSEEK_MODEL, "deepseek-flash")

    def test_blank_model_uses_flash(self) -> None:
        self.assertEqual(self._model("  "), "deepseek-flash")

    def test_explicit_model_is_preserved(self) -> None:
        self.assertEqual(self._model("deepseek-v4-pro"), "deepseek-v4-pro")

    def test_setup_examples_use_canonical_flash_name(self) -> None:
        for relative in (".env.example", "server/.env.example", "server/README.md"):
            with self.subTest(path=relative):
                text = (ROOT / relative).read_text()
                self.assertIn("DEEPSEEK_MODEL=deepseek-flash", text)
                self.assertNotIn("DEEPSEEK_MODEL=deepseek-chat", text)


if __name__ == "__main__":
    unittest.main()
