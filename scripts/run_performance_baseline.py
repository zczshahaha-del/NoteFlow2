from __future__ import annotations

import argparse
import asyncio
import http.cookiejar
import json
import statistics
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER_ROOT = ROOT / "server"
REPORT_JSON = ROOT / "quality" / "reports" / "performance-baseline.json"
REPORT_MD = ROOT / "quality" / "reports" / "performance-baseline.md"


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, round((len(ordered) - 1) * percentile)))
    return round(ordered[index], 2)


def _stats(values: list[float]) -> dict:
    return {
        "samples": len(values),
        "p50": round(statistics.median(values), 2) if values else 0.0,
        "p95": _percentile(values, 0.95),
        "min": round(min(values), 2) if values else 0.0,
        "max": round(max(values), 2) if values else 0.0,
    }


class Client:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))

    def json(self, method: str, path: str, payload: dict | None = None) -> tuple[dict, float]:
        body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            self.base_url + path,
            data=body,
            method=method,
            headers={"Content-Type": "application/json", "User-Agent": "NoteFlow-Performance-Baseline/1.0"},
        )
        started = time.perf_counter()
        with self.opener.open(request, timeout=90) as response:
            raw = response.read().decode("utf-8")
        return (json.loads(raw) if raw else {}), (time.perf_counter() - started) * 1000

    def first_token(self, question: str) -> float:
        request = urllib.request.Request(
            self.base_url + "/api/agent/chat",
            data=json.dumps(
                {
                    "question": question,
                    "history": [],
                    "memoryEnabled": False,
                    "mode": "chat",
                },
                ensure_ascii=False,
            ).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
        )
        started = time.perf_counter()
        first_token_ms: float | None = None
        with self.opener.open(request, timeout=90) as response:
            while True:
                line = response.readline()
                if not line:
                    break
                text = line.decode("utf-8").strip()
                if not text.startswith("data: ") or text == "data: [DONE]":
                    continue
                data = json.loads(text[6:])
                choices = data.get("choices") or []
                content = choices[0].get("delta", {}).get("content", "") if choices else ""
                if content and first_token_ms is None:
                    first_token_ms = (time.perf_counter() - started) * 1000
        if first_token_ms is None:
            raise RuntimeError("AI stream ended without a text token")
        return first_token_ms


async def _embedding_samples(count: int) -> list[float]:
    sys.path.insert(0, str(SERVER_ROOT))
    from app.services.embeddings import embed_texts

    values: list[float] = []
    for index in range(count):
        started = time.perf_counter()
        await embed_texts([f"NoteFlow 性能基线 embedding 样本 {index}"])
        values.append((time.perf_counter() - started) * 1000)
    return values


async def _cleanup_user(email: str) -> None:
    sys.path.insert(0, str(SERVER_ROOT))
    import asyncpg
    from app.config import cfg

    connection = await asyncpg.connect(
        host=cfg.DB_HOST,
        port=int(cfg.DB_PORT),
        user=cfg.DB_USER,
        password=cfg.DB_PASSWORD,
        database=cfg.DB_NAME,
    )
    try:
        await connection.execute("delete from users where email = $1", email)
    finally:
        await connection.close()


def _wait_for_index(client: Client, note_id: str, timeout: float = 45.0) -> float:
    started = time.perf_counter()
    deadline = started + timeout
    while time.perf_counter() < deadline:
        data, _ = client.json("GET", f"/api/index-jobs?noteId={note_id}")
        jobs = data.get("jobs") or []
        if jobs and jobs[0].get("status") == "success":
            return (time.perf_counter() - started) * 1000
        if jobs and jobs[0].get("status") == "failed":
            raise RuntimeError(f"index failed: {jobs[0].get('errorMessage')}")
        time.sleep(0.1)
    raise TimeoutError(f"index timeout: {note_id}")


def _write_markdown(report: dict) -> None:
    values = report["latencyMs"]
    lines = [
        "# NoteFlow 性能基线",
        "",
        f"执行时间：{report['generatedAt']}",
        "",
        "| 指标 | 样本 | p50 | p95 | 最小 | 最大 |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for name, stats in values.items():
        lines.append(
            f"| `{name}` | {stats['samples']} | {stats['p50']} ms | {stats['p95']} ms | {stats['min']} ms | {stats['max']} ms |"
        )
    lines.extend(
        [
            "",
            "## 口径",
            "",
            "- `healthApi`：包含 PostgreSQL/Redis 诊断的 `/api/health` 往返时间。",
            "- `authenticatedNotesApi`：登录后 `/api/notes` 往返时间。",
            "- `retrievalApi`：固定测试笔记的 `/api/notes/search` 往返时间。",
            "- `workerIndexWithoutEmbedding`：API 创建笔记后到索引任务 success，测试服务使用 `EMBEDDING_PROVIDER=none`。",
            "- `embeddingExternal`：直接调用当前 DashScope `text-embedding-v4` 单文本请求。",
            "- `firstTokenExternal`：直接 Chat SSE 从发起请求到首个文本 token，使用当前 DeepSeek 模型。",
            "- 当前样本用于冻结 legacy 数量级，不代表生产容量压测；步骤 19 再执行并发与长时间压测。",
            "",
        ]
    )
    REPORT_MD.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8080")
    parser.add_argument("--samples", type=int, default=3)
    parser.add_argument("--skip-external", action="store_true")
    args = parser.parse_args()
    samples = max(1, min(args.samples, 20))

    run_id = uuid.uuid4().hex[:10]
    email = f"noteflow-performance-{run_id}@local.test"
    password = "NoteFlow-Performance-2026!"
    client = Client(args.base_url)
    latency: dict[str, list[float]] = {
        "healthApi": [],
        "authenticatedNotesApi": [],
        "retrievalApi": [],
        "workerIndexWithoutEmbedding": [],
        "embeddingExternal": [],
        "firstTokenExternal": [],
    }
    asyncio.run(_cleanup_user(email))
    try:
        for _ in range(samples * 3):
            _, duration = client.json("GET", "/api/health")
            latency["healthApi"].append(duration)

        client.json(
            "POST",
            "/api/auth/register",
            {"email": email, "password": password, "displayName": "Performance Baseline"},
        )
        for _ in range(samples * 3):
            _, duration = client.json("GET", "/api/notes")
            latency["authenticatedNotesApi"].append(duration)

        note_ids: list[str] = []
        marker = f"PERF_RETRIEVAL_{run_id}"
        for index in range(samples):
            created, _ = client.json(
                "POST",
                "/api/notes",
                {
                    "title": f"性能基线笔记 {index}",
                    "tags": ["performance"],
                    "content": f"# 性能基线\n\n{marker} 样本 {index}，用于检索与 worker 延迟测试。",
                },
            )
            note_id = created["note"]["id"]
            note_ids.append(note_id)
            latency["workerIndexWithoutEmbedding"].append(_wait_for_index(client, note_id))

        for _ in range(samples * 3):
            _, duration = client.json("POST", "/api/notes/search", {"query": marker, "limit": 8})
            latency["retrievalApi"].append(duration)

        if not args.skip_external:
            latency["embeddingExternal"] = asyncio.run(_embedding_samples(samples))
            for index in range(samples):
                latency["firstTokenExternal"].append(
                    client.first_token(f"只回复 PERF_TOKEN_{run_id}_{index}，不要添加其他内容。")
                )

        report = {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "baseUrl": args.base_url,
            "samples": samples,
            "latencyMs": {name: _stats(values) for name, values in latency.items()},
        }
        REPORT_JSON.parent.mkdir(parents=True, exist_ok=True)
        REPORT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        _write_markdown(report)
        print(json.dumps(report["latencyMs"], ensure_ascii=False))
        return 0
    finally:
        asyncio.run(_cleanup_user(email))


if __name__ == "__main__":
    raise SystemExit(main())
