"""Versioned NoteFlow RAG implementation.

Nothing in this package is selected by the production path unless
``RAG_PROVIDER=llamaindex`` is explicitly enabled in a later rollout step.
"""

from app.rag.v2.parser import PARSER_VERSION, StructuredNode, parse_markdown_nodes

__all__ = ["PARSER_VERSION", "StructuredNode", "parse_markdown_nodes"]
