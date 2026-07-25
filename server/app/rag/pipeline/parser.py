from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from typing import Any

from markdown_it import MarkdownIt


PARSER_VERSION = "commonmark-ast-v2"
CHUNKER_VERSION = "structure-700-80-v2"
_ATOMIC_TYPES = {"fence", "code_block", "table", "bullet_list", "ordered_list", "blockquote"}
_WORD_RE = re.compile(r"[\u3400-\u9fff]|[A-Za-z0-9_]+|[^\s]", re.UNICODE)


@dataclass(frozen=True)
class MarkdownBlock:
    kind: str
    text: str
    start_line: int
    end_line: int
    token_count: int


@dataclass
class MarkdownSection:
    title: str
    level: int
    path: list[str]
    section_key: str
    blocks: list[MarkdownBlock] = field(default_factory=list)


@dataclass(frozen=True)
class StructuredNode:
    id: str
    note_id: str
    section_key: str
    section_path: list[str]
    node_type: str
    node_index: int
    content: str
    token_count: int
    content_hash: str
    block_types: list[str]
    metadata: dict[str, Any]


def estimate_tokens(text: str) -> int:
    return max(1, len(_WORD_RE.findall(text or "")))


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _normalized_title(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip()).casefold() or "正文"


def _block_kind(token_type: str) -> str:
    if token_type.endswith("_open"):
        return token_type[:-5]
    return token_type


def parse_markdown_ast(markdown: str, note_id: str) -> list[MarkdownSection]:
    """Parse Markdown without modifying or round-tripping the source text."""

    source = (markdown or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = source.split("\n")
    parser = MarkdownIt("commonmark").enable("table")
    tokens = parser.parse(source)
    sections: list[MarkdownSection] = []
    stack: dict[int, tuple[str, str]] = {}
    duplicate_counts: dict[tuple[str, str], int] = {}
    current: MarkdownSection | None = None

    def start_section(title: str, level: int) -> MarkdownSection:
        nonlocal current
        display_title = re.sub(r"\s+", " ", title.strip()) or "正文"
        parent_parts = [stack[index][1] for index in sorted(stack) if index < level]
        parent_identity = "/".join(parent_parts)
        normalized = _normalized_title(display_title)
        duplicate_key = (parent_identity, normalized)
        occurrence = duplicate_counts.get(duplicate_key, 0)
        duplicate_counts[duplicate_key] = occurrence + 1
        identity_part = f"{normalized}#{occurrence}"
        stack[level] = (display_title, identity_part)
        for existing in list(stack):
            if existing > level:
                del stack[existing]
        path = [stack[index][0] for index in sorted(stack) if index <= level]
        identity_path = [stack[index][1] for index in sorted(stack) if index <= level]
        current = MarkdownSection(
            title=display_title,
            level=level,
            path=path,
            section_key=_hash(f"{note_id}|{'/'.join(identity_path)}")[:64],
        )
        sections.append(current)
        return current

    index = 0
    while index < len(tokens):
        token = tokens[index]
        if token.type == "heading_open":
            title = tokens[index + 1].content if index + 1 < len(tokens) else "正文"
            level = int(token.tag[1:]) if token.tag.startswith("h") else 1
            start_section(title, level)
            index += 1
            continue

        is_top_level_block = (
            token.map is not None
            and token.level == 0
            and (
                token.type.endswith("_open")
                or token.type in {"fence", "code_block", "html_block", "hr"}
            )
            and token.type != "heading_open"
        )
        if is_top_level_block:
            if current is None:
                current = start_section("正文", 1)
            start_line, end_line = token.map
            text = "\n".join(lines[start_line:end_line]).strip()
            if text:
                current.blocks.append(
                    MarkdownBlock(
                        kind=_block_kind(token.type),
                        text=text,
                        start_line=start_line,
                        end_line=end_line,
                        token_count=estimate_tokens(text),
                    )
                )
        index += 1

    if not sections:
        section = start_section("正文", 1)
        if source.strip():
            section.blocks.append(
                MarkdownBlock("paragraph", source.strip(), 0, len(lines), estimate_tokens(source))
            )
    return sections


def _split_oversized(text: str, max_tokens: int) -> list[str]:
    if estimate_tokens(text) <= max_tokens:
        return [text]
    lines = text.splitlines(keepends=True)
    pieces: list[str] = []
    current = ""
    for line in lines:
        candidate = current + line
        if current and estimate_tokens(candidate) > max_tokens:
            pieces.append(current.strip())
            current = line
        else:
            current = candidate
        while estimate_tokens(current) > max_tokens and len(current) > 1:
            ratio = max_tokens / estimate_tokens(current)
            cut = max(1, int(len(current) * ratio * 0.92))
            pieces.append(current[:cut].strip())
            current = current[cut:]
    if current.strip():
        pieces.append(current.strip())
    return [piece for piece in pieces if piece]


def _tail_for_overlap(text: str, overlap_tokens: int) -> str:
    if overlap_tokens <= 0 or not text:
        return ""
    words = list(_WORD_RE.finditer(text))
    if len(words) <= overlap_tokens:
        return text
    return text[words[-overlap_tokens].start() :]


def _section_chunks(
    section: MarkdownSection,
    target_tokens: int,
    max_tokens: int,
    overlap_tokens: int,
) -> list[tuple[str, list[str], int, int]]:
    chunks: list[tuple[str, list[str], int, int]] = []
    current: list[MarkdownBlock] = []

    def flush() -> None:
        nonlocal current
        if not current:
            return
        content = "\n\n".join(block.text for block in current).strip()
        chunks.append((content, [block.kind for block in current], current[0].start_line, current[-1].end_line))
        current = []

    for block in section.blocks:
        atomic = block.kind in _ATOMIC_TYPES
        if atomic:
            flush()
            for piece in _split_oversized(block.text, max_tokens):
                chunks.append((piece, [block.kind], block.start_line, block.end_line))
            continue
        pieces = _split_oversized(block.text, max_tokens)
        for piece in pieces:
            piece_block = MarkdownBlock(block.kind, piece, block.start_line, block.end_line, estimate_tokens(piece))
            candidate = "\n\n".join([*(item.text for item in current), piece])
            if current and estimate_tokens(candidate) > target_tokens:
                previous = "\n\n".join(item.text for item in current)
                flush()
                overlap = _tail_for_overlap(previous, overlap_tokens)
                if overlap:
                    current.append(MarkdownBlock("overlap", overlap, block.start_line, block.start_line, estimate_tokens(overlap)))
            current.append(piece_block)
            if estimate_tokens("\n\n".join(item.text for item in current)) >= max_tokens:
                flush()
    flush()
    return chunks


def parse_markdown_nodes(
    markdown: str,
    *,
    note_id: str,
    note_title: str,
    source_version: str,
    target_tokens: int = 700,
    max_tokens: int = 1000,
    overlap_tokens: int = 80,
) -> list[StructuredNode]:
    target_tokens = max(100, min(target_tokens, max_tokens))
    max_tokens = max(target_tokens, max_tokens)
    overlap_tokens = max(0, min(overlap_tokens, target_tokens // 2))
    nodes: list[StructuredNode] = []
    for section in parse_markdown_ast(markdown, note_id):
        for node_index, (content, block_types, start_line, end_line) in enumerate(
            _section_chunks(section, target_tokens, max_tokens, overlap_tokens)
        ):
            digest = _hash(content)
            node_id = _hash(f"{note_id}|{section.section_key}|{node_index}|{digest}")[:64]
            node_type = block_types[0] if len(set(block_types)) == 1 else "mixed"
            metadata = {
                "note_id": note_id,
                "note_title": note_title,
                "section_path": list(section.path),
                "section_title": section.title,
                "source_version": source_version,
                "parser_version": PARSER_VERSION,
                "chunker_version": CHUNKER_VERSION,
                "start_line": start_line,
                "end_line": end_line,
            }
            nodes.append(
                StructuredNode(
                    id=node_id,
                    note_id=note_id,
                    section_key=section.section_key,
                    section_path=list(section.path),
                    node_type=node_type,
                    node_index=node_index,
                    content=content,
                    token_count=estimate_tokens(content),
                    content_hash=digest,
                    block_types=block_types,
                    metadata=metadata,
                )
            )
    return nodes


def to_llamaindex_nodes(nodes: list[StructuredNode]) -> list[Any]:
    """Adapt our stable storage nodes to LlamaIndex without making it source of truth."""

    try:
        from llama_index.core.schema import TextNode
    except ImportError as exc:  # pragma: no cover - production image has the locked dependency
        raise RuntimeError("llama-index-core is not installed") from exc
    return [TextNode(id_=node.id, text=node.content, metadata=dict(node.metadata)) for node in nodes]
