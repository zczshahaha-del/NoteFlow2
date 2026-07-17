from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import Note, NoteSection
from app.services.note_library import LibrarySource, hybrid_search_notes, source_to_dict, understand_note_query


@dataclass
class RagEvalCase:
    id: str
    query: str
    note_id: Optional[str] = None
    expected_note_ids: list[str] = field(default_factory=list)
    expected_section_ids: list[str] = field(default_factory=list)
    expected_chunk_ids: list[str] = field(default_factory=list)
    expected_keywords: list[str] = field(default_factory=list)


def _clean_list(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values or []:
        item = (value or "").strip()
        if not item or item in seen:
            continue
        seen.add(item)
        result.append(item)
    return result


def _compact(value: str) -> str:
    return re.sub(r"\s+", "", (value or "").lower())


def _source_text(source: LibrarySource) -> str:
    return "\n".join(
        [
            source.note_title or "",
            source.section_title or "",
            source.source_type or "",
            source.snippet or "",
        ]
    )


def _matches_expected(case: RagEvalCase, source: LibrarySource) -> bool:
    note_ids = set(case.expected_note_ids)
    section_ids = set(case.expected_section_ids)
    chunk_ids = set(case.expected_chunk_ids)
    if chunk_ids:
        return bool(source.chunk_id and source.chunk_id in chunk_ids)
    if section_ids:
        return bool(source.section_id and source.section_id in section_ids)
    return bool(source.note_id and source.note_id in note_ids)


def _first_rank(sources: list[LibrarySource], predicate) -> Optional[int]:
    for index, source in enumerate(sources, start=1):
        if predicate(source):
            return index
    return None


def _matched_keywords_for_source(source: LibrarySource, keywords: list[str]) -> list[str]:
    text = _compact(_source_text(source))
    return [keyword for keyword in keywords if keyword and _compact(keyword) in text]


def _matched_keywords(sources: list[LibrarySource], keywords: list[str]) -> list[str]:
    matched: list[str] = []
    seen: set[str] = set()
    for source in sources:
        for keyword in _matched_keywords_for_source(source, keywords):
            if keyword not in seen:
                seen.add(keyword)
                matched.append(keyword)
    return matched


def _channel_counts(sources: list[LibrarySource]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for source in sources:
        channels = source.retrieval_channels or [source.source_type]
        for channel in channels:
            counts[channel] = counts.get(channel, 0) + 1
    return dict(sorted(counts.items()))


def _ratio(count: int, total: int) -> float:
    return round(count / total, 4) if total else 0.0


def evaluate_rag_sources(
    case: RagEvalCase,
    sources: list[LibrarySource],
    success_at: int = 5,
    keyword_threshold: float = 0.6,
) -> dict:
    case.expected_note_ids = _clean_list(case.expected_note_ids)
    case.expected_section_ids = _clean_list(case.expected_section_ids)
    case.expected_chunk_ids = _clean_list(case.expected_chunk_ids)
    case.expected_keywords = _clean_list(case.expected_keywords)

    note_rank = _first_rank(sources, lambda source: source.note_id in set(case.expected_note_ids))
    section_rank = _first_rank(sources, lambda source: source.section_id in set(case.expected_section_ids))
    chunk_rank = _first_rank(sources, lambda source: source.chunk_id in set(case.expected_chunk_ids))
    if case.expected_chunk_ids:
        target_rank = chunk_rank
    elif case.expected_section_ids:
        target_rank = section_rank
    else:
        target_rank = note_rank
    has_expected_ids = bool(case.expected_note_ids or case.expected_section_ids or case.expected_chunk_ids)

    matched_keywords = _matched_keywords(sources, case.expected_keywords)
    has_expected_keywords = bool(case.expected_keywords)
    keyword_coverage = (
        round(len(matched_keywords) / len(case.expected_keywords), 4)
        if has_expected_keywords
        else None
    )

    id_passed = target_rank is not None and target_rank <= success_at if has_expected_ids else None
    keyword_passed = (
        keyword_coverage is not None and keyword_coverage >= keyword_threshold
        if has_expected_keywords
        else None
    )
    if id_passed is not None and keyword_passed is not None:
        passed = id_passed and keyword_passed
    elif id_passed is not None:
        passed = id_passed
    else:
        passed = keyword_passed

    query_plan = understand_note_query(case.query, note_id=case.note_id)
    top_results = []
    for rank, source in enumerate(sources, start=1):
        item = source_to_dict(source)
        item["rank"] = rank
        item["matchesExpected"] = _matches_expected(case, source)
        item["matchedKeywords"] = _matched_keywords_for_source(source, case.expected_keywords)
        top_results.append(item)

    return {
        "id": case.id,
        "query": case.query,
        "noteId": case.note_id,
        "queryPlan": {
            "searchQuery": query_plan.search_query,
            "intent": query_plan.intent,
            "scopeHint": query_plan.scope_hint,
            "terms": query_plan.terms,
            "rewrittenQueries": query_plan.rewritten_queries,
        },
        "expected": {
            "noteIds": case.expected_note_ids,
            "sectionIds": case.expected_section_ids,
            "chunkIds": case.expected_chunk_ids,
            "keywords": case.expected_keywords,
        },
        "metrics": {
            "resultCount": len(sources),
            "noteRank": note_rank,
            "sectionRank": section_rank,
            "chunkRank": chunk_rank,
            "targetRank": target_rank,
            "hitAt1": target_rank is not None and target_rank <= 1 if has_expected_ids else None,
            "hitAt3": target_rank is not None and target_rank <= 3 if has_expected_ids else None,
            "hitAt5": target_rank is not None and target_rank <= 5 if has_expected_ids else None,
            "mrr": round(1 / target_rank, 4) if target_rank else (0.0 if has_expected_ids else None),
            "keywordCoverage": keyword_coverage,
            "matchedKeywords": matched_keywords,
            "passed": passed,
        },
        "channels": _channel_counts(sources),
        "topResults": top_results,
    }


def summarize_rag_eval_results(results: list[dict]) -> dict:
    id_judged = [item for item in results if item["metrics"]["targetRank"] is not None or item["expected"]["noteIds"] or item["expected"]["sectionIds"] or item["expected"]["chunkIds"]]
    keyword_judged = [item for item in results if item["metrics"]["keywordCoverage"] is not None]
    passed_judged = [item for item in results if item["metrics"]["passed"] is not None]
    channel_counts: dict[str, int] = {}
    for item in results:
        for channel, count in item["channels"].items():
            channel_counts[channel] = channel_counts.get(channel, 0) + count

    return {
        "totalCases": len(results),
        "idJudgedCases": len(id_judged),
        "keywordJudgedCases": len(keyword_judged),
        "passRate": _ratio(sum(1 for item in passed_judged if item["metrics"]["passed"]), len(passed_judged)),
        "hitAt1": _ratio(sum(1 for item in id_judged if item["metrics"]["hitAt1"]), len(id_judged)),
        "hitAt3": _ratio(sum(1 for item in id_judged if item["metrics"]["hitAt3"]), len(id_judged)),
        "hitAt5": _ratio(sum(1 for item in id_judged if item["metrics"]["hitAt5"]), len(id_judged)),
        "mrr": round(sum(item["metrics"]["mrr"] or 0.0 for item in id_judged) / len(id_judged), 4) if id_judged else 0.0,
        "avgKeywordCoverage": (
            round(sum(item["metrics"]["keywordCoverage"] or 0.0 for item in keyword_judged) / len(keyword_judged), 4)
            if keyword_judged
            else 0.0
        ),
        "avgResultCount": round(sum(item["metrics"]["resultCount"] for item in results) / len(results), 2) if results else 0.0,
        "channelCounts": dict(sorted(channel_counts.items())),
    }


async def run_rag_eval(
    session: AsyncSession,
    user_id: str,
    cases: list[RagEvalCase],
    limit: int = 8,
    success_at: int = 5,
    keyword_threshold: float = 0.6,
) -> dict:
    results = []
    for case in cases:
        sources = await hybrid_search_notes(
            session,
            user_id,
            case.query,
            note_id=case.note_id,
            limit=limit,
        )
        results.append(
            evaluate_rag_sources(
                case,
                sources,
                success_at=success_at,
                keyword_threshold=keyword_threshold,
            )
        )
    return {
        "summary": summarize_rag_eval_results(results),
        "results": results,
    }


def _usable_query(value: str) -> bool:
    compact = _compact(value)
    return bool(compact and len(compact) >= 3 and compact not in {"正文", "未命名笔记"})


async def build_auto_rag_eval_cases(
    session: AsyncSession,
    user_id: str,
    case_limit: int = 20,
) -> list[RagEvalCase]:
    case_limit = max(1, min(case_limit, 100))
    cases: list[RagEvalCase] = []
    note_case_limit = max(1, case_limit // 2)

    notes_result = await session.execute(
        select(Note)
        .where(Note.user_id == user_id, Note.deleted_at.is_(None))
        .order_by(Note.updated_at.desc())
        .limit(case_limit)
    )
    for note in notes_result.scalars().all():
        if not _usable_query(note.title):
            continue
        cases.append(
            RagEvalCase(
                id=f"note-title:{note.id}",
                query=note.title,
                expected_note_ids=[note.id],
                expected_keywords=[note.title],
            )
        )
        if len(cases) >= note_case_limit:
            break

    sections_result = await session.execute(
        select(NoteSection, Note.title)
        .join(Note, Note.id == NoteSection.note_id)
        .where(and_(NoteSection.user_id == user_id, Note.deleted_at.is_(None)))
        .order_by(Note.updated_at.desc(), NoteSection.sort_order.asc())
        .limit(case_limit * 3)
    )
    for section, note_title in sections_result.all():
        if not _usable_query(section.title):
            continue
        cases.append(
            RagEvalCase(
                id=f"section-title:{section.id}",
                query=section.title,
                expected_note_ids=[section.note_id],
                expected_section_ids=[section.id],
                expected_keywords=[section.title, note_title],
            )
        )
        if len(cases) >= case_limit:
            break

    return cases
