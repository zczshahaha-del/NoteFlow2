from __future__ import annotations

import argparse
import asyncio
import json
import os
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPORT_ROOT = ROOT / "quality" / "reports"
STAGES = ("internal", "1", "5", "20", "50", "100", "observation")


def stage_environment(stage: str) -> dict[str, str]:
    percent = 100 if stage in {"100", "observation"} else 0 if stage == "internal" else int(stage)
    full = percent == 100
    return {
        "AGENT_RUNTIME": "langgraph",
        "LANGGRAPH_CANARY_ENABLED": "true",
        "LANGGRAPH_CANARY_PERCENT": str(percent),
        "RAG_PROVIDER": "llamaindex" if full else "legacy",
        "RAG_V2_INDEX_ENABLED": "true",
        "MEMORY_PROVIDER": "mem0",
        "MEM0_CANARY_ENABLED": "true",
        "MEM0_CANARY_PERCENT": str(percent),
        "DRAFT_RUNTIME": "langgraph" if full else "legacy",
        "EDIT_RUNTIME": "langgraph" if full else "legacy",
    }


ROLLBACK_ENV = {
    "AGENT_RUNTIME": "legacy",
    "LANGGRAPH_CANARY_ENABLED": "false",
    "LANGGRAPH_CANARY_PERCENT": "0",
    "RAG_PROVIDER": "legacy",
    "RAG_V2_INDEX_ENABLED": "false",
    "MEMORY_PROVIDER": "legacy",
    "MEM0_CANARY_ENABLED": "false",
    "MEM0_CANARY_PERCENT": "0",
    "DRAFT_RUNTIME": "legacy",
    "EDIT_RUNTIME": "legacy",
}


async def database_snapshot() -> dict:
    import asyncpg

    connection = await asyncpg.connect(
        host=os.environ.get("DB_HOST", "127.0.0.1"),
        port=int(os.environ.get("DB_PORT", "5433")),
        user=os.environ.get("DB_USER", "noteflow"),
        password=os.environ.get("DB_PASSWORD", "noteflow_password"),
        database=os.environ.get("DB_NAME", "noteflow"),
    )
    queries = {
        "agentShadow": """
            select count(*)::int total,
                   count(*) filter (where hard_violation)::int hard,
                   count(*) filter (where status not in ('success','completed'))::int failed
              from agent_shadow_runs where created_at >= now() - interval '24 hours'
        """,
        "memoryShadow": """
            select count(*)::int total,
                   count(*) filter (where hard_violation)::int hard,
                   count(*) filter (where status <> 'success')::int failed
              from memory_shadow_runs where created_at >= now() - interval '24 hours'
        """,
        "outbox": """
            select count(*)::int total,
                   count(*) filter (where status in ('pending','processing'))::int pending,
                   count(*) filter (where status = 'failed')::int failed
              from integration_outbox
        """,
        "indexJobs": """
            select count(*)::int total,
                   count(*) filter (where status in ('pending','processing'))::int pending,
                   count(*) filter (where status = 'failed')::int failed
              from note_index_jobs
        """,
        "ragQueries": """
            select count(*)::int total,
                   count(*) filter (where result_count = 0)::int empty,
                   coalesce(round(avg(latency_ms)::numeric, 2), 0)::float average_latency_ms
              from rag_query_logs where created_at >= now() - interval '24 hours'
        """,
    }
    try:
        result = {}
        for name, query in queries.items():
            row = await connection.fetchrow(query)
            result[name] = dict(row) if row else {}
        return result
    finally:
        await connection.close()


def api_health(base_url: str) -> dict:
    with urllib.request.urlopen(base_url.rstrip("/") + "/api/health", timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def evaluate(snapshot: dict, health: dict, *, require_samples: bool) -> tuple[bool, list[str]]:
    blockers: list[str] = []
    if not health.get("ok"):
        blockers.append("API/PostgreSQL health is not ready")
    for name in ("agentShadow", "memoryShadow"):
        item = snapshot[name]
        if item.get("hard", 0):
            blockers.append(f"{name} has {item['hard']} hard violation(s)")
        if item.get("total", 0) and item.get("failed", 0) / item["total"] > 0.01:
            blockers.append(f"{name} failure rate exceeds 1%")
        if require_samples and item.get("total", 0) < 20:
            blockers.append(f"{name} has fewer than 20 observations in 24h")
    for name in ("outbox", "indexJobs"):
        item = snapshot[name]
        if item.get("failed", 0):
            blockers.append(f"{name} has {item['failed']} failed item(s)")
    return not blockers, blockers


def write_report(report: dict, name: str) -> None:
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    (REPORT_ROOT / f"{name}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# NoteFlow 生产灰度门禁",
        "",
        f"- 时间：{report['generatedAt']}",
        f"- 目标档位：`{report['stage']}`",
        f"- 结论：`{'PASS' if report['ready'] else 'BLOCKED'}`",
        f"- 检查模式：`{'真实生产观察' if report['requireSamples'] else '发布候选演练'}`",
        "",
        "## 目标配置",
        "",
        "```env",
        *[f"{key}={value}" for key, value in report["targetEnvironment"].items()],
        "```",
        "",
        "## 指标快照",
        "",
        "```json",
        json.dumps(report["snapshot"], ensure_ascii=False, indent=2),
        "```",
        "",
        "## 阻塞项",
        "",
        *([f"- {item}" for item in report["blockers"]] or ["- 无"]),
        "",
        "## 一键逻辑回退配置",
        "",
        "```env",
        *[f"{key}={value}" for key, value in ROLLBACK_ENV.items()],
        "```",
    ]
    (REPORT_ROOT / f"{name}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect a NoteFlow rollout stage without mutating deployment state")
    parser.add_argument("--stage", choices=STAGES, required=True)
    parser.add_argument("--base-url", default="http://127.0.0.1:8080")
    parser.add_argument("--candidate-drill", action="store_true", help="allow an isolated release candidate with no production sample history")
    parser.add_argument("--report-name", default="steps-20-rollout-readiness")
    args = parser.parse_args()
    snapshot = asyncio.run(database_snapshot())
    health = api_health(args.base_url)
    require_samples = not args.candidate_drill
    ready, blockers = evaluate(snapshot, health, require_samples=require_samples)
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "stage": args.stage,
        "requireSamples": require_samples,
        "ready": ready,
        "blockers": blockers,
        "targetEnvironment": stage_environment(args.stage),
        "rollbackEnvironment": ROLLBACK_ENV,
        "snapshot": snapshot,
        "health": {"ok": health.get("ok"), "status": health.get("status")},
        "mutationPerformed": False,
    }
    write_report(report, args.report_name)
    print(json.dumps({"ready": ready, "blockers": blockers, "target": report["targetEnvironment"]}, ensure_ascii=False))
    return 0 if ready else 2


if __name__ == "__main__":
    raise SystemExit(main())
