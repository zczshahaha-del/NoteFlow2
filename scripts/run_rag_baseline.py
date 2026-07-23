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
THRESHOLDS = ROOT / "quality" / "baseline-thresholds.json"
REPORT_JSON = ROOT / "quality" / "reports" / "rag-legacy-baseline.json"
REPORT_MD = ROOT / "quality" / "reports" / "rag-legacy-baseline.md"


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, round((len(ordered) - 1) * percentile)))
    return round(ordered[index], 2)


def _write_markdown(report: dict) -> None:
    summary = report["summary"]
    lines = [
        "# NoteFlow Legacy RAG 固定评测基线",
        "",
        f"- 数据集：`{report['datasetVersion']}`",
        f"- 检索模式：{report['retrievalMode']}",
        f"- Recall@5：{summary['recallAt5']}",
        f"- MRR：{summary['mrr']}",
        f"- nDCG@5：{summary['nDcgAt5']}",
        f"- 引用字段覆盖率：{summary['citationCoverage']}",
        f"- 预期无结果准确率：{report['noAnswerAccuracy']}",
        f"- 跨用户泄漏：{report['crossUserLeakage']}",
        f"- 冷运行检索 p95：{report['latencyMs']['cold']['p95']} ms",
        f"- 热运行检索 p95：{report['latencyMs']['hot']['p95']} ms",
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
            "## 解释",
            "",
            "- 本步骤为了可重复性，默认关闭外部 Embedding 请求，只评估当前 legacy 的标题/正文/pg_trgm/RRF 路径。",
            "- `--with-embeddings` 可补充真实 DashScope + pgvector 结果，但外部服务成本和波动不作为步骤 2 的确定性门禁。",
            "- 步骤 10～12 切换 RAG v2 后必须继续使用同一固定语料，并与本报告逐项对比。",
            "",
        ]
    )
    REPORT_MD.write_text("\n".join(lines), encoding="utf-8")


async def main_async(with_embeddings: bool) -> int:
    sys.path.insert(0, str(SERVER_ROOT))
    from app.config import cfg
    from app.database import AsyncSessionLocal
    from app.models.db import Note, User
    from app.services.markdown_index import create_index_job, run_index_job
    from app.services.note_library import hybrid_search_notes
    from app.services.rag_eval import RagEvalCase, evaluate_rag_sources, summarize_rag_eval_results

    dataset = json.loads(DATASET.read_text(encoding="utf-8"))
    thresholds = json.loads(THRESHOLDS.read_text(encoding="utf-8"))["ragLegacy"]
    run_key = uuid.uuid4().hex[:12]
    owner_ids = {owner: f"quality-{owner}-{run_key}" for owner in {item["owner"] for item in dataset["corpus"]}}
    note_ids = {item["key"]: f"quality-note-{item['key']}-{run_key}" for item in dataset["corpus"]}
    original_embedding_key = cfg.EMBEDDING_API_KEY
    if not with_embeddings:
        cfg.EMBEDDING_API_KEY = ""

    async with AsyncSessionLocal() as session:
        try:
            for owner, user_id in owner_ids.items():
                session.add(
                    User(
                        id=user_id,
                        email=f"quality-{owner}-{run_key}@local.test",
                        display_name=f"Quality {owner}",
                        password_hash="quality-eval-not-a-login",
                    )
                )
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
                job = await create_index_job(session, note)
                await run_index_job(session, note, job)
            await session.commit()

            pass_results: dict[str, list[dict]] = {}
            latency: dict[str, list[float]] = {"cold": [], "hot": []}
            for pass_name in ("cold", "hot"):
                evaluated: list[dict] = []
                for case in dataset["cases"]:
                    started = time.perf_counter()
                    sources = await hybrid_search_notes(
                        session,
                        owner_ids[case["owner"]],
                        case["query"],
                        limit=8,
                    )
                    latency[pass_name].append((time.perf_counter() - started) * 1000)
                    expected_ids = [note_ids[key] for key in case.get("expectedNoteKeys") or []]
                    evaluation = evaluate_rag_sources(
                        RagEvalCase(
                            id=case["id"],
                            query=case["query"],
                            expected_note_ids=expected_ids,
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
                    evaluated.append(evaluation)
                pass_results[pass_name] = evaluated

            results = pass_results["hot"]
            summary = summarize_rag_eval_results(results)
            no_answer_cases = [item for item in results if item["expectNoResults"]]
            no_answer_accuracy = (
                round(sum(1 for item in no_answer_cases if item["metrics"]["noResult"]) / len(no_answer_cases), 4)
                if no_answer_cases
                else 1.0
            )
            cross_user_leakage = sum(item["forbiddenHits"] for item in results if item["securityCritical"])
            consistent = all(
                cold["metrics"]["targetRank"] == hot["metrics"]["targetRank"]
                and cold["forbiddenHits"] == hot["forbiddenHits"]
                for cold, hot in zip(pass_results["cold"], pass_results["hot"])
            )
            report = {
                "generatedAt": datetime.now(timezone.utc).isoformat(),
                "datasetVersion": dataset["version"],
                "retrievalMode": "legacy hybrid with configured embeddings" if with_embeddings else "legacy lexical/pg_trgm/RRF deterministic",
                "summary": summary,
                "noAnswerAccuracy": no_answer_accuracy,
                "crossUserLeakage": cross_user_leakage,
                "coldHotConsistent": consistent,
                "latencyMs": {
                    key: {
                        "p50": round(statistics.median(values), 2) if values else 0.0,
                        "p95": _percentile(values, 0.95),
                    }
                    for key, values in latency.items()
                },
                "results": results,
            }
            REPORT_JSON.parent.mkdir(parents=True, exist_ok=True)
            REPORT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            _write_markdown(report)
            print(
                json.dumps(
                    {
                        "recallAt5": summary["recallAt5"],
                        "mrr": summary["mrr"],
                        "nDcgAt5": summary["nDcgAt5"],
                        "citationCoverage": summary["citationCoverage"],
                        "noAnswerAccuracy": no_answer_accuracy,
                        "crossUserLeakage": cross_user_leakage,
                        "coldHotConsistent": consistent,
                    },
                    ensure_ascii=False,
                )
            )
            threshold_failed = (
                summary["recallAt5"] < thresholds["minimumRecallAt5"]
                or summary["mrr"] < thresholds["minimumMrr"]
                or summary["nDcgAt5"] < thresholds["minimumNdcgAt5"]
                or summary["citationCoverage"] < thresholds["minimumCitationCoverage"]
                or cross_user_leakage != 0
                or not consistent
            )
            return 1 if threshold_failed else 0
        finally:
            await session.rollback()
            await session.execute(delete(User).where(User.id.in_(list(owner_ids.values()))))
            await session.commit()
            cfg.EMBEDDING_API_KEY = original_embedding_key


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--with-embeddings", action="store_true")
    args = parser.parse_args()
    return asyncio.run(main_async(args.with_embeddings))


if __name__ == "__main__":
    raise SystemExit(main())
