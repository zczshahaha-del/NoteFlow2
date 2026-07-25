from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import delete


ROOT = Path(__file__).resolve().parents[1]
SERVER_ROOT = ROOT / "server"
DATASET = ROOT / "quality" / "eval" / "rag_cases.json"
REPORT_JSON = ROOT / "quality" / "reports" / "rag-eval.json"
REPORT_MD = ROOT / "quality" / "reports" / "rag-eval.md"
MIN_RECALL_AT_5 = 0.8
MIN_MRR = 0.8
MIN_NDCG_AT_5 = 0.8


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, round((len(ordered) - 1) * percentile)))
    return round(ordered[index], 2)


def _markdown(report: dict) -> str:
    summary = report["summary"]
    lines = [
        "# NoteFlow RAG 固定评测",
        "",
        f"- 数据集：`{report['datasetVersion']}`",
        f"- Recall@5：{summary['recallAt5']}（门槛 {MIN_RECALL_AT_5}）",
        f"- MRR：{summary['mrr']}（门槛 {MIN_MRR}）",
        f"- nDCG@5：{summary['nDcgAt5']}（门槛 {MIN_NDCG_AT_5}）",
        f"- 引用字段覆盖率：{summary['citationCoverage']}",
        f"- 预期无结果准确率：{report['noAnswerAccuracy']}",
        f"- 跨用户泄漏：{report['crossUserLeakage']}",
        f"- 质量门禁：{'通过' if report['passed'] else '失败'}",
        f"- 冷运行 p95：{report['latencyMs']['cold']['p95']} ms",
        f"- 热运行 p95：{report['latencyMs']['hot']['p95']} ms",
        "",
        "| 用例 | 结果数 | 目标排名 | Recall@5 | nDCG@5 | 无结果预期 | 泄漏 |",
        "|---|---:|---:|---:|---:|---|---:|",
    ]
    for item in report["results"]:
        metrics = item["metrics"]
        lines.append(
            f"| `{item['id']}` | {metrics['resultCount']} | {metrics['targetRank'] or '-'} | "
            f"{metrics['recallAt5'] if metrics['recallAt5'] is not None else '-'} | "
            f"{metrics['nDcgAt5'] if metrics['nDcgAt5'] is not None else '-'} | "
            f"{'是' if item['expectNoResults'] else '否'} | {item['forbiddenHits']} |"
        )
    lines.extend(
        [
            "",
            "## 运行边界",
            "",
            "- 评测数据为固定测试语料，运行结束后用户、笔记、节点、向量和任务全部级联清理。",
            "- 默认关闭外部 Embedding，确定性验证 Title + BM25 + RRF；`--with-embeddings` 才调用真实向量服务。",
            "- 每个通道在 SQL 取数阶段先应用 user_id、deleted 和当前 source_version 过滤。",
            "",
        ]
    )
    return "\n".join(lines)


async def main_async(with_embeddings: bool) -> int:
    sys.path.insert(0, str(SERVER_ROOT))
    from app.config import cfg
    from app.database import AsyncSessionLocal, engine
    from app.models.db import Note, User
    from app.rag.pipeline.indexer import create_rag_index_job, run_rag_index_job
    from app.rag.pipeline.retrieval import candidate_to_library_source, retrieve_candidates
    from app.services.rag_eval import RagEvalCase, evaluate_rag_sources, summarize_rag_eval_results

    dataset = json.loads(DATASET.read_text(encoding="utf-8"))
    run_key = uuid.uuid4().hex[:12]
    owner_ids = {owner: f"rag-v2-{owner}-{run_key}" for owner in {item["owner"] for item in dataset["corpus"]}}
    note_ids = {item["key"]: f"rag-v2-note-{item['key']}-{run_key}" for item in dataset["corpus"]}
    original_embedding_key = cfg.EMBEDDING_API_KEY
    original_vector_enabled = cfg.RAG_VECTOR_ENABLED
    if not with_embeddings:
        cfg.EMBEDDING_API_KEY = ""
        cfg.RAG_VECTOR_ENABLED = False

    try:
        async with AsyncSessionLocal() as session:
            for owner, user_id in owner_ids.items():
                session.add(User(
                    id=user_id,
                    email=f"rag-v2-{owner}-{run_key}@local.test",
                    display_name=f"RAG {owner}",
                    password_hash="quality-eval-not-a-login",
                ))
            await session.flush()
            notes: dict[str, Note] = {}
            for item in dataset["corpus"]:
                note = Note(
                    id=note_ids[item["key"]],
                    user_id=owner_ids[item["owner"]],
                    title=item["title"],
                    tags=item.get("tags") or [],
                    content=item["content"],
                    index_status="pending",
                    deleted_at=datetime.now(timezone.utc).replace(tzinfo=None) if item.get("deleted") else None,
                )
                notes[item["key"]] = note
                session.add(note)
            await session.flush()
            for item in dataset["corpus"]:
                if item.get("deleted"):
                    continue
                note = notes[item["key"]]
                job = await create_rag_index_job(session, note)
                await run_rag_index_job(session, note, job)
                if job.status != "success":
                    raise RuntimeError(f"v2 index failed for {item['key']}: {job.error_code} {job.error_message}")
            await session.commit()

        pass_results: dict[str, list[dict]] = {}
        latencies: dict[str, list[float]] = {"cold": [], "hot": []}
        for pass_name in ("cold", "hot"):
            evaluated: list[dict] = []
            for case in dataset["cases"]:
                started = time.perf_counter()
                retrieval = await retrieve_candidates(owner_ids[case["owner"]], case["query"], limit=8)
                latencies[pass_name].append((time.perf_counter() - started) * 1000)
                sources = [candidate_to_library_source(candidate) for candidate in retrieval.candidates[:8]]
                evaluation = evaluate_rag_sources(
                    RagEvalCase(
                        id=case["id"],
                        query=case["query"],
                        expected_note_ids=[note_ids[key] for key in case.get("expectedNoteKeys") or []],
                        expected_keywords=case.get("expectedKeywords") or [],
                    ),
                    sources,
                    success_at=5,
                    keyword_threshold=0.6,
                )
                forbidden = {note_ids[key] for key in case.get("forbiddenNoteKeys") or []}
                evaluation["expectNoResults"] = bool(case.get("expectNoResults"))
                evaluation["securityCritical"] = bool(case.get("securityCritical"))
                evaluation["forbiddenHits"] = sum(1 for source in sources if source.note_id in forbidden)
                evaluation["retrievalTrace"] = retrieval.trace
                evaluated.append(evaluation)
            pass_results[pass_name] = evaluated

        results = pass_results["hot"]
        summary = summarize_rag_eval_results(results)
        no_answer_cases = [item for item in results if item["expectNoResults"]]
        no_answer_accuracy = round(
            sum(1 for item in no_answer_cases if item["metrics"]["noResult"]) / max(1, len(no_answer_cases)), 4
        )
        cross_user_leakage = sum(item["forbiddenHits"] for item in results if item["securityCritical"])
        consistent = all(
            cold["metrics"]["targetRank"] == hot["metrics"]["targetRank"]
            and cold["forbiddenHits"] == hot["forbiddenHits"]
            for cold, hot in zip(pass_results["cold"], pass_results["hot"])
        )
        passed = (
            summary["recallAt5"] >= MIN_RECALL_AT_5
            and summary["mrr"] >= MIN_MRR
            and summary["nDcgAt5"] >= MIN_NDCG_AT_5
            and summary["citationCoverage"] == 1.0
            and no_answer_accuracy == 1.0
            and cross_user_leakage == 0
            and consistent
        )
        report = {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "datasetVersion": dataset["version"],
            "retrievalMode": "hybrid title/bm25/vector/weighted-rrf",
            "summary": summary,
            "qualityGate": {
                "minRecallAt5": MIN_RECALL_AT_5,
                "minMrr": MIN_MRR,
                "minNDcgAt5": MIN_NDCG_AT_5,
            },
            "noAnswerAccuracy": no_answer_accuracy,
            "crossUserLeakage": cross_user_leakage,
            "coldHotConsistent": consistent,
            "passed": passed,
            "latencyMs": {
                key: {
                    "p50": round(statistics.median(values), 2) if values else 0.0,
                    "p95": _percentile(values, 0.95),
                }
                for key, values in latencies.items()
            },
            "results": results,
        }
        REPORT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        REPORT_MD.write_text(_markdown(report), encoding="utf-8")
        print(json.dumps({
            "recallAt5": summary["recallAt5"],
            "mrr": summary["mrr"],
            "nDcgAt5": summary["nDcgAt5"],
            "noAnswerAccuracy": no_answer_accuracy,
            "crossUserLeakage": cross_user_leakage,
            "passed": passed,
        }, ensure_ascii=False))
        return 0 if passed else 1
    finally:
        cfg.EMBEDDING_API_KEY = original_embedding_key
        cfg.RAG_VECTOR_ENABLED = original_vector_enabled
        async with AsyncSessionLocal() as session:
            await session.execute(delete(User).where(User.id.in_(list(owner_ids.values()))))
            await session.commit()
        await engine.dispose()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--with-embeddings", action="store_true")
    args = parser.parse_args()
    return asyncio.run(main_async(args.with_embeddings))


if __name__ == "__main__":
    raise SystemExit(main())
