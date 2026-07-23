from __future__ import annotations

import asyncio
import unittest
from unittest.mock import patch

from app.config import cfg
from app.rag.v2.context import build_context, validate_citations
from app.rag.v2.parser import parse_markdown_nodes
from app.rag.v2.reranker import _reranker_endpoint, rerank_with_fallback
from app.rag.v2.retrieval import RetrievalCandidate, _fallback_bm25, tokenize, weighted_rrf


def _candidate(
    node_id: str,
    *,
    note_id: str = "note-1",
    section_key: str = "section-1",
    content: str = "RAG combines BM25 and vector search.",
    content_hash: str | None = None,
    channel: str = "bm25",
) -> RetrievalCandidate:
    return RetrievalCandidate(
        node_id=node_id,
        note_id=note_id,
        note_title="RAG Architecture",
        section_key=section_key,
        section_path=["Hybrid Retrieval"],
        content=content,
        content_hash=content_hash or f"hash-{node_id}",
        source_version="source-v1",
        score=1.0,
        channels=[channel],
        scores={channel: 1.0},
    )


class RagV2ParserTest(unittest.TestCase):
    def test_commonmark_ast_preserves_hierarchy_and_atomic_blocks(self) -> None:
        markdown = """前言

# API

普通段落。

- first
- second

```python
print('ok')
```

## Matrix

| Name | Value |
|---|---|
| one | two |
"""
        original = markdown
        nodes = parse_markdown_nodes(
            markdown,
            note_id="note-parser",
            note_title="Parser",
            source_version="source-v1",
        )

        self.assertEqual(markdown, original)
        self.assertEqual([node.node_type for node in nodes], ["paragraph", "paragraph", "bullet_list", "fence", "table"])
        self.assertEqual(nodes[-1].section_path, ["API", "Matrix"])
        self.assertIn("print('ok')", nodes[3].content)
        self.assertIn("| Name | Value |", nodes[4].content)

    def test_node_ids_are_stable_and_only_changed_section_rebuilds(self) -> None:
        before = "# Stable\n\nkeep this\n\n# Changed\n\nold value"
        after = "# Stable\n\nkeep this\n\n# Changed\n\nnew value"
        first = parse_markdown_nodes(before, note_id="note-stable", note_title="Stable", source_version="v1")
        repeat = parse_markdown_nodes(before, note_id="note-stable", note_title="Stable", source_version="v1")
        second = parse_markdown_nodes(after, note_id="note-stable", note_title="Stable", source_version="v2")

        self.assertEqual([node.id for node in first], [node.id for node in repeat])
        stable_before = next(node for node in first if node.section_path == ["Stable"])
        stable_after = next(node for node in second if node.section_path == ["Stable"])
        changed_before = next(node for node in first if node.section_path == ["Changed"])
        changed_after = next(node for node in second if node.section_path == ["Changed"])
        self.assertEqual(stable_before.id, stable_after.id)
        self.assertNotEqual(changed_before.id, changed_after.id)

    def test_oversized_text_never_exceeds_maximum_tokens(self) -> None:
        markdown = "# Long\n\n" + "token " * 2400
        nodes = parse_markdown_nodes(
            markdown,
            note_id="note-long",
            note_title="Long",
            source_version="v1",
            target_tokens=600,
            max_tokens=1000,
            overlap_tokens=80,
        )
        self.assertGreater(len(nodes), 2)
        self.assertTrue(all(node.token_count <= 1000 for node in nodes))


class RagV2RetrievalTest(unittest.TestCase):
    def test_tokenizer_keeps_code_symbols_and_chinese_search_terms(self) -> None:
        with patch.object(cfg, "RAG_BM25_TOKENIZER", "fallback"):
            tokens = tokenize("缓存雪崩 __enter__ C++")
        self.assertIn("__enter__", tokens)
        self.assertIn("缓存", tokens)
        self.assertIn("c++", tokens)

    def test_bm25_scores_relevant_document_above_unrelated(self) -> None:
        scores = _fallback_bm25(
            ["rag", "bm25"],
            [["rag", "bm25", "vector"], ["redis", "cache"]],
        )
        self.assertGreater(scores[0], scores[1])

    def test_weighted_rrf_deduplicates_same_source_across_channels(self) -> None:
        title = _candidate("node-1", channel="title")
        bm25 = _candidate("node-1", channel="bm25")
        vector = _candidate("node-1", channel="vector")
        fused = weighted_rrf({"title": [title], "bm25": [bm25], "vector": [vector]}, limit=10, k=60)
        self.assertEqual(len(fused), 1)
        self.assertEqual(fused[0].channels, ["bm25", "title", "vector"])
        self.assertIn("titleRrf", fused[0].scores)
        self.assertNotEqual(fused[0].score, title.score)


class _SuccessReranker:
    name = "mock-success"

    async def rerank(self, query, candidates, limit):
        return list(reversed(candidates))[:limit]


class _FailureReranker:
    name = "mock-failure"

    async def rerank(self, query, candidates, limit):
        raise RuntimeError("unavailable")


class _SlowReranker:
    name = "mock-slow"

    async def rerank(self, query, candidates, limit):
        await asyncio.sleep(0.05)
        return candidates[:limit]


class RagV2RerankerContextTest(unittest.TestCase):
    def test_reranker_endpoint_uses_qwen_compatible_plural_path(self) -> None:
        self.assertEqual(
            _reranker_endpoint(
                "https://dashscope.aliyuncs.com/compatible-api/v1",
                "qwen3-rerank",
            ),
            "https://dashscope.aliyuncs.com/compatible-api/v1/reranks",
        )
        self.assertEqual(
            _reranker_endpoint("https://api.jina.ai/v1", "jina-reranker-v3"),
            "https://api.jina.ai/v1/rerank",
        )

    def test_reranker_success_and_failure_fallback(self) -> None:
        candidates = [_candidate("one"), _candidate("two", section_key="section-2")]
        ranked, success = asyncio.run(
            rerank_with_fallback("RAG", candidates, limit=2, provider=_SuccessReranker())
        )
        fallback, failed = asyncio.run(
            rerank_with_fallback("RAG", candidates, limit=2, provider=_FailureReranker())
        )
        self.assertEqual(ranked[0].node_id, "two")
        self.assertEqual(success["status"], "ok")
        self.assertEqual([item.node_id for item in fallback], ["one", "two"])
        self.assertTrue(failed["fallback"])

    def test_reranker_timeout_falls_back_to_rrf(self) -> None:
        candidates = [_candidate("one")]
        with patch.object(cfg, "RAG_RERANK_TIMEOUT_SECONDS", 0.001):
            fallback, trace = asyncio.run(
                rerank_with_fallback("RAG", candidates, limit=1, provider=_SlowReranker())
            )
        self.assertEqual(fallback[0].node_id, "one")
        self.assertEqual(trace["status"], "timeout")
        self.assertTrue(trace["fallback"])

    def test_context_citations_are_stable_and_fabricated_ids_are_removed(self) -> None:
        context = build_context("RAG 是什么", [_candidate("abcdef1234567890")], token_budget=1000, top_k=3)
        self.assertEqual(context.citations[0].citation_id, "cite-abcdef1234567890")
        cleaned, validation = validate_citations("证据见 [1] 和 [9]。", context.citations)
        self.assertIn("[1]", cleaned)
        self.assertNotIn("[9]", cleaned)
        self.assertEqual(validation["invalid"], [9])

    def test_no_source_context_forbids_fabricated_note_answer(self) -> None:
        context = build_context("不存在的问题", [], token_budget=1000)
        self.assertEqual(context.citations, [])
        self.assertIn("不得使用通用知识伪装成笔记内容", context.text)


if __name__ == "__main__":
    unittest.main()
