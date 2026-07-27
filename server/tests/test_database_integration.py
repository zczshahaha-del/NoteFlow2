from __future__ import annotations

import asyncio
import importlib.metadata
import os
import unittest
import uuid
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import asyncpg
from sqlalchemy import delete, func, select

from app.config import cfg
from app.database import AsyncSessionLocal, engine
from app.models.db import (
    AgentRun,
    AgentCheckpoint,
    Base,
    ChatSession,
    Note,
    NoteAttachment,
    NoteDraft,
    NoteEditPreview,
    NoteIndexJob,
    RagIndexState,
    RagEmbedding,
    RagNode,
    User,
    UserMemory,
    IntegrationOutbox,
)
from app.repositories.outbox import OutboxRepository
from app.repositories.attachments import AttachmentRepository
from app.repositories.drafts import DraftRepository
from app.repositories.edits import EditRepository
from app.repositories.index_jobs import IndexJobRepository
from app.repositories.memories import MemoryRepository
from app.repositories.notes import NoteRepository
from app.repositories.runs import RunRepository
from app.services.markdown_index import create_index_job, run_index_job
from app.services.note_library import understand_note_query
from app.memory.service import MemoryService
from app.services.run_service import RunService
from app.agent.write_runtime import (
    authorize_draft_save,
    initialize_draft_graph,
    initialize_edit_graph,
    resume_draft_generation,
    resume_edit_graph,
)
from app.rag.pipeline.indexer import create_rag_index_job, run_rag_index_job
from app.rag.pipeline.retrieval import retrieve_candidates, vector_retrieve


RUN_DB_TESTS = os.environ.get("NOTEFLOW_RUN_DB_TESTS") == "1"
LANGGRAPH_DURABLE_INTERRUPT = tuple(
    int(part) for part in importlib.metadata.version("langgraph").split(".")[:2]
) >= (1, 0)


async def _database_snapshot() -> dict:
    connection = await asyncpg.connect(
        host=cfg.DB_HOST,
        port=int(cfg.DB_PORT),
        user=cfg.DB_USER,
        password=cfg.DB_PASSWORD,
        database=cfg.DB_NAME,
    )
    try:
        tables = await connection.fetch(
            """
            select table_name from information_schema.tables
            where table_schema = 'public' and table_type = 'BASE TABLE'
            """
        )
        extensions = await connection.fetch("select extname, extversion from pg_extension")
        migration = await connection.fetchval("select version_num from alembic_version")
        vector_index_count = await connection.fetchval(
            "select count(*) from pg_indexes where schemaname = 'public' and indexdef ilike '%hnsw%'"
        )
        return {
            "tables": {row["table_name"] for row in tables},
            "extensions": {row["extname"]: row["extversion"] for row in extensions},
            "migration": migration,
            "vectorIndexCount": vector_index_count,
        }
    finally:
        await connection.close()


async def _exercise_postgres_write_graph_resume() -> dict:
    suffix = uuid.uuid4().hex
    draft_thread = f"db-draft-graph-{suffix}"
    edit_thread = f"db-edit-graph-{suffix}"
    draft_initialized = await initialize_draft_graph(
        user_id="graph-test-user", thread_id=draft_thread,
        draft_id=f"draft-{suffix}", topic="测试草稿", outline="## 大纲",
    )
    draft_resumed = await resume_draft_generation(thread_id=draft_thread)
    draft_saved = await authorize_draft_save(
        thread_id=draft_thread, assembled_content="## 大纲\n正文",
    )
    edit_initialized = await initialize_edit_graph(
        user_id="graph-test-user", thread_id=edit_thread,
        note_id=f"note-{suffix}", instruction="修改正文",
        preview_id=f"preview-{suffix}", target_type="note",
        section_id="", selected_text="", source_content_hash="abc",
    )
    edit_revised = await resume_edit_graph(
        thread_id=edit_thread, action="revise", payload={"instruction": "再短一点"},
    )
    edit_applied = await resume_edit_graph(thread_id=edit_thread, action="apply")
    return {
        "draft": draft_initialized and draft_resumed and draft_saved,
        "edit": edit_initialized and edit_revised and edit_applied,
    }


async def _exercise_reused_child_with_new_parent() -> tuple[str, str]:
    suffix = uuid.uuid4().hex
    user = User(
        id=f"db-regression-user-{suffix}",
        email=f"db-regression-{suffix}@local.test",
        display_name="Database Regression",
        password_hash="not-used",
    )
    note = Note(
        id=f"db-regression-note-{suffix}",
        user_id=user.id,
        title="Nested section regression",
        content="# Original root\n\nroot v1\n\n## Stable child\n\nchild body",
        tags=["regression"],
    )
    embedding_stats = SimpleNamespace(indexed=0, reused=0, skipped=2, failed=0)

    try:
        async with AsyncSessionLocal() as session:
            session.add_all([user, note])
            await session.flush()
            with patch(
                "app.services.markdown_index.index_note_chunk_embeddings",
                new=AsyncMock(return_value=embedding_stats),
            ):
                first_job = await create_index_job(session, note)
                await run_index_job(session, note, first_job)
                first_status = first_job.status

                # The child is reusable, but its parent is new. This is the exact
                # shape that previously violated note_sections.parent_id_fkey.
                note.content = "# Replacement root\n\nroot v2\n\n## Stable child\n\nchild body"
                second_job = await create_index_job(session, note)
                await run_index_job(session, note, second_job)
                second_status = second_job.status
            await session.commit()
        return first_status, second_status
    finally:
        async with AsyncSessionLocal() as session:
            await session.execute(delete(User).where(User.id == user.id))
            await session.commit()
        await engine.dispose()


async def _exercise_repository_user_isolation() -> dict[str, bool]:
    suffix = uuid.uuid4().hex
    owner = User(
        id=f"repo-owner-{suffix}",
        email=f"repo-owner-{suffix}@local.test",
        display_name="Repository Owner",
        password_hash="not-used",
    )
    other = User(
        id=f"repo-other-{suffix}",
        email=f"repo-other-{suffix}@local.test",
        display_name="Repository Other",
        password_hash="not-used",
    )
    note = Note(
        id=f"repo-note-{suffix}",
        user_id=owner.id,
        title="Private note",
        content="private",
        tags=[],
    )
    memory = UserMemory(
        id=f"repo-memory-{suffix}",
        user_id=owner.id,
        memory_type="preference",
        content="private memory",
        importance=3,
        source="test",
        scope="global",
        tags=[],
        status="active",
    )
    job = NoteIndexJob(
        id=f"repo-job-{suffix}",
        note_id=note.id,
        user_id=owner.id,
        status="pending",
        retry_count=0,
        max_retries=3,
    )
    draft = NoteDraft(
        id=f"repo-draft-{suffix}",
        user_id=owner.id,
        title="Private draft",
        topic="private",
    )
    edit = NoteEditPreview(
        id=f"repo-edit-{suffix}",
        user_id=owner.id,
        note_id=note.id,
        old_content="private",
        new_content="private updated",
        instruction="private edit",
    )
    attachment = NoteAttachment(
        id=f"repo-attachment-{suffix}",
        user_id=owner.id,
        note_id=note.id,
        file_name="private.txt",
        content_type="text/plain",
        size=7,
        sha256="0" * 64,
        storage_key=f"repo-test/{suffix}.txt",
    )
    chat_session = ChatSession(
        id=f"repo-session-{suffix}",
        user_id=owner.id,
        title="Private session",
    )
    run = AgentRun(
        id=f"repo-run-{suffix}",
        session_id=chat_session.id,
        user_id=owner.id,
        intent="general_chat",
        status="running",
        input_text="private run",
    )
    try:
        async with AsyncSessionLocal() as session:
            # NoteIndexJob only carries scalar foreign keys (there is no ORM
            # relationship for SQLAlchemy to infer insert order from), so make
            # the ownership rows durable in the transaction before dependents.
            session.add_all([owner, other])
            await session.flush()
            session.add(note)
            await session.flush()
            session.add_all([memory, draft, chat_session])
            await session.flush()
            session.add_all([job, edit, attachment, run])
            await session.commit()
            note_repo = NoteRepository(session)
            memory_repo = MemoryRepository(session)
            job_repo = IndexJobRepository(session)
            result = {
                "owner_note": await note_repo.get_active(owner.id, note.id) is not None,
                "other_note": await note_repo.get_active(other.id, note.id) is None,
                "owner_memory": await memory_repo.get(owner.id, memory.id) is not None,
                "other_memory": await memory_repo.get(other.id, memory.id) is None,
                "owner_job": await job_repo.get(owner.id, job.id) is not None,
                "other_job": await job_repo.get(other.id, job.id) is None,
                "other_draft": await DraftRepository(session).get(other.id, draft.id) is None,
                "other_edit": await EditRepository(session).get(other.id, edit.id) is None,
                "other_attachment": await AttachmentRepository(session).get(other.id, attachment.id) is None,
                "other_run": await RunRepository(session).get_run(other.id, run.id) is None,
            }

        cross_user_update_rejected = False
        try:
            await MemoryService().update(
                other.id,
                memory.id,
                SimpleNamespace(
                    memoryType=None,
                    content="cross-user overwrite",
                    importance=None,
                    confidence=None,
                    source=None,
                    scope=None,
                    tags=None,
                    status=None,
                    reason="cross-user test",
                ),
            )
        except LookupError:
            cross_user_update_rejected = True
        result["other_memory_update"] = cross_user_update_rejected
        result["other_run_cancel"] = not await RunService().cancel(other.id, run.id, "cross-user test")

        async with AsyncSessionLocal() as session:
            owner_memory = await MemoryRepository(session).get(owner.id, memory.id)
            owner_run = await RunRepository(session).get_run(owner.id, run.id)
            result["memory_unchanged"] = owner_memory is not None and owner_memory.content == "private memory"
            result["run_unchanged"] = owner_run is not None and owner_run.status == "running"
        return result
    finally:
        async with AsyncSessionLocal() as session:
            await session.execute(delete(User).where(User.id.in_([owner.id, other.id])))
            await session.commit()
        await engine.dispose()


async def _exercise_outbox_idempotency_and_recovery() -> dict[str, bool]:
    suffix = uuid.uuid4().hex
    key = f"db-outbox-{suffix}"
    worker = f"worker-{suffix}"
    try:
        async with AsyncSessionLocal() as session:
            async with session.begin():
                repository = OutboxRepository(session)
                first = await repository.enqueue(
                    topic="test.event", aggregate_type="test", aggregate_id=suffix,
                    idempotency_key=key, payload={"value": 1},
                )
                second = await repository.enqueue(
                    topic="test.event", aggregate_type="test", aggregate_id=suffix,
                    idempotency_key=key, payload={"value": 2},
                )
                same_row = first.id == second.id
            async with session.begin():
                claimed = await OutboxRepository(session).claim_one(worker_id=worker, stale_seconds=1)
                claim_ok = claimed is not None and claimed.id == first.id and claimed.attempts == 1
                if claimed:
                    claimed.heartbeat_at = datetime.utcnow() - timedelta(seconds=10)
            async with session.begin():
                recovered = await OutboxRepository(session).claim_one(worker_id=worker + "-recovery", stale_seconds=1)
                recovery_ok = recovered is not None and recovered.id == first.id and recovered.attempts == 2
            return {"same_row": same_row, "claim_ok": claim_ok, "recovery_ok": recovery_ok}
    finally:
        async with AsyncSessionLocal() as session:
            await session.execute(delete(IntegrationOutbox).where(IntegrationOutbox.idempotency_key == key))
            await session.commit()
        await engine.dispose()


async def _exercise_rag_incremental_and_permissions() -> dict[str, bool]:
    suffix = uuid.uuid4().hex
    owner = User(
        id=f"rag-v2-owner-{suffix}", email=f"rag-v2-owner-{suffix}@local.test",
        display_name="RAG v2 Owner", password_hash="not-used",
    )
    other = User(
        id=f"rag-v2-other-{suffix}", email=f"rag-v2-other-{suffix}@local.test",
        display_name="RAG v2 Other", password_hash="not-used",
    )
    note = Note(
        id=f"rag-v2-note-{suffix}", user_id=owner.id, title="RAG v2 Architecture",
        content="# Stable\n\nBM25 and vector use RRF.\n\n# Changed\n\nold parser detail", tags=["RAG"],
    )
    private = Note(
        id=f"rag-v2-private-{suffix}", user_id=other.id, title="Private Neptune",
        content="# Secret\n\nBETA_ONLY_NEPTUNE_7429", tags=["private"],
    )
    original_embedding_key = cfg.EMBEDDING_API_KEY
    original_vector_enabled = cfg.RAG_VECTOR_ENABLED
    try:
        cfg.EMBEDDING_API_KEY = ""
        cfg.RAG_VECTOR_ENABLED = False
        async with AsyncSessionLocal() as session:
            session.add_all([owner, other])
            await session.flush()
            session.add_all([note, private])
            await session.flush()
            first_job = await create_rag_index_job(session, note)
            private_job = await create_rag_index_job(session, private)
            await run_rag_index_job(session, note, first_job)
            await run_rag_index_job(session, private, private_job)
            await session.commit()
            first_nodes = (
                await session.execute(
                    select(RagNode).where(RagNode.note_id == note.id, RagNode.active.is_(True))
                )
            ).scalars().all()
            stable_first = next(node.id for node in first_nodes if node.section_path == ["Stable"])
            changed_first = next(node.id for node in first_nodes if node.section_path == ["Changed"])

            note.content = "# Stable\n\nBM25 and vector use RRF.\n\n# Changed\n\nnew parser detail"
            second_job = await create_rag_index_job(session, note)
            await run_rag_index_job(session, note, second_job)
            await session.commit()
            second_nodes = (
                await session.execute(
                    select(RagNode).where(RagNode.note_id == note.id, RagNode.active.is_(True))
                )
            ).scalars().all()
            stable_second = next(node.id for node in second_nodes if node.section_path == ["Stable"])
            changed_second = next(node.id for node in second_nodes if node.section_path == ["Changed"])
            old_changed = await session.get(RagNode, changed_first)
            state_before_stale = await session.get(RagIndexState, note.id)
            indexed_source = state_before_stale.source_version

            owner_embedding = await session.scalar(
                select(RagEmbedding).where(RagEmbedding.node_id == stable_second)
            )
            private_node = await session.scalar(
                select(RagNode).where(RagNode.note_id == private.id, RagNode.active.is_(True))
            )
            private_embedding = await session.scalar(
                select(RagEmbedding).where(RagEmbedding.node_id == private_node.id)
            )
            owner_embedding.status = "indexed"
            owner_embedding.embedding = [0.01] * cfg.EMBEDDING_DIMENSIONS
            private_embedding.status = "indexed"
            private_embedding.embedding = [0.01] * cfg.EMBEDDING_DIMENSIONS

            stale_job = await create_rag_index_job(session, note, force=True)
            note.content += "\n\nconcurrent update"
            await run_rag_index_job(session, note, stale_job)
            await session.commit()
            state_after_stale = await session.get(RagIndexState, note.id)

        owner_results = await retrieve_candidates(owner.id, "BM25 RRF", limit=8)
        probe_results = await retrieve_candidates(owner.id, "BETA_ONLY_NEPTUNE_7429", limit=8)
        query_plan = understand_note_query("RAG")
        fake_embedding_result = SimpleNamespace(
            embeddings=[[0.01] * cfg.EMBEDDING_DIMENSIONS],
            provider=cfg.EMBEDDING_PROVIDER,
            model=cfg.EMBEDDING_MODEL,
            dimensions=cfg.EMBEDDING_DIMENSIONS,
        )
        with patch("app.rag.pipeline.retrieval.embedding_enabled", return_value=True), patch(
            "app.rag.pipeline.retrieval.embed_texts", new=AsyncMock(return_value=fake_embedding_result)
        ):
            vector_results = await vector_retrieve(owner.id, query_plan, limit=8)
        return {
            "jobs_succeeded": first_job.status == private_job.status == second_job.status == "success",
            "unchanged_reused": stable_first == stable_second,
            "changed_rebuilt": changed_first != changed_second and old_changed is not None and not old_changed.active,
            "owner_found": any(candidate.note_id == note.id for candidate in owner_results.candidates),
            "cross_user_filtered": all(candidate.note_id != private.id for candidate in probe_results.candidates),
            "vector_permission_filtered": bool(vector_results) and all(candidate.note_id != private.id for candidate in vector_results),
            "stale_cancelled": stale_job.status == "cancelled" and stale_job.error_code == "STALE_SOURCE_VERSION",
            "stale_did_not_move_pointer": state_after_stale.source_version == indexed_source,
        }
    finally:
        cfg.EMBEDDING_API_KEY = original_embedding_key
        cfg.RAG_VECTOR_ENABLED = original_vector_enabled
        async with AsyncSessionLocal() as session:
            await session.execute(delete(User).where(User.id.in_([owner.id, other.id])))
            await session.commit()
        await engine.dispose()


@unittest.skipUnless(RUN_DB_TESTS, "set NOTEFLOW_RUN_DB_TESTS=1 to run real PostgreSQL integration checks")
class DatabaseIntegrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.snapshot = asyncio.run(_database_snapshot())

    def test_runtime_tables_match_sqlalchemy_metadata(self) -> None:
        library_owned = {
            "checkpoint_migrations",
            "checkpoints",
            "checkpoint_blobs",
            "checkpoint_writes",
            "mem0migrations",
            cfg.MEM0_COLLECTION_NAME,
        }
        self.assertEqual(self.snapshot["tables"] - {"alembic_version"} - library_owned, set(Base.metadata.tables))

    def test_pgvector_and_hnsw_are_available(self) -> None:
        self.assertIn("vector", self.snapshot["extensions"])
        self.assertGreaterEqual(self.snapshot["vectorIndexCount"], 1)

    def test_database_is_at_current_alembic_revision(self) -> None:
        self.assertEqual(self.snapshot["migration"], "20260717_0009")

    @unittest.skipUnless(LANGGRAPH_DURABLE_INTERRUPT, "requires pinned langgraph >= 1.0")
    def test_postgres_write_graphs_interrupt_and_resume(self) -> None:
        result = asyncio.run(_exercise_postgres_write_graph_resume())
        self.assertTrue(result["draft"])
        self.assertTrue(result["edit"])

    def test_outbox_is_idempotent_and_recovers_stale_claims(self) -> None:
        result = asyncio.run(_exercise_outbox_idempotency_and_recovery())
        self.assertTrue(result["same_row"])
        self.assertTrue(result["claim_ok"])
        self.assertTrue(result["recovery_ok"])

    def test_reindex_allows_reused_child_under_new_parent(self) -> None:
        first_status, second_status = asyncio.run(_exercise_reused_child_with_new_parent())
        self.assertEqual(first_status, "success")
        self.assertEqual(second_status, "success")

    def test_rag_incremental_index_fencing_and_permissions(self) -> None:
        result = asyncio.run(_exercise_rag_incremental_and_permissions())
        self.assertTrue(result["jobs_succeeded"])
        self.assertTrue(result["unchanged_reused"])
        self.assertTrue(result["changed_rebuilt"])
        self.assertTrue(result["owner_found"])
        self.assertTrue(result["cross_user_filtered"])
        self.assertTrue(result["vector_permission_filtered"])
        self.assertTrue(result["stale_cancelled"])
        self.assertTrue(result["stale_did_not_move_pointer"])

    def test_owned_repositories_and_services_reject_cross_user_access(self) -> None:
        result = asyncio.run(_exercise_repository_user_isolation())
        self.assertTrue(result["owner_note"])
        self.assertTrue(result["owner_memory"])
        self.assertTrue(result["owner_job"])
        self.assertTrue(result["other_note"])
        self.assertTrue(result["other_memory"])
        self.assertTrue(result["other_job"])
        self.assertTrue(result["other_draft"])
        self.assertTrue(result["other_edit"])
        self.assertTrue(result["other_attachment"])
        self.assertTrue(result["other_run"])
        self.assertTrue(result["other_memory_update"])
        self.assertTrue(result["other_run_cancel"])
        self.assertTrue(result["memory_unchanged"])
        self.assertTrue(result["run_unchanged"])


if __name__ == "__main__":
    unittest.main()
