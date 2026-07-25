from __future__ import annotations

import re
from dataclasses import dataclass

from app.config import cfg
from app.rag.v2.parser import estimate_tokens
from app.rag.v2.retrieval import RetrievalCandidate


@dataclass(frozen=True)
class Citation:
    index: int
    citation_id: str
    note_id: str
    note_title: str
    section_key: str
    section_path: list[str]
    node_id: str
    score: float
    source_version: str
    start_line: int | None
    end_line: int | None
    snippet: str
    channels: list[str]


@dataclass(frozen=True)
class BuiltContext:
    text: str
    citations: list[Citation]
    token_count: int
    dropped_count: int


def build_context(
    question: str,
    candidates: list[RetrievalCandidate],
    *,
    token_budget: int | None = None,
    top_k: int | None = None,
) -> BuiltContext:
    budget = max(300, token_budget or cfg.RAG_CONTEXT_TOKEN_BUDGET)
    # Citations are user-facing evidence, not the complete retrieval trace.
    # Keep the strongest chunk from each section and cap the visible evidence
    # set so answers do not become a wall of near-duplicate references.
    result_limit = min(4, max(1, top_k or cfg.RAG_TOP_K))
    selected: list[RetrievalCandidate] = []
    selected_sections: set[tuple[str, str]] = set()
    used_tokens = 0
    for candidate in candidates:
        section_identity = (candidate.note_id, candidate.section_key)
        if section_identity in selected_sections:
            continue
        cost = estimate_tokens(candidate.content) + 40
        if selected and used_tokens + cost > budget:
            continue
        selected.append(candidate)
        selected_sections.add(section_identity)
        used_tokens += cost
        if len(selected) >= result_limit:
            break

    citations: list[Citation] = []
    blocks: list[str] = []
    for index, candidate in enumerate(selected, start=1):
        citation = Citation(
            index=index,
            citation_id=f"cite-{candidate.node_id[:16]}",
            note_id=candidate.note_id,
            note_title=candidate.note_title,
            section_key=candidate.section_key,
            section_path=list(candidate.section_path),
            node_id=candidate.node_id,
            score=round(candidate.score, 8),
            source_version=candidate.source_version,
            start_line=candidate.start_line,
            end_line=candidate.end_line,
            snippet=candidate.content[:500],
            channels=list(candidate.channels),
        )
        citations.append(citation)
        blocks.append(
            f"[{index}] citation_id={citation.citation_id}\n"
            f"笔记：{citation.note_title}\n"
            f"位置：{' / '.join(citation.section_path) or '正文'}\n"
            f"证据：{candidate.content}"
        )

    if not citations:
        return BuiltContext(
            text=(
                f"用户问题：{question}\n\n"
                "NoteFlow RAG v2 没有检索到可用来源。"
                "必须明确告诉用户未在其笔记中找到答案，不得使用通用知识伪装成笔记内容，也不得生成引用。"
            ),
            citations=[],
            token_count=estimate_tokens(question),
            dropped_count=len(candidates),
        )
    text = (
        f"用户问题：{question}\n\n"
        "你只能依据下面的 NoteFlow 笔记来源回答。每个事实后使用真实存在的数字引用，如 [1]。"
        "不得引用未提供的编号；证据不足时明确说明。引用要克制：每个核心结论或自然段通常引用一次，"
        "不要在连续短句、同一组操作步骤中反复标注相同来源；只有结论确实综合多处证据时，"
        "才在同一处使用两个引用。\n\n"
        + "\n\n".join(blocks)
    )
    return BuiltContext(
        text=text,
        citations=citations,
        token_count=estimate_tokens(text),
        dropped_count=max(0, len(candidates) - len(selected)),
    )


def citation_to_dict(citation: Citation) -> dict:
    return {
        "citationIndex": citation.index,
        "citationId": citation.citation_id,
        "noteId": citation.note_id,
        "noteTitle": citation.note_title,
        "sectionId": citation.section_key,
        "sectionTitle": " / ".join(citation.section_path) or "正文",
        "sectionPath": citation.section_path,
        "chunkId": citation.node_id,
        "sourceType": "rag_v2_node",
        "snippet": citation.snippet,
        "score": citation.score,
        "sourceVersion": citation.source_version,
        "startLine": citation.start_line,
        "endLine": citation.end_line,
        "retrievalChannels": citation.channels,
    }


def validate_citation_indexes(answer: str, valid: set[int]) -> tuple[str, dict]:
    referenced = [int(value) for value in re.findall(r"\[(\d+)\]", answer or "")]
    invalid = sorted({value for value in referenced if value not in valid})
    cleaned = re.sub(
        r"\[(\d+)\]",
        lambda match: match.group(0) if int(match.group(1)) in valid else "",
        answer or "",
    )
    used = sorted({value for value in referenced if value in valid})
    return cleaned, {
        "valid": not invalid,
        "used": used,
        "invalid": invalid,
        "coverage": round(len(used) / len(valid), 4) if valid else (1.0 if not referenced else 0.0),
    }


def validate_citations(answer: str, citations: list[Citation]) -> tuple[str, dict]:
    cleaned, metrics = validate_citation_indexes(
        answer,
        {citation.index for citation in citations},
    )
    metrics["coverage"] = (
        round(len(metrics["used"]) / len(citations), 4)
        if citations
        else (1.0 if not re.findall(r"\[(\d+)\]", answer or "") else 0.0)
    )
    return cleaned, metrics
