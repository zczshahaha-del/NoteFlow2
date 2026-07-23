from __future__ import annotations

import unittest

from app.services.note_library import (
    LibrarySource,
    _merge_rrf,
    deduplicate_logical_sources,
    filter_sources_with_direct_query_evidence,
    filter_query_relevant_sources,
    prefer_section_sources,
    understand_note_query,
)
from app.services.rag_eval import RagEvalCase, evaluate_rag_sources, summarize_rag_eval_results


def _source(
    note_id: str,
    note_title: str,
    snippet: str,
    *,
    section_id: str | None = None,
    section_title: str | None = None,
    chunk_id: str | None = None,
    channels: list[str] | None = None,
) -> LibrarySource:
    return LibrarySource(
        note_id=note_id,
        note_title=note_title,
        section_id=section_id,
        section_title=section_title or ("RAG section" if section_id else None),
        chunk_id=chunk_id,
        source_type="chunk_content",
        snippet=snippet,
        score=1.0,
        retrieval_channels=channels or ["content"],
        query_intent="lookup",
    )


class RagEvalTest(unittest.TestCase):
    def test_rrf_merges_heading_content_and_vector_hits_for_one_section(self) -> None:
        heading = _source(
            "note-python",
            "Python 面试题",
            "浅拷贝只复制第一层",
            section_id="section-copy",
            section_title="2.4 浅拷贝与深拷贝",
            channels=["heading"],
        )
        content = _source(
            "note-python",
            "Python 面试题",
            "浅拷贝只复制第一层，深拷贝递归复制嵌套对象",
            section_id="section-copy",
            section_title="2.4 浅拷贝与深拷贝",
            chunk_id="chunk-copy",
            channels=["content"],
        )
        vector = _source(
            "note-python",
            "Python 面试题",
            "浅拷贝和深拷贝处理嵌套对象的方式不同",
            section_id="section-copy",
            section_title="2.4 浅拷贝与深拷贝",
            chunk_id="chunk-copy",
            channels=["vector"],
        )

        merged = _merge_rrf(
            [("heading", [heading]), ("content", [content]), ("vector", [vector])],
            limit=8,
        )

        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].retrieval_channels, ["content", "heading", "vector"])

    def test_deduplicates_sync_conflict_copy_and_renumbered_same_heading(self) -> None:
        conflict = _source(
            "note-conflict",
            "Python 的面试常问题（同步冲突 07-15 06-16）",
            "同一主题的较长解释",
            section_id="section-25",
            section_title="2.5 列表与字典的浅拷贝与深拷贝",
        )
        canonical = _source(
            "note-canonical",
            "Python 的面试常问题",
            "同一主题的解释",
            section_id="section-24",
            section_title="2.4 列表与字典的浅拷贝与深拷贝",
        )

        deduplicated = deduplicate_logical_sources([conflict, canonical], limit=8)

        self.assertEqual(len(deduplicated), 1)
        self.assertEqual(deduplicated[0].note_id, "note-canonical")
        self.assertEqual(deduplicated[0].section_title, "2.4 列表与字典的浅拷贝与深拷贝")

    def test_prefers_section_reference_over_duplicate_note_reference(self) -> None:
        note_hit = _source(
            "note-python",
            "Python 的面试常问题",
            "# 2.4 列表与字典的浅拷贝与深拷贝",
        )
        section_hit = _source(
            "note-python",
            "Python 的面试常问题",
            "浅拷贝只复制第一层，深拷贝递归复制嵌套对象",
            section_id="section-copy",
            section_title="2.4 列表与字典的浅拷贝与深拷贝",
        )

        kept = prefer_section_sources([section_hit, note_hit], limit=8)

        self.assertEqual(len(kept), 1)
        self.assertEqual(kept[0].section_id, "section-copy")

    def test_specific_query_terms_filter_broad_list_dictionary_matches(self) -> None:
        exact = _source(
            "note-python",
            "Python 的面试常问题",
            "浅拷贝只复制第一层，深拷贝递归复制嵌套对象",
            section_id="section-copy",
            section_title="2.4 列表与字典的浅拷贝与深拷贝",
        )
        related = _source(
            "note-python",
            "Python 的面试常问题",
            "浅拷贝嵌套对象可能互相影响",
            section_id="section-trap",
            section_title="7.2 浅拷贝常见陷阱",
        )
        broad = _source(
            "note-python",
            "Python 的面试常问题",
            "列表和字典的操作复杂度",
            section_id="section-complexity",
            section_title="2.6 列表与字典的常见操作复杂度",
        )

        filtered = filter_query_relevant_sources(
            [exact, broad, related],
            understand_note_query("列表与字典的浅拷贝与深拷贝是啥"),
            limit=8,
        )

        self.assertEqual([source.section_id for source in filtered], ["section-copy", "section-trap"])

    def test_explicit_notes_mode_drops_unrelated_vector_neighbours(self) -> None:
        unrelated = _source(
            "note-test",
            "P1 编辑器交互测试",
            "灰度标题",
            section_id="section-test",
        )

        filtered = filter_sources_with_direct_query_evidence(
            [unrelated],
            understand_note_query("这个知识库里有 Redis 相关内容吗？"),
        )

        self.assertEqual(filtered, [])

    def test_evaluate_sources_scores_rank_keyword_coverage_and_channels(self) -> None:
        case = RagEvalCase(
            id="rag-private-knowledge",
            query="RAG 怎么解决私有知识问题",
            expected_note_ids=["note-rag"],
            expected_section_ids=["section-rag"],
            expected_keywords=["私有知识", "幻觉"],
        )
        sources = [
            _source("note-rag", "RAG 学习笔记", "同一篇笔记里的其他小节", section_id="section-other", channels=["heading"]),
            _source(
                "note-rag",
                "RAG 学习笔记",
                "RAG 可以把个人笔记、公司文档等私有知识检索出来。",
                section_id="section-rag",
                chunk_id="chunk-rag",
                channels=["content", "vector"],
            ),
        ]

        result = evaluate_rag_sources(case, sources, success_at=3, keyword_threshold=0.5)

        self.assertEqual(result["metrics"]["targetRank"], 2)
        self.assertEqual(result["metrics"]["noteRank"], 1)
        self.assertEqual(result["metrics"]["sectionRank"], 2)
        self.assertFalse(result["metrics"]["hitAt1"])
        self.assertTrue(result["metrics"]["hitAt3"])
        self.assertEqual(result["metrics"]["mrr"], 0.5)
        self.assertEqual(result["metrics"]["recallAt1"], 0.0)
        self.assertEqual(result["metrics"]["recallAt3"], 1.0)
        self.assertEqual(result["metrics"]["recallAt5"], 1.0)
        self.assertEqual(result["metrics"]["nDcgAt5"], 0.6309)
        self.assertEqual(result["metrics"]["citationCoverage"], 1.0)
        self.assertEqual(result["metrics"]["keywordCoverage"], 0.5)
        self.assertTrue(result["metrics"]["passed"])
        self.assertEqual(result["channels"], {"content": 1, "heading": 1, "vector": 1})
        self.assertTrue(result["topResults"][1]["matchesExpected"])
        self.assertEqual(result["topResults"][1]["matchedKeywords"], ["私有知识"])

    def test_summarize_results_aggregates_hits_mrr_and_pass_rate(self) -> None:
        hit = evaluate_rag_sources(
            RagEvalCase(
                id="hit",
                query="RAG 私有知识",
                expected_note_ids=["note-rag"],
                expected_keywords=["私有知识", "幻觉"],
            ),
            [
                _source("note-other", "Other", "无关内容"),
                _source("note-rag", "RAG", "RAG 可以检索私有知识。"),
            ],
            success_at=3,
            keyword_threshold=0.5,
        )
        miss = evaluate_rag_sources(
            RagEvalCase(
                id="miss",
                query="缓存雪崩",
                expected_note_ids=["note-cache"],
                expected_keywords=["缓存雪崩"],
            ),
            [],
            success_at=3,
            keyword_threshold=0.5,
        )

        summary = summarize_rag_eval_results([hit, miss])

        self.assertEqual(summary["totalCases"], 2)
        self.assertEqual(summary["idJudgedCases"], 2)
        self.assertEqual(summary["keywordJudgedCases"], 2)
        self.assertEqual(summary["passRate"], 0.5)
        self.assertEqual(summary["hitAt1"], 0.0)
        self.assertEqual(summary["hitAt3"], 0.5)
        self.assertEqual(summary["hitAt5"], 0.5)
        self.assertEqual(summary["mrr"], 0.25)
        self.assertEqual(summary["recallAt1"], 0.0)
        self.assertEqual(summary["recallAt3"], 0.5)
        self.assertEqual(summary["recallAt5"], 0.5)
        self.assertEqual(summary["nDcgAt5"], 0.3155)
        self.assertEqual(summary["citationCoverage"], 1.0)
        self.assertEqual(summary["noResultRate"], 0.5)
        self.assertEqual(summary["avgKeywordCoverage"], 0.25)


if __name__ == "__main__":
    unittest.main()
