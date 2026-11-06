"""Opt-in PostgreSQL regression tests. Use a disposable local database."""
from __future__ import annotations

import asyncio
import os
import unittest
from contextlib import asynccontextmanager
from datetime import timedelta
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import delete, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.deps import CurrentUser
from app.models.db import Base, Note, NoteCategory, NoteEditPreview, NoteIndexJob, NoteSection, NoteVersion, User
from app.routers import edits, notes

DATABASE_URL = os.getenv("NOTEFLOW_NOTE_CONCURRENCY_DB_URL")
BASE_CONTENT = "原始正文"


@unittest.skipUnless(DATABASE_URL, "requires a disposable PostgreSQL database")
class NoteWriteConcurrencyTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        url = make_url(DATABASE_URL)
        self.assertEqual(url.drivername, "postgresql+asyncpg")
        self.assertIn(url.host, {"localhost", "127.0.0.1", "::1"})
        self.assertEqual(url.database, "noteflow_note_concurrency_test")
        run_id = uuid4().hex
        self.app_name = f"note-concurrency-{run_id}"
        self.engine = create_async_engine(url, connect_args={"server_settings": {
            "application_name": self.app_name,
            "lock_timeout": "5000",
        }})
        self.addAsyncCleanup(self.engine.dispose)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        self.user = CurrentUser(id=run_id, email=f"{run_id}@local.test", display_name="测试")
        self.note_id = f"note-{run_id}"
        async with self.engine.begin() as connection:
            tables = [User, NoteCategory, Note, NoteVersion, NoteSection, NoteEditPreview, NoteIndexJob]
            await connection.run_sync(Base.metadata.create_all, tables=[model.__table__ for model in tables])
        async with self.sessions.begin() as session:
            session.add(User(id=self.user.id, email=self.user.email, display_name=self.user.display_name))
            await session.flush()
            session.add(Note(id=self.note_id, user_id=self.user.id, title="测试", content=BASE_CONTENT))
        self.addAsyncCleanup(self.remove_fixture)
        for router in (notes, edits):
            patcher = patch.object(router, "AsyncSessionLocal", self.sessions)
            patcher.start()
            self.addCleanup(patcher.stop)

    async def remove_fixture(self):
        async with self.sessions.begin() as session:
            await session.execute(delete(User).where(User.id == self.user.id))

    async def save(self, content):
        payload = notes.NoteUpdatePayload(content=content, expectedContentHash=notes._content_hash(BASE_CONTENT))
        return await notes.update_note(self.note_id, payload, self.user)

    async def assert_waiting_on_database(self, task):
        # Confirm PostgreSQL saw the request wait on a lock before releasing the first writer.
        for _ in range(100):
            self.assertFalse(task.done(), "second request returned before the first transaction committed")
            async with self.sessions() as session:
                blocked = await session.scalar(text("""
                    SELECT EXISTS (
                        SELECT 1 FROM pg_stat_activity
                        WHERE application_name = :name AND wait_event_type = 'Lock'
                    )
                """), {"name": self.app_name})
            if blocked:
                return
            await asyncio.sleep(0.02)
        self.fail("second request did not wait on PostgreSQL")

    @asynccontextmanager
    async def pause_first_index_request(self, router):
        entered = asyncio.Event()
        release = asyncio.Event()
        index = router.index_note_now

        async def pause_once(session, note):
            if not entered.is_set():
                entered.set()
                await release.wait()
            return await index(session, note)

        with patch.object(router, "index_note_now", pause_once):
            try:
                yield entered, release
            finally:
                release.set()

    async def assert_conflict_after(self, router, first, winner):
        tasks = []
        async with self.pause_first_index_request(router) as (entered, release):
            try:
                tasks.append(asyncio.create_task(first()))
                await asyncio.wait_for(entered.wait(), 3)
                tasks.append(asyncio.create_task(self.save("设备二的正文")))
                await self.assert_waiting_on_database(tasks[1])
            finally:
                release.set()
                results = await asyncio.gather(*tasks, return_exceptions=True)

        saved, conflict = results
        if isinstance(saved, BaseException):
            raise saved
        self.assertEqual(saved["note"]["content"], winner)
        self.assertIsInstance(conflict, HTTPException)
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.detail["code"], "NOTE_VERSION_CONFLICT")
        self.assertEqual(conflict.detail["currentContentHash"], notes._content_hash(winner))
        async with self.sessions() as session:
            note = await session.get(Note, self.note_id)
            self.assertEqual(note.content, winner)
            versions = (await session.scalars(select(NoteVersion).where(NoteVersion.note_id == self.note_id))).all()
            self.assertEqual([v.content for v in versions].count(BASE_CONTENT), 1)
            jobs = (await session.scalars(select(NoteIndexJob).where(NoteIndexJob.note_id == self.note_id))).all()
            self.assertEqual(len(jobs), 2)
            self.assertEqual({job.source_version for job in jobs}, {notes._content_hash(winner)})

    async def test_two_devices_cannot_both_save_the_same_base(self):
        await self.assert_conflict_after(notes, lambda: self.save("设备一的正文"), "设备一的正文")

    async def test_manual_save_conflicts_with_version_restore(self):
        version_id = f"version-{self.user.id}"
        async with self.sessions.begin() as session:
            session.add(NoteVersion(id=version_id, note_id=self.note_id, user_id=self.user.id, title="测试", content="历史正文"))
        await self.assert_conflict_after(
            notes, lambda: notes.restore_note_version(self.note_id, version_id, self.user), "历史正文",
        )

    async def test_manual_save_conflicts_with_ai_preview_apply(self):
        preview_id = f"preview-{self.user.id}"
        async with self.sessions.begin() as session:
            session.add(NoteEditPreview(
                id=preview_id, note_id=self.note_id, user_id=self.user.id,
                old_content=BASE_CONTENT, new_content="AI 改写",
                source_content_hash=notes._content_hash(BASE_CONTENT),
            ))
        # The AI response is already stored. Stub only the runtime confirmation.
        with patch.object(edits, "_ensure_edit_graph", AsyncMock()), patch.object(
            edits, "resume_edit_graph", AsyncMock(return_value=True)
        ):
            await self.assert_conflict_after(edits, lambda: edits.apply_preview(preview_id, self.user), "AI 改写")

    async def test_save_waiting_on_delete_does_not_write_deleted_note(self):
        async with self.sessions() as deleting:
            note = await deleting.get(Note, self.note_id)
            note.deleted_at = notes._now()
            await deleting.flush()
            saving = asyncio.create_task(self.save("删除期间的正文"))
            try:
                await self.assert_waiting_on_database(saving)
            finally:
                await deleting.commit()
                result, = await asyncio.gather(saving, return_exceptions=True)
        self.assertIsInstance(result, HTTPException)
        self.assertEqual((result.status_code, result.detail), (409, "note is deleted"))
        async with self.sessions() as session:
            note = await session.get(Note, self.note_id)
            self.assertEqual(note.content, BASE_CONTENT)
            self.assertIsNotNone(note.deleted_at)

    async def test_save_skips_index_job_held_by_worker(self):
        legacy_id = f"legacy-{self.user.id}"
        rag_id = f"rag-{self.user.id}"
        wanted_hash = notes._content_hash("设备一的正文")
        old_hash = notes._content_hash(BASE_CONTENT)
        retry_at = notes._now() + timedelta(minutes=1)
        async with self.sessions.begin() as session:
            session.add_all([
                NoteIndexJob(id=legacy_id, note_id=self.note_id, user_id=self.user.id, source_version=old_hash),
                NoteIndexJob(id=rag_id, note_id=self.note_id, user_id=self.user.id, graph_version="rag-v2",
                             source_version=wanted_hash, next_attempt_at=retry_at),
            ])
        async with self.sessions.begin() as worker:
            for job_id in (legacy_id, rag_id):
                await worker.get(NoteIndexJob, job_id, with_for_update=True)
            saved = await asyncio.wait_for(self.save("设备一的正文"), 3)
        self.assertEqual(saved["note"]["content"], "设备一的正文")
        async with self.sessions() as session:
            self.assertEqual((await session.get(NoteIndexJob, legacy_id)).source_version, old_hash)
            self.assertEqual((await session.get(NoteIndexJob, rag_id)).next_attempt_at, retry_at)
            jobs = (await session.scalars(select(NoteIndexJob).where(NoteIndexJob.note_id == self.note_id))).all()
            self.assertEqual(len(jobs), 3)
            fresh_job, = [job for job in jobs if job.id not in (legacy_id, rag_id)]
            self.assertEqual(fresh_job.source_version, wanted_hash)

    async def test_save_does_not_reuse_pending_rag_job_as_legacy_job(self):
        rag_id = f"rag-{self.user.id}"
        old_hash = notes._content_hash(BASE_CONTENT)
        async with self.sessions.begin() as session:
            session.add(NoteIndexJob(
                id=rag_id, note_id=self.note_id, user_id=self.user.id, graph_version="rag-v2",
                source_version=old_hash,
            ))

        await self.save("设备一的正文")

        async with self.sessions() as session:
            self.assertEqual((await session.get(NoteIndexJob, rag_id)).source_version, old_hash)
            jobs = (await session.scalars(
                select(NoteIndexJob).where(NoteIndexJob.note_id == self.note_id, NoteIndexJob.id != rag_id)
            )).all()
            self.assertEqual({job.graph_version for job in jobs}, {None, "rag-v2"})
            self.assertEqual({job.source_version for job in jobs}, {notes._content_hash("设备一的正文")})
