from __future__ import annotations

import argparse
import asyncio
import concurrent.futures
import http.cookiejar
import json
import os
import statistics
import time
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SERVER_ROOT = ROOT / "server"
REPORT_ROOT = ROOT / "quality" / "reports"


def stats(values: list[float]) -> dict:
    ordered = sorted(values)
    p95 = ordered[round((len(ordered) - 1) * 0.95)] if ordered else 0
    return {
        "samples": len(values),
        "p50Ms": round(statistics.median(values), 2) if values else 0,
        "p95Ms": round(p95, 2),
        "maxMs": round(max(values), 2) if values else 0,
    }


class Client:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def json(self, method: str, path: str, payload: dict | None = None, timeout: int = 60) -> tuple[dict, float]:
        body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode()
        request = urllib.request.Request(
            self.base_url + path,
            data=body,
            method=method,
            headers={"Content-Type": "application/json", "User-Agent": "NoteFlow-Release-Acceptance/1.0"},
        )
        started = time.perf_counter()
        with self.opener.open(request, timeout=timeout) as response:
            raw = response.read().decode()
        return (json.loads(raw) if raw else {}), (time.perf_counter() - started) * 1000


async def cleanup(email: str) -> None:
    import asyncpg

    connection = await asyncpg.connect(
        host=os.environ.get("DB_HOST", "127.0.0.1"), port=int(os.environ.get("DB_PORT", "5433")),
        user=os.environ.get("DB_USER", "noteflow"), password=os.environ.get("DB_PASSWORD", "noteflow_password"),
        database=os.environ.get("DB_NAME", "noteflow"),
    )
    try:
        await connection.execute("delete from users where email = $1", email)
    finally:
        await connection.close()


def wait_index(client: Client, note_id: str, timeout: int = 60) -> float:
    started = time.perf_counter()
    deadline = started + timeout
    while time.perf_counter() < deadline:
        result, _ = client.json("GET", f"/api/index-jobs?noteId={note_id}")
        jobs = result.get("jobs") or []
        if jobs and jobs[0].get("status") == "success":
            return (time.perf_counter() - started) * 1000
        if jobs and jobs[0].get("status") == "failed":
            raise RuntimeError(jobs[0].get("errorMessage") or "index failed")
        time.sleep(0.1)
    raise TimeoutError(note_id)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8080")
    parser.add_argument("--notes", type=int, default=30)
    parser.add_argument("--concurrency", type=int, default=12)
    parser.add_argument("--report-name", default="steps-19-release-acceptance")
    args = parser.parse_args()
    run_id = uuid.uuid4().hex[:10]
    email = f"release-{run_id}@local.test"
    client = Client(args.base_url)
    latency: dict[str, list[float]] = {"createNote": [], "index": [], "search": [], "concurrentList": [], "longNote": []}
    errors: list[str] = []
    asyncio.run(cleanup(email))
    try:
        client.json("POST", "/api/auth/register", {"email": email, "password": "NoteFlow-Release-2026!", "displayName": "Release Acceptance"})
        marker = f"RELEASE_ACCEPTANCE_{run_id}"
        note_ids: list[str] = []
        for index in range(max(1, min(args.notes, 100))):
            created, duration = client.json("POST", "/api/notes", {"title": f"验收笔记 {index}", "tags": ["release"], "content": f"# 验收\n\n{marker} 第 {index} 篇。"})
            note_ids.append(created["note"]["id"])
            latency["createNote"].append(duration)
        for note_id in note_ids:
            latency["index"].append(wait_index(client, note_id))
        long_content = "# 长笔记\n\n" + ("NoteFlow 长笔记压力段落。\n\n" * 6000)
        long_created, duration = client.json("POST", "/api/notes", {"title": "长笔记验收", "tags": ["release", "long"], "content": long_content})
        latency["longNote"].append(duration)
        latency["index"].append(wait_index(client, long_created["note"]["id"]))
        for _ in range(20):
            result, duration = client.json("POST", "/api/notes/search", {"query": marker, "limit": 8})
            if not result.get("results"):
                errors.append("search returned no results")
            latency["search"].append(duration)

        def list_once(_: int) -> float:
            _, elapsed = client.json("GET", "/api/notes")
            return elapsed

        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(args.concurrency, 32))) as pool:
            for future in concurrent.futures.as_completed([pool.submit(list_once, index) for index in range(60)]):
                try:
                    latency["concurrentList"].append(future.result())
                except Exception as exc:
                    errors.append(type(exc).__name__)
        metrics, _ = client.json("GET", "/api/metrics")
        report = {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "baseUrl": args.base_url,
            "workload": {"notes": len(note_ids), "longNoteCharacters": len(long_content), "concurrency": args.concurrency},
            "latency": {name: stats(values) for name, values in latency.items()},
            "providerUsage": metrics.get("providerUsage", {}),
            "domainMetrics": metrics.get("domains", {}),
            "errors": errors,
            "passed": not errors,
        }
        REPORT_ROOT.mkdir(parents=True, exist_ok=True)
        (REPORT_ROOT / f"{args.report_name}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        lines = [
            "# NoteFlow 步骤 19 发布候选压测与成本统计",
            "",
            f"- 结果：`{'PASS' if report['passed'] else 'FAIL'}`",
            f"- 笔记：{len(note_ids)}；长笔记：{len(long_content)} 字符；并发：{args.concurrency}",
            "",
            "| 指标 | 样本 | p50 | p95 | 最大 |",
            "|---|---:|---:|---:|---:|",
        ]
        for name, value in report["latency"].items():
            lines.append(f"| `{name}` | {value['samples']} | {value['p50Ms']} ms | {value['p95Ms']} ms | {value['maxMs']} ms |")
        lines.extend(["", "## Provider token / 调用 / 费用", "", "```json", json.dumps(report["providerUsage"], ensure_ascii=False, indent=2), "```", "", "费用为环境变量单价 × 实际/估算 token；单价为 0 时只统计用量，不虚构供应商费用。", ""])
        (REPORT_ROOT / f"{args.report_name}.md").write_text("\n".join(lines), encoding="utf-8")
        print(json.dumps({"passed": report["passed"], "latency": report["latency"], "providerUsage": report["providerUsage"]}, ensure_ascii=False))
        return 0 if report["passed"] else 1
    finally:
        asyncio.run(cleanup(email))


if __name__ == "__main__":
    raise SystemExit(main())
