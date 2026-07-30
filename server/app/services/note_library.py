from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from sqlalchemy import and_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import Note, NoteCategory, NoteChunk, NoteEmbedding, NoteSection
from app.services.embeddings import embed_texts, embedding_enabled
from app.services.markdown_index import parse_markdown_sections, split_section_chunks
from app.services.pgvector import vector_literal


MAX_CONTEXT_CHARS = 12000
LIBRARY_SEARCH_HINTS = [
    "我的文章",
    "我文章",
    "我的笔记",
    "我笔记",
    "文章里面",
    "文章里",
    "笔记里面",
    "笔记里",
    "文档里面",
    "文档里",
    "笔记库",
    "文档库",
    "知识库",
    "有没有相关",
    "有相关",
    "相关的文章",
    "相关文章",
    "相关笔记",
    "相关文档",
    "我有没有写过",
    "我写过",
    "保存过",
    "查一下",
    "搜一下",
    "搜索一下",
    "找一下",
]


@dataclass
class LibrarySource:
    note_id: str
    note_title: str
    section_id: Optional[str]
    section_title: Optional[str]
    chunk_id: Optional[str]
    source_type: str
    snippet: str
    score: float
    score_components: Optional[dict[str, float]] = None
    retrieval_channels: Optional[list[str]] = None
    query_intent: Optional[str] = None


@dataclass
class QueryUnderstanding:
    original_query: str
    normalized_query: str
    search_query: str
    intent: str
    scope_hint: str
    terms: list[str]
    rewritten_queries: list[str]


@dataclass
class ContextResult:
    context_mode: str
    context_text: str
    sources: list[LibrarySource]


def _normalize(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip()).lower()


def _unique(values: list[str], limit: int = 12) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        item = _normalize(value)
        if not item or item in seen:
            continue
        seen.add(item)
        result.append(item)
        if len(result) >= limit:
            break
    return result


def _terms(query: str) -> list[str]:
    normalized = _normalize(query)
    searchable = re.sub(
        r"(给我|帮我|请|麻烦|写一个|写个|写一段|实现一个|实现|生成|创建|代码|程序|示例|"
        r"区别|对比|比较|关系|是什么|是啥|有哪些|为什么|怎么|如何|一下|以及|并且|或者|和|与|及|"
        r"我的|自己|文章|笔记|文档|知识库|笔记库|文档库|里面|是否|有没有|相关|相似|内容|保存过|写过|"
        r"查一下|搜一下|搜索一下|找一下|当前笔记|当前文档|这篇|本文)",
        " ",
        normalized,
    )
    parts = [item for item in re.split(r"[\s,，.。:：;；!?！？/\\|()\[\]{}<>《》\"'`]+", searchable) if item]
    compact = " ".join(parts).strip()
    if not parts and normalized:
        parts = [normalized]
    elif compact and compact not in parts and len(compact) <= 40:
        parts.insert(0, compact)
    return _unique(parts, limit=12)


def _detect_query_intent(query: str) -> str:
    q = _normalize(query)
    if any(word in q for word in ["区别", "对比", "比较", "异同", "关系"]):
        return "compare"
    if any(word in q for word in ["总结", "概括", "归纳", "提炼", "梳理"]):
        return "summarize"
    if any(word in q for word in ["哪里", "在哪", "提到", "出现", "包含", "有没有", "查一下", "搜一下", "搜索", "找一下"]):
        return "locate"
    if any(word in q for word in ["怎么", "如何", "方案", "步骤", "解决", "处理"]):
        return "how_to"
    if any(word in q for word in ["是什么", "是啥", "什么意思", "解释", "理解"]):
        return "explain"
    return "lookup"


def _detect_scope_hint(query: str, note_id: Optional[str] = None) -> str:
    q = _normalize(query)
    if note_id or any(word in q for word in ["当前笔记", "当前文档", "这篇", "本文", "这个笔记", "这个文档"]):
        return "current_note"
    if any(word in q for word in ["我的笔记", "笔记库", "知识库", "文档库", "文章里", "笔记里"]):
        return "library"
    return "auto"


def understand_note_query(
    query: str,
    fallback_query: str = "",
    note_id: Optional[str] = None,
) -> QueryUnderstanding:
    normalized = _normalize(query)
    cleaned = _library_search_query(query, fallback_query=fallback_query)
    terms = _unique([*_terms(cleaned or query), *_terms(fallback_query)], limit=12)
    search_query = cleaned or " ".join(terms).strip() or fallback_query.strip() or query.strip()
    atomic_terms = [term for term in terms if " " not in term] or terms
    rewritten = _unique([search_query, normalized, " ".join(atomic_terms), fallback_query], limit=4)
    return QueryUnderstanding(
        original_query=query,
        normalized_query=normalized,
        search_query=search_query,
        intent=_detect_query_intent(query),
        scope_hint=_detect_scope_hint(query, note_id=note_id),
        terms=terms,
        rewritten_queries=rewritten,
    )


def _literal_query_tokens(value: str) -> list[str]:
    return [
        item
        for item in re.split(
            r"[\s,，。:：;；!?！？|()\[\]{}<>《》\"'`]+",
            _normalize(value),
        )
        if item
    ]


def understand_literal_search_query(query: str) -> QueryUnderstanding:
    """Build a predictable plan for the library search dialog.

    Unlike conversational RAG queries, UI search text is treated literally:
    no natural-language stop words are removed and no semantic rewrite is
    introduced. The complete phrase ranks first, followed by explicit tokens.
    """

    normalized = _normalize(query)
    search_query = re.sub(
        r"^(?:(?:请|麻烦)\s*)?(?:帮我\s*)?(?:搜索|搜|查找|查|找)\s+",
        "",
        normalized,
    ).strip() or normalized
    parts = _literal_query_tokens(search_query)
    terms = _unique([search_query, *parts], limit=8)
    return QueryUnderstanding(
        original_query=query,
        normalized_query=normalized,
        search_query=search_query,
        intent="locate",
        scope_hint="library",
        terms=terms,
        rewritten_queries=[search_query] if search_query else [],
    )


def is_library_search_query(question: str) -> bool:
    q = _normalize(question)
    return any(hint in q for hint in LIBRARY_SEARCH_HINTS)


def _library_search_query(question: str, fallback_query: str = "") -> str:
    normalized = _normalize(question)
    searchable = re.sub(
        r"(我|我的|自己|文章|笔记|文档|知识库|笔记库|文档库|里面|里|中|是否|有没有|"
        r"有|相关|相似|的|吗|嘛|么|呢|请|帮我|查|搜|搜索|找|一下|内容|保存过|写过)",
        " ",
        normalized,
    )
    parts = [
        item
        for item in re.split(r"[\s,，.。:：;；!?！？/\\|()\[\]{}<>《》\"'`]+", searchable)
        if item
    ]
    query = " ".join(parts).strip()
    return query or fallback_query.strip()


def _contains_score(text: str, terms: list[str], weight: float) -> float:
    normalized = _normalize(text)
    score = 0.0
    for term in terms:
        if term and term in normalized:
            score += weight
    return score


def _sql_term_params(terms: list[str]) -> dict[str, str]:
    return {
        f"term_{index}": f"%{term.replace('!', '!!').replace('%', '!%').replace('_', '!_')}%"
        for index, term in enumerate(terms)
    }


def _sql_match_condition(columns: list[str], terms: list[str]) -> str:
    pieces = []
    for index, _term in enumerate(terms):
        for column in columns:
            pieces.append(
                f"lower(coalesce({column}, '')) LIKE :term_{index} ESCAPE '!'"
            )
    return "(" + " OR ".join(pieces) + ")" if pieces else "false"


def _sql_all_terms_match_condition(
    columns: list[str],
    all_terms: list[str],
    required_terms: list[str],
) -> str:
    term_indexes = {term: index for index, term in enumerate(all_terms)}
    required_conditions: list[str] = []
    for term in required_terms:
        index = term_indexes.get(term)
        if index is None:
            continue
        column_conditions = [
            f"lower(coalesce({column}, '')) LIKE :term_{index} ESCAPE '!'"
            for column in columns
        ]
        required_conditions.append("(" + " OR ".join(column_conditions) + ")")
    return "(" + " AND ".join(required_conditions) + ")" if required_conditions else "false"


def _sql_markdown_body(column: str) -> str:
    return (
        f"regexp_replace(coalesce({column}, ''), "
        "'^[ \\t]{0,3}#{1,6}[ \\t]+.*$', '', 'gn')"
    )


def _sql_score_expression(weighted_columns: list[tuple[str, float]], terms: list[str]) -> str:
    pieces = []
    for index, _term in enumerate(terms):
        for column, weight in weighted_columns:
            pieces.append(
                "CASE WHEN "
                f"lower(coalesce({column}, '')) LIKE :term_{index} ESCAPE '!' "
                f"THEN {weight} ELSE 0 END"
            )
    return " + ".join(pieces) if pieces else "0"


def _row_source(row, terms: list[str], channel: str, intent: str) -> LibrarySource:
    snippet_text = row.get("snippet") or row.get("section_title") or row.get("note_title") or ""
    return LibrarySource(
        note_id=row["note_id"],
        note_title=row["note_title"],
        section_id=row.get("section_id"),
        section_title=row.get("section_title"),
        chunk_id=row.get("chunk_id"),
        source_type=row["source_type"],
        snippet=_snippet(snippet_text, terms),
        score=float(row.get("raw_score") or 0.0),
        score_components={f"{channel}Score": round(float(row.get("raw_score") or 0.0), 6)},
        retrieval_channels=[channel],
        query_intent=intent,
    )


def _is_smalltalk(question: str) -> bool:
    q = re.sub(r"[\s,，.。!！?？~～]+", "", _normalize(question))
    if not q:
        return True
    return q in {
        "你好",
        "您好",
        "hello",
        "hi",
        "嗨",
        "哈喽",
        "在吗",
        "谢谢",
        "感谢",
        "再见",
    }


def _snippet(text: str, terms: list[str], max_chars: int = 220) -> str:
    compact = re.sub(r"\s+", " ", (text or "").strip())
    if len(compact) <= max_chars:
        return compact
    lower = compact.lower()
    hit_index = -1
    for term in terms:
        hit_index = lower.find(term.lower())
        if hit_index >= 0:
            break
    if hit_index < 0:
        return compact[:max_chars].strip() + "..."
    start = max(0, hit_index - max_chars // 3)
    end = min(len(compact), start + max_chars)
    prefix = "..." if start > 0 else ""
    suffix = "..." if end < len(compact) else ""
    return prefix + compact[start:end].strip() + suffix


def _trim_context(text: str) -> str:
    if len(text) <= MAX_CONTEXT_CHARS:
        return text
    return text[:MAX_CONTEXT_CHARS] + "\n\n[上下文已截断]"


def _has_current_note_hint(question: str, selected_text: str = "") -> bool:
    q = _normalize(question)
    if selected_text.strip():
        return True
    return any(
        hint in q
        for hint in [
            "当前笔记",
            "当前文档",
            "这篇",
            "本文",
            "这段",
            "这句",
            "选中",
            "这个小节",
            "这一节",
            "本节",
            "上面",
            "上述",
            "根据笔记",
            "基于笔记",
            "结合笔记",
            "全文",
            "大纲",
            "目录",
            "结构",
        ]
    )


def _should_fallback_to_current_note(
    question: str,
    note: Note,
    content: str,
    selected_text: str = "",
) -> bool:
    if _has_current_note_hint(question, selected_text):
        return True
    terms = _terms(question)
    return bool(
        terms
        and (
            _contains_score(note.title, terms, 1) > 0
            or _contains_score(content or "", terms, 1) > 0
        )
    )


def _recency_score(updated_at: Optional[datetime]) -> float:
    if not updated_at:
        return 0.0
    age_seconds = max(0.0, (datetime.utcnow() - updated_at).total_seconds())
    if age_seconds < 86400:
        return 2.0
    if age_seconds < 86400 * 7:
        return 1.0
    return 0.2


SYNC_CONFLICT_SUFFIX_RE = re.compile(r"\s*[（(]同步冲突[^）)]*[）)]\s*$", re.IGNORECASE)
SECTION_NUMBER_PREFIX_RE = re.compile(
    r"^\s*(?:第\s*)?\d+(?:\.\d+)*(?:\s*[章节部分、.．:-])?\s*"
)


def _logical_note_title(value: str) -> str:
    return _normalize(SYNC_CONFLICT_SUFFIX_RE.sub("", value or ""))


def _logical_section_title(value: str) -> str:
    cleaned = re.sub(r"^\s*#{1,6}\s*", "", value or "")
    cleaned = SECTION_NUMBER_PREFIX_RE.sub("", cleaned)
    return _normalize(cleaned)


def _logical_source_identity(source: LibrarySource) -> tuple[str, str]:
    note_key = _logical_note_title(source.note_title) or source.note_id
    section_key = _logical_section_title(source.section_title or "")
    if section_key:
        return note_key, f"section:{section_key}"
    if source.section_id:
        return note_key, f"section-id:{source.section_id}"
    if source.chunk_id:
        return note_key, f"chunk:{source.chunk_id}"
    return note_key, source.source_type


def _is_sync_conflict_title(value: str) -> bool:
    return bool(SYNC_CONFLICT_SUFFIX_RE.search(value or ""))


def deduplicate_logical_sources(
    sources: list[LibrarySource],
    limit: int,
) -> list[LibrarySource]:
    """Collapse duplicate sections from sync-conflict copies and renumbered headings."""
    result: list[LibrarySource] = []
    positions: dict[tuple[str, str], int] = {}

    for source in sources:
        key = _logical_source_identity(source)
        position = positions.get(key)
        if position is None:
            positions[key] = len(result)
            result.append(source)
            continue

        current = result[position]
        prefer_source = (
            _is_sync_conflict_title(current.note_title)
            and not _is_sync_conflict_title(source.note_title)
        )
        if prefer_source:
            source.score = max(source.score, current.score)
            source.retrieval_channels = sorted(
                set([*(current.retrieval_channels or []), *(source.retrieval_channels or [])])
            )
            result[position] = source

    return result[:limit]


def prefer_section_sources(sources: list[LibrarySource], limit: int) -> list[LibrarySource]:
    """Remove a note-level hit when the same note already has a precise section hit."""
    notes_with_section_hit = {source.note_id for source in sources if source.section_id}
    return [
        source
        for source in sources
        if source.section_id or source.note_id not in notes_with_section_hit
    ][:limit]


def filter_query_relevant_sources(
    sources: list[LibrarySource],
    query_plan: QueryUnderstanding,
    limit: int,
) -> list[LibrarySource]:
    """Prefer sections containing the query's specific terms without disabling semantic fallback."""
    atomic_terms = [term for term in query_plan.terms if " " not in term and len(term) >= 3]
    if not atomic_terms:
        return sources[:limit]
    max_length = max(len(term) for term in atomic_terms)
    anchors = [term for term in atomic_terms if len(term) == max_length]
    anchored = [
        source
        for source in sources
        if any(
            anchor in _normalize(
                "\n".join([source.note_title, source.section_title or "", source.snippet])
            )
            for anchor in anchors
        )
    ]
    # Keep the vector-only fallback for paraphrases when lexical evidence is scarce.
    if len(anchored) < 2:
        return sources[:limit]
    return anchored[:limit]


def filter_sources_with_direct_query_evidence(
    sources: list[LibrarySource],
    query_plan: QueryUnderstanding,
) -> list[LibrarySource]:
    """Keep only sources that visibly support an explicit knowledge-base query.

    This is intentionally stricter than the normal hybrid-search fallback: in
    explicit "Ask notes" mode, an unrelated vector neighbour must not become a
    citation merely because the library is small.
    """
    atomic_terms = [term for term in query_plan.terms if " " not in term and len(term) >= 2]
    if not atomic_terms:
        return []
    longest = max(len(term) for term in atomic_terms)
    anchors = [term for term in atomic_terms if len(term) == longest]
    return [
        source
        for source in sources
        if any(
            anchor in _normalize("\n".join([source.note_title, source.section_title or "", source.snippet]))
            for anchor in anchors
        )
    ]


def _source_identity(source: LibrarySource) -> tuple[str, str]:
    if source.section_id:
        return source.note_id, f"section:{source.section_id}"
    if source.chunk_id:
        return source.note_id, f"chunk:{source.chunk_id}"
    return source.note_id, source.source_type


def _merge_rrf(
    ranked_lists: list[tuple[str, list[LibrarySource]]],
    limit: int,
    k: int = 60,
) -> list[LibrarySource]:
    fused: dict[tuple[str, str], LibrarySource] = {}
    for channel, items in ranked_lists:
        for rank, item in enumerate(items, start=1):
            key = _source_identity(item)
            contribution = 1.0 / (k + rank)
            existing = fused.get(key)
            if existing is None:
                item.score_components = dict(item.score_components or {})
                item.score_components[f"{channel}Rrf"] = contribution
                item.retrieval_channels = list(item.retrieval_channels or [channel])
                fused[key] = item
                continue

            existing.score_components = dict(existing.score_components or {})
            existing.score_components[f"{channel}Rrf"] = max(
                existing.score_components.get(f"{channel}Rrf", 0.0),
                contribution,
            )
            existing.retrieval_channels = sorted(set([*(existing.retrieval_channels or []), channel]))
            if len(item.snippet) > len(existing.snippet):
                existing.snippet = item.snippet

    results = list(fused.values())
    for item in results:
        components = item.score_components or {}
        item.score = round(sum(value for key, value in components.items() if key.endswith("Rrf")) * 100, 6)
    results.sort(key=lambda item: item.score, reverse=True)
    return results[:limit]


async def _category_map(session: AsyncSession, user_id: str) -> dict[str, str]:
    result = await session.execute(
        select(NoteCategory).where(
            NoteCategory.user_id == user_id,
            NoteCategory.deleted_at.is_(None),
        )
    )
    return {category.id: category.name for category in result.scalars().all()}


async def _heading_search_sources(
    session: AsyncSession,
    user_id: str,
    query_plan: QueryUnderstanding,
    note_id: Optional[str] = None,
    limit: int = 16,
    literal_fields_only: bool = False,
) -> list[LibrarySource]:
    terms = query_plan.terms
    if not terms:
        return []

    note_columns = ["n.title"] if literal_fields_only else [
        "n.title",
        "coalesce(cat.name, '')",
        "n.tags::text",
    ]
    note_weighted_columns = [("n.title", 30)] if literal_fields_only else [
        ("n.title", 30),
        ("coalesce(cat.name, '')", 12),
        ("n.tags::text", 10),
    ]
    section_columns = ["s.title"] if literal_fields_only else ["s.title", "n.title"]
    section_weighted_columns = [("s.title", 28)] if literal_fields_only else [
        ("s.title", 28),
        ("n.title", 8),
    ]
    required_terms = _literal_query_tokens(query_plan.search_query)
    note_match = (
        _sql_all_terms_match_condition(note_columns, terms, required_terms)
        if literal_fields_only
        else _sql_match_condition(note_columns, terms)
    )
    note_score = _sql_score_expression(note_weighted_columns, terms)
    section_match = (
        _sql_all_terms_match_condition(section_columns, terms, required_terms)
        if literal_fields_only
        else _sql_match_condition(section_columns, terms)
    )
    section_score = _sql_score_expression(section_weighted_columns, terms)
    note_filter = "AND n.id = :note_id" if note_id else ""
    section_filter = "AND s.note_id = :note_id" if note_id else ""

    ranked_sql = f"""
            SELECT
                'note_heading' AS source_type,
                n.id AS note_id,
                n.title AS note_title,
                NULL::varchar AS section_id,
                NULL::varchar AS section_title,
                NULL::varchar AS chunk_id,
                coalesce(n.content, n.title) AS snippet,
                ({note_score})::float AS raw_score
            FROM notes n
            LEFT JOIN note_categories cat ON cat.id = n.category_id AND cat.deleted_at IS NULL
            WHERE n.user_id = :user_id
              AND n.deleted_at IS NULL
              {note_filter}
              AND {note_match}

            UNION ALL

            SELECT
                'section_heading' AS source_type,
                n.id AS note_id,
                n.title AS note_title,
                s.id AS section_id,
                s.title AS section_title,
                NULL::varchar AS chunk_id,
                coalesce(s.content, s.title) AS snippet,
                ({section_score})::float AS raw_score
            FROM note_sections s
            JOIN notes n ON n.id = s.note_id
            WHERE s.user_id = :user_id
              AND n.deleted_at IS NULL
              {section_filter}
              AND {section_match}
    """
    if literal_fields_only:
        sql = f"""
            SELECT * FROM (
                SELECT
                    ranked.*,
                    row_number() OVER (
                        PARTITION BY note_id
                        ORDER BY raw_score DESC, source_type, section_id NULLS FIRST
                    ) AS note_rank
                FROM ({ranked_sql}) ranked
                WHERE raw_score > 0
            ) balanced
            WHERE note_rank <= 3
            ORDER BY raw_score DESC
            LIMIT :limit
        """
    else:
        sql = f"""
            SELECT * FROM ({ranked_sql}) ranked
            WHERE raw_score > 0
            ORDER BY raw_score DESC
            LIMIT :limit
        """
    params = {"user_id": user_id, "limit": limit, **_sql_term_params(terms)}
    if note_id:
        params["note_id"] = note_id
    result = await session.execute(text(sql), params)
    return [_row_source(row, terms, "heading", query_plan.intent) for row in result.mappings().all()]


async def _content_search_sources(
    session: AsyncSession,
    user_id: str,
    query_plan: QueryUnderstanding,
    note_id: Optional[str] = None,
    limit: int = 24,
    literal_fields_only: bool = False,
) -> list[LibrarySource]:
    terms = query_plan.terms
    if not terms:
        return []

    chunk_body = _sql_markdown_body("c.content") if literal_fields_only else "c.content"
    note_body = _sql_markdown_body("n.content") if literal_fields_only else "n.content"
    chunk_columns = [chunk_body] if literal_fields_only else ["c.content", "s.title"]
    chunk_weighted_columns = [(chunk_body, 18)] if literal_fields_only else [
        ("c.content", 18),
        ("s.title", 6),
        ("n.title", 4),
    ]
    required_terms = _literal_query_tokens(query_plan.search_query)
    chunk_match = (
        _sql_all_terms_match_condition(chunk_columns, terms, required_terms)
        if literal_fields_only
        else _sql_match_condition(chunk_columns, terms)
    )
    chunk_score = _sql_score_expression(chunk_weighted_columns, terms)
    note_columns = [note_body]
    note_match = (
        _sql_all_terms_match_condition(note_columns, terms, required_terms)
        if literal_fields_only
        else _sql_match_condition(note_columns, terms)
    )
    note_weighted_columns = [(note_body, 5)] if literal_fields_only else [
        ("n.content", 5),
        ("n.title", 3),
    ]
    note_score = _sql_score_expression(note_weighted_columns, terms)
    chunk_filter = "AND c.note_id = :note_id" if note_id else ""
    note_filter = "AND n.id = :note_id" if note_id else ""

    ranked_sql = f"""
            SELECT
                'chunk_content' AS source_type,
                n.id AS note_id,
                n.title AS note_title,
                s.id AS section_id,
                s.title AS section_title,
                c.id AS chunk_id,
                {chunk_body} AS snippet,
                ({chunk_score})::float AS raw_score
            FROM note_chunks c
            JOIN notes n ON n.id = c.note_id
            LEFT JOIN note_sections s ON s.id = c.section_id
            WHERE c.user_id = :user_id
              AND n.deleted_at IS NULL
              {chunk_filter}
              AND {chunk_match}

            UNION ALL

            SELECT
                'note_content' AS source_type,
                n.id AS note_id,
                n.title AS note_title,
                NULL::varchar AS section_id,
                NULL::varchar AS section_title,
                NULL::varchar AS chunk_id,
                {note_body} AS snippet,
                ({note_score})::float AS raw_score
            FROM notes n
            WHERE n.user_id = :user_id
              AND n.deleted_at IS NULL
              {note_filter}
              AND {note_match}
    """
    if literal_fields_only:
        sql = f"""
            SELECT * FROM (
                SELECT
                    ranked.*,
                    row_number() OVER (
                        PARTITION BY note_id
                        ORDER BY raw_score DESC, source_type, section_id NULLS FIRST
                    ) AS note_rank
                FROM ({ranked_sql}) ranked
                WHERE raw_score > 0
            ) balanced
            WHERE note_rank <= 3
            ORDER BY raw_score DESC
            LIMIT :limit
        """
    else:
        sql = f"""
            SELECT * FROM ({ranked_sql}) ranked
            WHERE raw_score > 0
            ORDER BY raw_score DESC
            LIMIT :limit
        """
    params = {"user_id": user_id, "limit": limit, **_sql_term_params(terms)}
    if note_id:
        params["note_id"] = note_id
    result = await session.execute(text(sql), params)
    return [_row_source(row, terms, "content", query_plan.intent) for row in result.mappings().all()]


async def _vector_search_sources(
    session: AsyncSession,
    user_id: str,
    query_plan: QueryUnderstanding,
    note_id: Optional[str] = None,
    limit: int = 16,
) -> list[LibrarySource]:
    if not embedding_enabled():
        return []

    try:
        query_result = await embed_texts([query_plan.search_query])
    except Exception:
        return []

    query_vector = query_result.embeddings[0] if query_result.embeddings else []
    if not query_vector:
        return []
    query_sql = """
        SELECT
            n.id AS note_id,
            n.title AS note_title,
            s.id AS section_id,
            s.title AS section_title,
            e.chunk_id,
            c.content AS snippet,
            1 - (e.embedding <=> CAST(:query_vector AS vector)) AS similarity
        FROM note_embeddings e
        JOIN note_chunks c ON c.id = e.chunk_id
        LEFT JOIN note_sections s ON s.id = e.section_id
        JOIN notes n ON n.id = e.note_id
        WHERE e.user_id = :user_id
          AND e.status = 'indexed'
          AND e.embedding IS NOT NULL
          AND n.deleted_at IS NULL
    """
    params: dict = {
        "user_id": user_id,
        "query_vector": vector_literal(query_vector),
        "limit": limit,
    }
    if note_id:
        query_sql += " AND e.note_id = :note_id"
        params["note_id"] = note_id
    query_sql += """
        ORDER BY e.embedding <=> CAST(:query_vector AS vector)
        LIMIT :limit
    """
    result = await session.execute(text(query_sql), params)
    ranked_rows = result.all()

    sources: list[LibrarySource] = []
    terms = query_plan.terms
    for note_id_value, note_title, section_id_value, section_title, chunk_id, snippet, similarity in ranked_rows:
        if similarity is None or similarity <= 0:
            continue
        sources.append(
            LibrarySource(
                note_id=note_id_value,
                note_title=note_title,
                section_id=section_id_value,
                section_title=section_title,
                chunk_id=chunk_id,
                source_type="vector_chunk",
                snippet=_snippet(snippet or "", terms),
                score=similarity,
                score_components={"vectorCosine": round(similarity, 6)},
                retrieval_channels=["vector"],
                query_intent=query_plan.intent,
            )
        )

    sources.sort(key=lambda item: item.score, reverse=True)
    return sources[:limit]


async def hybrid_search_notes(
    session: AsyncSession,
    user_id: str,
    query: str,
    note_id: Optional[str] = None,
    limit: int = 8,
) -> list[LibrarySource]:
    query_plan = understand_note_query(query, note_id=note_id)
    if not query_plan.terms:
        return []

    heading_sources = await _heading_search_sources(
        session,
        user_id,
        query_plan,
        note_id=note_id,
        limit=max(limit * 2, 12),
    )
    content_sources = await _content_search_sources(
        session,
        user_id,
        query_plan,
        note_id=note_id,
        limit=max(limit * 3, 16),
    )
    vector_sources = await _vector_search_sources(
        session,
        user_id,
        query_plan,
        note_id=note_id,
        limit=max(limit * 3, 12),
    )

    fused = _merge_rrf(
        [
            ("heading", heading_sources),
            ("content", content_sources),
            ("vector", vector_sources),
        ],
        limit=max(limit * 4, 24),
    )
    deduplicated = deduplicate_logical_sources(fused, limit=max(limit * 2, limit))
    precise_sources = prefer_section_sources(deduplicated, limit=max(limit * 2, limit))
    return filter_query_relevant_sources(precise_sources, query_plan, limit=limit)


async def literal_search_notes(
    session: AsyncSession,
    user_id: str,
    query: str,
    *,
    note_id: Optional[str] = None,
    scope: str = "all",
    limit: int = 20,
) -> list[LibrarySource]:
    """Search explicit title/content evidence without vector fallback."""

    if scope not in {"all", "title", "content"}:
        scope = "all"
    query_plan = understand_literal_search_query(query)
    if not query_plan.terms:
        return []

    ranked_lists: list[tuple[str, list[LibrarySource]]] = []
    if scope in {"all", "title"}:
        heading_sources = await _heading_search_sources(
            session,
            user_id,
            query_plan,
            note_id=note_id,
            limit=max(limit * 3, 30),
            literal_fields_only=True,
        )
        ranked_lists.append(("heading", heading_sources))
    if scope in {"all", "content"}:
        content_sources = await _content_search_sources(
            session,
            user_id,
            query_plan,
            note_id=note_id,
            limit=max(limit * 3, 24),
            literal_fields_only=True,
        )
        ranked_lists.append(("content", content_sources))

    candidate_limit = max(limit * 6, 60)
    fused = _merge_rrf(ranked_lists, limit=candidate_limit)
    deduplicated = deduplicate_logical_sources(fused, limit=candidate_limit)
    notes_with_chunk_match = {
        source.note_id
        for source in deduplicated
        if source.chunk_id and "content" in (source.retrieval_channels or [])
    }
    deduplicated = [
        source
        for source in deduplicated
        if not (
            source.source_type == "note_content"
            and source.note_id in notes_with_chunk_match
        )
    ]
    results: list[LibrarySource] = []
    note_match_counts: dict[str, int] = {}
    included_note_ids: set[str] = set()
    for source in deduplicated:
        if (
            source.note_id not in included_note_ids
            and len(included_note_ids) >= limit
        ):
            continue
        match_count = note_match_counts.get(source.note_id, 0)
        if match_count >= 3:
            continue
        included_note_ids.add(source.note_id)
        note_match_counts[source.note_id] = match_count + 1
        results.append(source)
    return results


def route_context_mode(question: str, selected_text: str = "") -> str:
    q = _normalize(question)
    if _is_smalltalk(question):
        return "general"
    if selected_text.strip():
        return "selection"
    if any(word in q for word in ["这一节", "这个小节", "本节"]):
        return "section"
    if any(word in q for word in ["总结", "概括", "全文", "整篇"]):
        return "summary"
    if any(word in q for word in ["结构", "大纲", "目录", "层次", "评价"]):
        return "structure"
    if any(word in q for word in ["区别", "对比", "比较", "关系"]):
        return "retrieval"
    return "retrieval"


def _source_out(source: LibrarySource) -> dict:
    return {
        "noteId": source.note_id,
        "noteTitle": source.note_title,
        "sectionId": source.section_id,
        "sectionTitle": source.section_title,
        "chunkId": source.chunk_id,
        "sourceType": source.source_type,
        "snippet": source.snippet,
        "score": round(source.score, 3),
        "scores": source.score_components or {},
        "retrievalChannels": source.retrieval_channels or [],
        "queryIntent": source.query_intent,
    }


def source_to_dict(source: LibrarySource) -> dict:
    return _source_out(source)


async def read_note_outline(session: AsyncSession, user_id: str, note_id: str) -> list[NoteSection]:
    result = await session.execute(
        select(NoteSection)
        .where(NoteSection.user_id == user_id, NoteSection.note_id == note_id)
        .order_by(NoteSection.sort_order)
    )
    return result.scalars().all()


async def read_note_sections(
    session: AsyncSession,
    user_id: str,
    note_id: str,
    section_ids: Optional[list[str]] = None,
) -> list[NoteSection]:
    conditions = [NoteSection.user_id == user_id, NoteSection.note_id == note_id]
    if section_ids:
        conditions.append(NoteSection.id.in_(section_ids))
    result = await session.execute(
        select(NoteSection).where(and_(*conditions)).order_by(NoteSection.sort_order)
    )
    return result.scalars().all()


def _context_from_sources(question: str, sources: list[LibrarySource]) -> str:
    blocks = []
    for index, source in enumerate(sources, start=1):
        label = source.section_title or source.note_title
        blocks.append(
            f"[{index}] 笔记：{source.note_title}\n"
            f"位置：{label}\n"
            f"片段：{source.snippet}"
        )
    source_text = "\n\n".join(blocks) or "没有找到相关片段。"
    return (
        f"用户问题：{question}\n\n"
        f"请优先参考以下 NoteFlow 检索上下文回答。"
        f"如果上下文与问题无关或信息不足，可以明确说明并用通用知识补充；"
        f"不要因为上下文缺失而拒绝回答，除非用户明确要求只基于笔记。"
        f"只引用你实际使用的片段；需要引用时只写数字标记，例如 [1]、[2]，"
        f"不要写“来源 1”“来源 2”。\n\n"
        f"{source_text}"
    )


def _library_context_from_sources(
    question: str,
    search_query: str,
    sources: list[LibrarySource],
) -> str:
    if not search_query:
        return (
            f"用户问题：{question}\n\n"
            f"NoteFlow 本地笔记库搜索未执行：用户没有给出明确主题，当前也没有可用的上下文主题。\n\n"
            f"回答要求：请直接告诉用户需要补充要搜索的主题，不要声称没有权限访问笔记库，不要编造搜索结果。"
        )

    if not sources:
        return (
            f"用户问题：{question}\n\n"
            f"NoteFlow 本地笔记库搜索词：{search_query}\n"
            f"搜索结果：没有找到相关笔记。\n\n"
            f"回答要求：明确说明没有在本地 NoteFlow 笔记库找到相关内容。"
            f"不要声称无法访问笔记库，不要建议用户自己去搜索，不要编造结果。"
        )

    blocks = []
    for index, source in enumerate(sources, start=1):
        label = source.section_title or source.note_title
        blocks.append(
            f"[{index}] 笔记：{source.note_title}\n"
            f"位置：{label}\n"
            f"片段：{source.snippet}"
        )
    return (
        f"用户问题：{question}\n\n"
        f"NoteFlow 本地笔记库搜索词：{search_query}\n\n"
        f"搜索结果：\n{chr(10).join(blocks)}\n\n"
        f"回答要求：基于这些本地搜索结果回答用户是否有相关文章。"
        f"先给结论，再列出匹配的笔记标题和原因。不要说无法访问笔记库，不要把它说成联网搜索。"
        f"只引用你实际使用的片段；需要引用时只写数字标记，例如 [1]、[2]，"
        f"不要写“来源 1”“来源 2”。"
    )


async def build_library_context(
    session: AsyncSession,
    user_id: str,
    question: str,
    fallback_query: str = "",
) -> ContextResult:
    query_plan = understand_note_query(question, fallback_query=fallback_query)
    search_query = query_plan.search_query
    if not search_query:
        return ContextResult(
            context_mode="library_search",
            context_text=_library_context_from_sources(question, search_query, []),
            sources=[],
        )

    sources = await hybrid_search_notes(session, user_id, search_query, note_id=None, limit=8)
    sources = filter_sources_with_direct_query_evidence(sources, query_plan)
    return ContextResult(
        context_mode="library_search",
        context_text=_library_context_from_sources(question, search_query, sources),
        sources=sources,
    )


async def build_note_context(
    session: AsyncSession,
    user_id: str,
    note: Note,
    question: str,
    selected_text: str = "",
    unsaved_content: str = "",
    current_section_id: Optional[str] = None,
) -> ContextResult:
    mode = route_context_mode(question, selected_text)

    if mode == "general":
        return ContextResult(
            context_mode="general",
            context_text="",
            sources=[],
        )

    if mode == "selection" and selected_text.strip():
        source = LibrarySource(
            note_id=note.id,
            note_title=note.title,
            section_id=current_section_id,
            section_title="选中文本",
            chunk_id=None,
            source_type="selection",
            snippet=_snippet(selected_text, _terms(question), max_chars=360),
            score=100,
        )
        return ContextResult(
            context_mode="selection",
            context_text=(
                f"用户问题：{question}\n\n"
                f"用户显式加入对话的选中内容如下。请把它作为本轮回答的唯一主要上下文；"
                f"如果用户问“啥意思/什么意思/怎么理解”，只解释这段内容本身，"
                f"不要展开当前笔记里的其他主题，除非用户明确要求关联整篇笔记。\n\n"
                f"选中内容：\n{_trim_context(selected_text)}"
            ),
            sources=[source],
        )

    content = unsaved_content.strip() or note.content or ""
    if mode in {"summary", "structure"}:
        sections = parse_markdown_sections(content)
        outline = "\n".join(
            f"{'  ' * max(0, section.level - 1)}- H{section.level} {section.title}"
            for section in sections
        )
        source = LibrarySource(
            note_id=note.id,
            note_title=note.title,
            section_id=None,
            section_title="当前笔记全文",
            chunk_id=None,
            source_type=mode,
            snippet=_snippet(content, _terms(question), max_chars=360),
            score=90,
        )
        return ContextResult(
            context_mode=mode,
            context_text=_trim_context(
                f"用户问题：{question}\n\n"
                f"当前笔记标题：{note.title}\n\n"
                f"当前笔记大纲：\n{outline}\n\n"
                f"当前笔记全文：\n{content}"
            ),
            sources=[source],
        )

    if unsaved_content.strip():
        parsed_sources: list[LibrarySource] = []
        terms = _terms(question)
        for section in parse_markdown_sections(unsaved_content):
            for chunk_index, chunk in enumerate(split_section_chunks(section.content)):
                score = _contains_score(section.title, terms, 18) + _contains_score(chunk, terms, 12)
                if score <= 0:
                    continue
                parsed_sources.append(
                    LibrarySource(
                        note_id=note.id,
                        note_title=note.title,
                        section_id=section.id,
                        section_title=section.title,
                        chunk_id=f"unsaved-{chunk_index}",
                        source_type="unsaved_chunk",
                        snippet=_snippet(chunk, terms),
                        score=score + 5,
                    )
                )
        parsed_sources.sort(key=lambda item: item.score, reverse=True)
        if parsed_sources:
            sources = parsed_sources[:6]
            return ContextResult(
                context_mode="retrieval",
                context_text=_context_from_sources(question, sources),
                sources=sources,
            )

    sources = await hybrid_search_notes(session, user_id, question, note_id=note.id, limit=6)
    if not sources and content.strip():
        if not _should_fallback_to_current_note(question, note, content, selected_text):
            return ContextResult(
                context_mode="general",
                context_text="",
                sources=[],
            )
        source = LibrarySource(
            note_id=note.id,
            note_title=note.title,
            section_id=None,
            section_title="当前笔记全文",
            chunk_id=None,
            source_type="full",
            snippet=_snippet(content, _terms(question), max_chars=360),
            score=1,
        )
        return ContextResult(
            context_mode="full",
            context_text=_trim_context(
                f"用户问题：{question}\n\n当前笔记全文：\n{content}"
            ),
            sources=[source],
        )

    return ContextResult(
        context_mode="retrieval",
        context_text=_context_from_sources(question, sources),
        sources=sources,
    )


async def list_related_notes(
    session: AsyncSession,
    user_id: str,
    note: Note,
    limit: int = 6,
) -> list[LibrarySource]:
    query = " ".join([note.title, " ".join(note.tags or [])]).strip()
    sources = await hybrid_search_notes(session, user_id, query, note_id=None, limit=limit + 3)
    related: list[LibrarySource] = []
    seen_note_ids: set[str] = set()
    for source in sources:
        if source.note_id == note.id or source.note_id in seen_note_ids:
            continue
        seen_note_ids.add(source.note_id)
        related.append(source)
        if len(related) >= limit:
            break
    return related
