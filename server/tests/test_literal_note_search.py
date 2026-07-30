from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from app.services import note_library
from app.services.note_library import (
    LibrarySource,
    _sql_all_terms_match_condition,
    _sql_markdown_body,
    _sql_term_params,
    literal_search_notes,
    understand_literal_search_query,
)


def _source(
    note_id: str,
    index: int,
    *,
    channel: str = "heading",
) -> LibrarySource:
    return LibrarySource(
        note_id=note_id,
        note_title=f"笔记 {note_id}",
        section_id=f"{note_id}-section-{index}",
        section_title=f"匹配片段 {index}",
        chunk_id=f"{note_id}-chunk-{index}",
        source_type="section_heading" if channel == "heading" else "chunk_content",
        snippet=f"匹配内容 {index}",
        score=1.0,
        retrieval_channels=[channel],
        query_intent="locate",
    )


class LiteralSearchQueryTest(unittest.TestCase):
    def test_literal_query_preserves_complete_words_and_explicit_search_text(self) -> None:
        middleware = understand_literal_search_query("中间件")
        self.assertEqual(middleware.original_query, "中间件")
        self.assertEqual(middleware.search_query, "中间件")
        self.assertEqual(middleware.terms, ["中间件"])
        self.assertNotIn("间件", middleware.terms)

        docker = understand_literal_search_query("搜索 Docker")
        self.assertEqual(docker.original_query, "搜索 Docker")
        self.assertEqual(docker.search_query, "docker")
        self.assertEqual(docker.terms, ["docker"])

        version = understand_literal_search_query("Python 3.10")
        self.assertEqual(version.terms, ["python 3.10", "python", "3.10"])
        self.assertNotIn("3", version.terms)
        self.assertNotIn("10", version.terms)

    def test_literal_multiterm_match_requires_every_explicit_token(self) -> None:
        plan = understand_literal_search_query("Python 3.10")
        condition = _sql_all_terms_match_condition(
            ["n.title"],
            plan.terms,
            ["python", "3.10"],
        )
        self.assertIn(":term_1", condition)
        self.assertIn(":term_2", condition)
        self.assertIn(" AND ", condition)
        self.assertNotIn(":term_0", condition)

    def test_literal_content_expression_removes_markdown_heading_lines(self) -> None:
        expression = _sql_markdown_body("n.content")
        self.assertIn("regexp_replace", expression)
        self.assertIn("#{1,6}", expression)
        self.assertIn("'gn'", expression)

    def test_literal_query_escapes_sql_like_wildcards(self) -> None:
        self.assertEqual(
            _sql_term_params(["100%", "a_b", "wow!"]),
            {
                "term_0": "%100!%%",
                "term_1": "%a!_b%",
                "term_2": "%wow!!%",
            },
        )


class LiteralSearchChannelTest(unittest.IsolatedAsyncioTestCase):
    async def test_literal_search_never_calls_vector_retrieval(self) -> None:
        heading_search = AsyncMock(return_value=[])
        content_search = AsyncMock(return_value=[])
        vector_search = AsyncMock(side_effect=AssertionError("literal search must not use vectors"))

        with (
            patch.object(note_library, "_heading_search_sources", heading_search),
            patch.object(note_library, "_content_search_sources", content_search),
            patch.object(note_library, "_vector_search_sources", vector_search),
        ):
            results = await literal_search_notes(
                AsyncMock(),
                "user-1",
                "Docker",
                scope="all",
            )

        self.assertEqual(results, [])
        heading_search.assert_awaited_once()
        content_search.assert_awaited_once()
        vector_search.assert_not_awaited()
        self.assertTrue(heading_search.await_args.kwargs["literal_fields_only"])
        self.assertTrue(content_search.await_args.kwargs["literal_fields_only"])

    async def test_title_scope_only_calls_heading_channel(self) -> None:
        heading_search = AsyncMock(return_value=[_source("note-title", 1)])
        content_search = AsyncMock(side_effect=AssertionError("title scope must not search content"))
        vector_search = AsyncMock(side_effect=AssertionError("literal search must not use vectors"))

        with (
            patch.object(note_library, "_heading_search_sources", heading_search),
            patch.object(note_library, "_content_search_sources", content_search),
            patch.object(note_library, "_vector_search_sources", vector_search),
        ):
            results = await literal_search_notes(
                AsyncMock(),
                "user-1",
                "Docker",
                scope="title",
            )

        self.assertEqual([source.note_id for source in results], ["note-title"])
        heading_search.assert_awaited_once()
        content_search.assert_not_awaited()
        vector_search.assert_not_awaited()
        self.assertTrue(heading_search.await_args.kwargs["literal_fields_only"])

    async def test_content_scope_only_calls_content_channel(self) -> None:
        heading_search = AsyncMock(side_effect=AssertionError("content scope must not search headings"))
        content_search = AsyncMock(return_value=[_source("note-content", 1, channel="content")])
        vector_search = AsyncMock(side_effect=AssertionError("literal search must not use vectors"))

        with (
            patch.object(note_library, "_heading_search_sources", heading_search),
            patch.object(note_library, "_content_search_sources", content_search),
            patch.object(note_library, "_vector_search_sources", vector_search),
        ):
            results = await literal_search_notes(
                AsyncMock(),
                "user-1",
                "Docker",
                scope="content",
            )

        self.assertEqual([source.note_id for source in results], ["note-content"])
        heading_search.assert_not_awaited()
        content_search.assert_awaited_once()
        vector_search.assert_not_awaited()
        self.assertTrue(content_search.await_args.kwargs["literal_fields_only"])

    async def test_each_note_keeps_at_most_three_fragments(self) -> None:
        heading_search = AsyncMock(
            return_value=[
                *[_source("note-a", index) for index in range(1, 6)],
                *[_source("note-b", index) for index in range(1, 3)],
            ]
        )

        with patch.object(note_library, "_heading_search_sources", heading_search):
            results = await literal_search_notes(
                AsyncMock(),
                "user-1",
                "Docker",
                scope="title",
                limit=20,
            )

        note_a_results = [source for source in results if source.note_id == "note-a"]
        note_b_results = [source for source in results if source.note_id == "note-b"]
        self.assertEqual(len(note_a_results), 3)
        self.assertEqual(len(note_b_results), 2)
        self.assertLessEqual(
            max(
                sum(source.note_id == note_id for source in results)
                for note_id in {source.note_id for source in results}
            ),
            3,
        )

    async def test_literal_limit_counts_notes_instead_of_fragments(self) -> None:
        heading_search = AsyncMock(
            return_value=[
                *[_source("note-a", index) for index in range(1, 4)],
                *[_source("note-b", index) for index in range(1, 4)],
                *[_source("note-c", index) for index in range(1, 4)],
            ]
        )

        with patch.object(note_library, "_heading_search_sources", heading_search):
            results = await literal_search_notes(
                AsyncMock(),
                "user-1",
                "Docker",
                scope="title",
                limit=2,
            )

        self.assertEqual({source.note_id for source in results}, {"note-a", "note-b"})
        self.assertEqual(len(results), 6)

    async def test_note_content_fallback_is_removed_when_chunks_exist(self) -> None:
        chunk = _source("note-a", 1, channel="content")
        fallback = LibrarySource(
            note_id="note-a",
            note_title="笔记 note-a",
            section_id=None,
            section_title=None,
            chunk_id=None,
            source_type="note_content",
            snippet="整篇正文的重复命中",
            score=0.5,
            retrieval_channels=["content"],
            query_intent="locate",
        )
        content_search = AsyncMock(return_value=[chunk, fallback])

        with patch.object(note_library, "_content_search_sources", content_search):
            results = await literal_search_notes(
                AsyncMock(),
                "user-1",
                "Docker",
                scope="content",
            )

        self.assertEqual(results, [chunk])


if __name__ == "__main__":
    unittest.main()
