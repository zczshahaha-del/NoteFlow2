from __future__ import annotations

import asyncio
import inspect
import unittest
from pathlib import Path

from app.agent.contracts import RuntimeErrorCode, RuntimeEvent
from app.config import cfg
from app.providers.contracts import (
    ChatModelProvider,
    EmbeddingProvider,
    MemoryProvider,
    RerankCandidate,
    RerankerProvider,
    VectorStoreProvider,
)
from app.providers.registry import legacy_provider_registry
from app.repositories.base import require_user_id
from app.repositories import (
    AttachmentRepository,
    DraftRepository,
    EditRepository,
    IndexJobRepository,
    MemoryRepository,
    NoteRepository,
    RunRepository,
)
from app.tools.contracts import SourceRef, ToolContext, ToolResult, reject_model_user_id


class ArchitectureContractTest(unittest.TestCase):
    def test_legacy_registry_implements_every_provider_protocol(self) -> None:
        registry = legacy_provider_registry()
        self.assertIsInstance(registry.chat, ChatModelProvider)
        self.assertIsInstance(registry.embedding, EmbeddingProvider)
        self.assertIsInstance(registry.reranker, RerankerProvider)
        self.assertIsInstance(registry.vector_store, VectorStoreProvider)
        self.assertIsInstance(registry.memory, MemoryProvider)

    def test_legacy_flags_are_safe_defaults(self) -> None:
        self.assertEqual(cfg.AGENT_RUNTIME, "legacy")
        self.assertEqual(cfg.RAG_PROVIDER, "legacy")
        self.assertEqual(cfg.MEMORY_PROVIDER, "legacy")
        self.assertEqual(cfg.AI_CANARY_PERCENT, 0)
        self.assertFalse(cfg.LANGGRAPH_POC_ENABLED)
        self.assertFalse(cfg.LANGGRAPH_SHADOW_ENABLED)
        self.assertEqual(cfg.LANGGRAPH_SHADOW_SAMPLE_PERCENT, 0)

    def test_tool_identity_only_comes_from_context(self) -> None:
        context = ToolContext(user_id="user-a", run_id="run-a")
        self.assertEqual(context.user_id, "user-a")
        with self.assertRaises(ValueError):
            reject_model_user_id({"query": "hello", "user_id": "user-b"})
        with self.assertRaises(ValueError):
            reject_model_user_id({"userId": "user-b"})

    def test_runtime_event_and_tool_result_have_stable_wire_shape(self) -> None:
        source = SourceRef(note_id="note-a", note_title="A", snippet="evidence", score=0.8)
        event = RuntimeEvent(
            type="context",
            status="success",
            code=RuntimeErrorCode.AI_STREAM_FAILED.value,
            sources=[source],
            payload={"contextMode": "library"},
        ).to_wire()
        self.assertEqual(event["type"], "context")
        self.assertEqual(event["contextMode"], "library")
        self.assertEqual(event["sources"][0]["note_id"], "note-a")
        result = ToolResult(status="success", sources=[source])
        self.assertEqual(result.status, "success")

    def test_repository_rejects_empty_ownership_scope(self) -> None:
        with self.assertRaises(ValueError):
            require_user_id("")

    def test_legacy_reranker_is_deterministic(self) -> None:
        candidates = [
            RerankCandidate(id="low", text="low", score=0.1),
            RerankCandidate(id="high", text="high", score=0.9),
        ]
        ranked = asyncio.run(legacy_provider_registry().reranker.rerank("query", candidates, 1))
        self.assertEqual([item.id for item in ranked], ["high"])

    def test_migrated_routers_do_not_embed_sql_queries(self) -> None:
        router_root = Path(__file__).resolve().parents[1] / "app" / "routers"
        for name in ("agent.py", "ai.py", "attachments.py", "drafts.py", "edits.py", "memories.py", "notes.py"):
            source = (router_root / name).read_text(encoding="utf-8")
            self.assertNotIn("from sqlalchemy", source, name)
            self.assertNotIn("session.execute(", source, name)
            self.assertNotIn("db.execute(", source, name)

    def test_owned_repository_methods_require_user_scope(self) -> None:
        repositories = (
            AttachmentRepository,
            DraftRepository,
            EditRepository,
            IndexJobRepository,
            MemoryRepository,
            NoteRepository,
            RunRepository,
        )
        exceptions = {(AttachmentRepository, "get_by_signed_id")}
        for repository in repositories:
            for name, method in inspect.getmembers(repository, predicate=inspect.iscoroutinefunction):
                if name.startswith("_") or (repository, name) in exceptions:
                    continue
                parameters = list(inspect.signature(method).parameters)
                self.assertGreaterEqual(len(parameters), 2, f"{repository.__name__}.{name}")
                self.assertEqual(parameters[1], "user_id", f"{repository.__name__}.{name}")

    def test_tool_boundary_has_no_database_or_orm_dependency(self) -> None:
        tools_root = Path(__file__).resolve().parents[1] / "app" / "tools"
        source = "\n".join(path.read_text(encoding="utf-8") for path in tools_root.glob("*.py"))
        self.assertNotIn("app.database", source)
        self.assertNotIn("app.models", source)
        self.assertNotIn("sqlalchemy", source)


if __name__ == "__main__":
    unittest.main()
