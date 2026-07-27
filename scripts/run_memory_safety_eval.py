from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SERVER_ROOT = ROOT / "server"
DATASET = ROOT / "quality" / "eval" / "memory_safety_cases.json"
THRESHOLDS = ROOT / "quality" / "baseline-thresholds.json"
REPORT_JSON = ROOT / "quality" / "reports" / "memory-safety-baseline.json"
REPORT_MD = ROOT / "quality" / "reports" / "memory-safety-baseline.md"


def _evaluate_extract(case: dict) -> dict:
    from app.memory.domain import extract_memory_candidates, memory_candidate_status

    candidates = extract_memory_candidates(case["input"], "global")
    saved = [candidate for candidate in candidates if memory_candidate_status(candidate) != "rejected"]
    actual_save = bool(saved)
    passed = actual_save == bool(case["expectedSave"])
    reasons: list[str] = []
    if actual_save != bool(case["expectedSave"]):
        reasons.append(f"expectedSave={case['expectedSave']} actualSave={actual_save}")
    if case.get("expectedType") and actual_save:
        actual_types = [candidate.memory_type for candidate in saved]
        if case["expectedType"] not in actual_types:
            passed = False
            reasons.append(f"expectedType={case['expectedType']} actualTypes={actual_types}")
    if case.get("expectedCanonicalKey") and actual_save:
        actual_keys = [candidate.canonical_key for candidate in saved]
        if case["expectedCanonicalKey"] not in actual_keys:
            passed = False
            reasons.append(f"expectedCanonicalKey={case['expectedCanonicalKey']} actualKeys={actual_keys}")
    return {
        "passed": passed,
        "actualSave": actual_save,
        "actualTypes": [candidate.memory_type for candidate in saved],
        "actualCanonicalKeys": [candidate.canonical_key for candidate in saved],
        "reasons": reasons,
    }


def _evaluate_manage(case: dict) -> dict:
    from app.services.context_planner import fallback_context_plan

    plan = fallback_context_plan(case["input"])
    actual_action = plan.memory_action if plan.primary_intent == "memory_manage" else "none"
    expected_action = case["expectedAction"]
    return {
        "passed": actual_action == expected_action,
        "actualIntent": plan.primary_intent,
        "actualAction": actual_action,
        "reasons": [] if actual_action == expected_action else [f"expectedAction={expected_action} actualAction={actual_action}"],
    }


def _write_markdown(report: dict) -> None:
    lines = [
        "# NoteFlow Memory 安全评测基线",
        "",
        f"- 数据集：`{report['datasetVersion']}`",
        f"- 总用例：{report['summary']['total']}",
        f"- 通过：{report['summary']['passed']}",
        f"- 已登记基线缺口：{report['summary']['knownGaps']}",
        f"- 非预期失败：{report['summary']['unexpectedFailures']}",
        "",
        "| 用例 | 分类 | 预期 | 实际 | 结果 | 基线缺口 |",
        "|---|---|---|---|---|---|",
    ]
    for item in report["results"]:
        if item["evaluateMode"] == "manage":
            expected = item.get("expectedAction")
            actual = item.get("actualAction")
        else:
            expected = item.get("expectedSave")
            actual = item.get("actualSave")
        lines.append(
            f"| `{item['id']}` | {item['category']} | `{expected}` | `{actual}` | "
            f"{'通过' if item['passed'] else '失败'} | {'是' if item['knownBaselineGap'] else '否'} |"
        )
    lines.extend(
        [
            "",
            "## 当前已登记缺口",
            "",
            "- 无。敏感信息拦截、自然语言删除和关闭记忆均已纳入强制门禁。",
            "",
        ]
    )
    REPORT_MD.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--enforce", action="store_true", help="已登记缺口也视为失败")
    args = parser.parse_args()

    sys.path.insert(0, str(SERVER_ROOT))
    dataset = json.loads(DATASET.read_text(encoding="utf-8"))
    thresholds = json.loads(THRESHOLDS.read_text(encoding="utf-8"))
    allowed = set(thresholds["memory"]["allowedKnownGapIds"])
    results: list[dict] = []
    for case in dataset["cases"]:
        evaluation = _evaluate_extract(case) if case["evaluateMode"] == "extract" else _evaluate_manage(case)
        results.append(
            {
                "id": case["id"],
                "category": case["category"],
                "evaluateMode": case["evaluateMode"],
                "expectedSave": case.get("expectedSave"),
                "expectedAction": case.get("expectedAction"),
                "knownBaselineGap": bool(case.get("knownBaselineGap")),
                **evaluation,
            }
        )

    failures = [item for item in results if not item["passed"]]
    known = [item for item in failures if item["knownBaselineGap"] and item["id"] in allowed]
    unexpected = [item for item in failures if item not in known]
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "datasetVersion": dataset["version"],
        "summary": {
            "total": len(results),
            "passed": len(results) - len(failures),
            "knownGaps": len(known),
            "unexpectedFailures": len(unexpected),
        },
        "results": results,
    }
    REPORT_JSON.parent.mkdir(parents=True, exist_ok=True)
    REPORT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    _write_markdown(report)
    print(json.dumps(report["summary"], ensure_ascii=False))
    return 1 if unexpected or (args.enforce and failures) else 0


if __name__ == "__main__":
    raise SystemExit(main())
