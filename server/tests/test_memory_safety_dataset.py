from __future__ import annotations

import json
import unittest
from pathlib import Path

from app.services.memory import extract_memory_candidates, memory_candidate_status


DATASET = Path(__file__).resolve().parents[2] / "quality" / "eval" / "memory_safety_cases.json"


class MemorySafetyDatasetTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.dataset = json.loads(DATASET.read_text(encoding="utf-8"))

    def test_required_safety_categories_are_frozen(self) -> None:
        categories = {case["category"] for case in self.dataset["cases"]}
        self.assertTrue(
            {"明确记住", "临时指令", "第三方信息", "纠正", "删除", "关闭开关", "敏感凭据"}.issubset(categories)
        )

    def test_non_gap_extract_cases_match_legacy_baseline(self) -> None:
        for case in self.dataset["cases"]:
            if case["evaluateMode"] != "extract" or case.get("knownBaselineGap"):
                continue
            with self.subTest(case=case["id"]):
                candidates = extract_memory_candidates(case["input"], "global")
                saved = [candidate for candidate in candidates if memory_candidate_status(candidate) != "rejected"]
                self.assertEqual(bool(saved), case["expectedSave"])
                if saved and case.get("expectedType"):
                    self.assertIn(case["expectedType"], {candidate.memory_type for candidate in saved})
                if saved and case.get("expectedCanonicalKey"):
                    self.assertIn(case["expectedCanonicalKey"], {candidate.canonical_key for candidate in saved})


if __name__ == "__main__":
    unittest.main()
