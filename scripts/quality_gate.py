from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SERVER_ROOT = ROOT / "server"
REPORT_ROOT = ROOT / "quality" / "reports"


@dataclass(frozen=True)
class GateCommand:
    category: str
    name: str
    command: list[str]
    cwd: Path = ROOT
    env: dict[str, str] | None = None


FRONTEND_COMMANDS = [
    GateCommand("frontend", "editor-roundtrip", ["npm", "run", "test:editor-roundtrip"]),
    GateCommand("frontend", "tiptap-codec", ["npm", "run", "test:tiptap-codec"]),
    GateCommand("frontend", "tiptap-selection", ["npm", "run", "test:tiptap-selection"]),
    GateCommand("frontend", "editor-compatibility", ["npm", "run", "test:editor-compatibility"]),
    GateCommand("frontend", "editor-ui-contract", ["npm", "run", "test:editor-ui"]),
    GateCommand("frontend", "wiki-links", ["npm", "run", "test:wiki-links"]),
    GateCommand("frontend", "knowledge-import", ["npm", "run", "test:knowledge-import"]),
    GateCommand("frontend", "markdown-diff", ["npm", "run", "test:markdown-diff"]),
    GateCommand("frontend", "offline-conflict", ["npm", "run", "test:offline-conflict"]),
    GateCommand("frontend", "component-store", ["npm", "run", "test:frontend"]),
    GateCommand("frontend", "pwa", ["npm", "run", "test:pwa"]),
    GateCommand("frontend", "editor-selection", ["npm", "run", "test:editor-selection"]),
    GateCommand("frontend", "input-composition", ["npm", "run", "test:input-composition"]),
]

BACKEND_COMMANDS = [
    GateCommand(
        "backend-unit",
        "unittest-discovery",
        [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"],
        cwd=SERVER_ROOT,
    ),
    GateCommand("backend-contract", "context-planner", [sys.executable, "check_context_planner.py"], cwd=SERVER_ROOT),
    GateCommand("backend-contract", "runtime-events", [sys.executable, "check_runtime_events.py"], cwd=SERVER_ROOT),
    GateCommand("backend-contract", "diagnostics", [sys.executable, "check_diagnostics.py"], cwd=SERVER_ROOT),
    GateCommand("backend-memory", "memory-stage1", [sys.executable, "check_memory_stage1.py"], cwd=SERVER_ROOT),
    GateCommand("backend-memory", "memory-stage2", [sys.executable, "check_memory_stage2.py"], cwd=SERVER_ROOT),
    GateCommand("backend-memory", "memory-stage3", [sys.executable, "check_memory_stage3.py"], cwd=SERVER_ROOT),
    GateCommand("backend-memory", "memory-stage4", [sys.executable, "check_memory_stage4.py"], cwd=SERVER_ROOT),
]

DATABASE_AND_EVAL_COMMANDS = [
    GateCommand(
        "database",
        "postgres-pgvector-integration",
        [sys.executable, "-m", "unittest", "tests.test_database_integration"],
        cwd=SERVER_ROOT,
        env={"NOTEFLOW_RUN_DB_TESTS": "1"},
    ),
    GateCommand("rag", "legacy-fixed-eval", [sys.executable, "scripts/run_rag_baseline.py"]),
    GateCommand("rag", "rag-v2-fixed-eval", [sys.executable, "scripts/run_rag_v2_eval.py"]),
    GateCommand("memory", "memory-safety-eval", [sys.executable, "scripts/run_memory_safety_eval.py"]),
]


def _run(command: GateCommand) -> dict:
    environment = os.environ.copy()
    environment.update(command.env or {})
    started = time.perf_counter()
    process = subprocess.run(
        command.command,
        cwd=command.cwd,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    duration = round(time.perf_counter() - started, 3)
    output = "\n".join(part.strip() for part in (process.stdout, process.stderr) if part.strip())
    return {
        "category": command.category,
        "name": command.name,
        "command": command.command,
        "cwd": str(command.cwd.relative_to(ROOT) or "."),
        "status": "passed" if process.returncode == 0 else "failed",
        "exitCode": process.returncode,
        "durationSeconds": duration,
        "outputTail": output[-4000:],
    }


def _write_markdown(report: dict, path: Path) -> None:
    lines = [
        "# NoteFlow 质量门禁报告",
        "",
        f"- Profile：`{report['profile']}`",
        f"- 执行时间：{report['generatedAt']}",
        f"- 总命令：{report['summary']['total']}",
        f"- 通过：{report['summary']['passed']}",
        f"- 失败：{report['summary']['failed']}",
        f"- 总耗时：{report['summary']['durationSeconds']} 秒",
        "",
        "| 分类 | 检查 | 结果 | 耗时（秒） |",
        "|---|---|---|---:|",
    ]
    for result in report["results"]:
        lines.append(
            f"| `{result['category']}` | `{result['name']}` | "
            f"{'通过' if result['status'] == 'passed' else '失败'} | {result['durationSeconds']} |"
        )
    failures = [result for result in report["results"] if result["status"] == "failed"]
    if failures:
        lines.extend(["", "## 失败输出", ""])
        for result in failures:
            lines.extend(
                [
                    f"### {result['category']} / {result['name']}",
                    "",
                    "```text",
                    result["outputTail"],
                    "```",
                    "",
                ]
            )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run categorized NoteFlow quality gates")
    parser.add_argument("--profile", choices=("fast", "full"), default="full")
    parser.add_argument("--include-live-ai", action="store_true")
    parser.add_argument("--report-name", default="quality-gate-latest")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-zA-Z0-9._-]+", args.report_name):
        parser.error("--report-name may contain only letters, digits, dot, underscore and dash")

    commands = [*FRONTEND_COMMANDS, *BACKEND_COMMANDS]
    if args.profile == "full":
        commands.extend(DATABASE_AND_EVAL_COMMANDS)
        commands.append(GateCommand("build", "production-build", ["npm", "run", "build"]))
    if args.include_live_ai:
        commands.append(GateCommand("e2e-live", "runtime-e2e", [sys.executable, "server/tests/runtime_e2e.py"]))

    results: list[dict] = []
    gate_started = time.perf_counter()
    for index, command in enumerate(commands, start=1):
        print(f"[{index}/{len(commands)}] {command.category}: {command.name}", flush=True)
        result = _run(command)
        results.append(result)
        print(f"  -> {result['status']} ({result['durationSeconds']}s)", flush=True)

    failed = sum(1 for result in results if result["status"] == "failed")
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "profile": args.profile + ("+live-ai" if args.include_live_ai else ""),
        "summary": {
            "total": len(results),
            "passed": len(results) - failed,
            "failed": failed,
            "durationSeconds": round(time.perf_counter() - gate_started, 3),
        },
        "results": results,
    }
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    json_path = REPORT_ROOT / f"{args.report_name}.json"
    markdown_path = REPORT_ROOT / f"{args.report_name}.md"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    _write_markdown(report, markdown_path)
    print(json.dumps(report["summary"], ensure_ascii=False))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
