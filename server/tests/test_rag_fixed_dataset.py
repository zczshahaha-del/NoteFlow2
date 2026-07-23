from __future__ import annotations

import json
import unittest
from pathlib import Path


DATASET = Path(__file__).resolve().parents[2] / "quality" / "eval" / "rag_cases.json"


class RagFixedDatasetTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.dataset = json.loads(DATASET.read_text(encoding="utf-8"))

    def test_required_rag_scenarios_are_frozen(self) -> None:
        case_ids = {case["id"] for case in self.dataset["cases"]}
        self.assertTrue(
            {
                "zh-short-query",
                "english-acronym",
                "code-symbol",
                "same-title-current",
                "no-answer",
                "cross-user-probe",
            }.issubset(case_ids)
        )

    def test_every_note_key_reference_exists(self) -> None:
        note_keys = {item["key"] for item in self.dataset["corpus"]}
        for case in self.dataset["cases"]:
            with self.subTest(case=case["id"]):
                referenced = set(case.get("expectedNoteKeys") or []) | set(case.get("forbiddenNoteKeys") or [])
                self.assertTrue(referenced.issubset(note_keys))

    def test_cross_user_probe_is_security_critical(self) -> None:
        case = next(item for item in self.dataset["cases"] if item["id"] == "cross-user-probe")
        self.assertTrue(case["securityCritical"])
        self.assertTrue(case["expectNoResults"])
        self.assertTrue(case["forbiddenNoteKeys"])


if __name__ == "__main__":
    unittest.main()
