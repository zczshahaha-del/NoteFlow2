"""Edit preview writes against isolated SQL/ASGI; never use app data or models."""
from __future__ import annotations

import asyncio
import hashlib
import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.deps import CurrentUser, get_current_user
from app.models.db import (
    Note,
    NoteCategory,
    NoteEditPreview,
    NoteEditPreviewRevision,
    NoteIndexJob,
    NoteSection,
    NoteVersion,
    User,
)
from app.routers import edits


class EditPreviewContentTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
        async with self.engine.begin() as connection:
            for model in (User, NoteCategory, Note, NoteSection, NoteEditPreview,
                          NoteEditPreviewRevision, NoteVersion, NoteIndexJob):
                await connection.run_sync(model.__table__.create)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        self.user = CurrentUser(id="preview-owner", email="preview@example.invalid", display_name="合成用户")
        self.original = "## 原小节\n\n原文不应提前改变。"
        self.initial = "## 修改稿\n\n初始 AI 结果。"
        self.initial_updated_at = datetime(2020, 1, 2, 1, 2, 3, 456789)
        self.initial_token = self.initial_updated_at.isoformat()
        self.source_hash = hashlib.sha256(self.original.encode()).hexdigest()
        async with self.sessions() as session:
            session.add_all([
                User(id=self.user.id, email=self.user.email, display_name=self.user.display_name),
                Note(id="preview-note", user_id=self.user.id, title="合成笔记", content=self.original,
                     updated_at=self.initial_updated_at, index_status="ready"),
                NoteEditPreview(id="preview", note_id="preview-note", user_id=self.user.id,
                                old_content=self.original, new_content=self.initial, instruction="扩写内容",
                                change_summary=["初始说明"], source_content_hash=self.source_hash,
                                graph_thread_id="synthetic-edit-graph", updated_at=self.initial_updated_at),
                NoteEditPreviewRevision(id="generated", edit_id="preview", user_id=self.user.id,
                                        new_content=self.initial, instruction="扩写内容", source="generated",
                                        change_summary=["初始说明"], created_at=self.initial_updated_at),
            ])
            await session.commit()

        self.model = AsyncMock(return_value=SimpleNamespace(new_content="AI 再次调整", change_summary=["AI 说明"]))
        self.graph = AsyncMock(return_value=True)
        self.initialize_graph = AsyncMock(return_value=True)
        self.patches = [
            patch.object(edits, "AsyncSessionLocal", self.sessions),
            patch.object(edits, "revise_edit_preview", self.model),
            patch.object(edits, "resume_edit_graph", self.graph),
            patch.object(edits, "initialize_edit_graph", self.initialize_graph),
        ]
        for item in self.patches:
            item.start()
        self.app = FastAPI()
        self.app.include_router(edits.router, prefix="/api")
        self.app.dependency_overrides[get_current_user] = lambda: self.user
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://preview-test.invalid")

    async def asyncTearDown(self):
        await self.client.aclose()
        for item in reversed(self.patches):
            item.stop()
        await self.engine.dispose()

    async def save(self, text, token=None, edit_id="preview"):
        return await self.client.patch(f"/api/note-edit-previews/{edit_id}/content", json={
            "newContent": text, "expectedUpdatedAt": self.initial_token if token is None else token,
        })

    async def revisions(self):
        response = await self.client.get("/api/note-edit-previews/preview/revisions")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["revisions"]

    async def assert_original_untouched(self):
        async with self.sessions() as session:
            note = await session.get(Note, "preview-note")
            self.assertEqual(note.content, self.original)
            self.assertEqual(note.updated_at, self.initial_updated_at)
            self.assertEqual(note.index_status, "ready")
            self.assertEqual(await session.scalar(select(func.count()).select_from(NoteVersion)), 0)
            self.assertEqual(await session.scalar(select(func.count()).select_from(NoteIndexJob)), 0)

    async def test_create_selection_ignores_passive_section_and_applies_only_selected_text(self):
        model = AsyncMock(return_value=SimpleNamespace(new_content="只替换这一句。", change_summary=["改写选区"]))
        with patch.object(edits, "generate_edit_preview", model):
            response = await self.client.post("/api/note-edit-previews", json={
                "noteId": "preview-note", "selectedText": "原文不应提前改变。",
                "contextSectionId": "passive-reading-position", "instruction": "讲得通俗一点", "memoryEnabled": False,
            })
        self.assertEqual(response.status_code, 200, response.text)
        preview = response.json()["preview"]
        self.assertEqual(preview["targetType"], "selection")
        self.assertEqual(preview["oldContent"], "原文不应提前改变。")
        self.assertIn("## 原小节", model.call_args.kwargs["neighbor_context"])
        await self.assert_original_untouched()
        async def synthetic_index(session, note):
            job = NoteIndexJob(id="scope-index", note_id=note.id, user_id=self.user.id, status="pending")
            session.add(job)
            await session.flush()
            return job
        with patch.object(edits, "index_note_now", synthetic_index):
            applied = await self.client.post(f"/api/note-edit-previews/{preview['id']}/apply")
        self.assertEqual(applied.status_code, 200, applied.text)
        self.assertEqual(applied.json()["note"]["content"], "## 原小节\n\n只替换这一句。")

    async def test_quick_rewrite_generates_without_writing_or_creating_preview(self):
        model = AsyncMock(return_value=SimpleNamespace(new_content="更清楚的表达。"))
        with patch.object(edits, "generate_edit_preview", model):
            response = await self.client.post("/api/note-selection-rewrite", json={
                "noteId": "preview-note", "selectedMarkdown": "还未自动保存的选中文字。", "memoryEnabled": False,
            })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["newContent"], "更清楚的表达。")
        self.assertEqual(model.call_args.kwargs["target_type"], "selection")
        self.assertIn("不添加事实", model.call_args.kwargs["instruction"])
        await self.assert_original_untouched()
        async with self.sessions() as session:
            self.assertEqual(await session.scalar(select(func.count()).select_from(NoteEditPreview)), 1)

    async def test_quick_rewrite_continues_current_draft(self):
        response = await self.client.post("/api/note-selection-rewrite", json={
            "noteId": "preview-note", "selectedMarkdown": "最初选区", "currentDraft": "已认可的结果",
            "instruction": "再通俗一点", "memoryEnabled": False,
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.model.call_args.kwargs["current_preview"], "已认可的结果")
        self.assertEqual(self.model.call_args.kwargs["original_content"], "最初选区")
        await self.assert_original_untouched()

    async def test_quick_rewrite_checks_note_ownership_and_size(self):
        async with self.sessions() as session:
            note = await session.get(Note, "preview-note")
            note.user_id = "another-owner"
            await session.commit()
        with patch.object(edits, "generate_edit_preview", AsyncMock()) as model:
            response = await self.client.post("/api/note-selection-rewrite", json={
                "noteId": "preview-note", "selectedMarkdown": "原文", "memoryEnabled": False,
            })
            self.assertEqual(response.status_code, 404)
            oversized = await self.client.post("/api/note-selection-rewrite", json={
                "noteId": "preview-note", "selectedMarkdown": "x" * 16001, "memoryEnabled": False,
            })
            self.assertEqual(oversized.status_code, 422)
            model.assert_not_awaited()

    async def test_quick_rewrite_failure_preserves_note(self):
        from app.services.note_edit import EditGenerationError
        with patch.object(edits, "generate_edit_preview", AsyncMock(side_effect=EditGenerationError("合成生成失败"))):
            response = await self.client.post("/api/note-selection-rewrite", json={
                "noteId": "preview-note", "selectedMarkdown": "选区", "memoryEnabled": False,
            })
        self.assertEqual(response.status_code, 502)
        await self.assert_original_untouched()

    async def test_ambiguous_target_asks_before_model_or_preview_creation(self):
        model = AsyncMock()
        with patch.object(edits, "generate_edit_preview", model):
            response = await self.client.post("/api/note-edit-previews", json={
                "noteId": "preview-note", "contextSectionId": "passive", "instruction": "这里改一下", "memoryEnabled": False,
            })
        self.assertEqual(response.status_code, 400, response.text)
        self.assertIn("哪一部分", response.json()["detail"])
        model.assert_not_awaited()
        await self.assert_original_untouched()

    async def test_selection_generation_repairs_protocol_before_creating_preview(self):
        with patch("app.services.note_edit._call_ai", new=AsyncMock(side_effect=[
            '{"edits":[{"oldText":"## 原小节","newText":"错误的范围"}]}',
            '{"newContent":"这句话已改写。","changeSummary":["改写选中文字"]}',
        ])) as model:
            response = await self.client.post("/api/note-edit-previews", json={
                "noteId": "preview-note", "selectedText": "原文不应提前改变。",
                "contextSectionId": "passive-reading-position",
                "instruction": "改一下这句话呗能改吗", "memoryEnabled": False,
            })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(model.await_count, 2)
        self.assertEqual(response.json()["preview"]["newContent"], "这句话已改写。")
        self.assertEqual(response.json()["preview"]["oldContent"], "原文不应提前改变。")
        self.assertEqual(response.json()["preview"]["targetType"], "selection")
        await self.assert_original_untouched()

    async def test_repeated_bad_model_output_creates_no_preview_and_blames_no_selection(self):
        with patch("app.services.note_edit._call_ai", new=AsyncMock(return_value='{"edits":[{"oldText":"错","newText":"错"}]}')) as model:
            response = await self.client.post("/api/note-edit-previews", json={
                "noteId": "preview-note", "selectedText": "原文不应提前改变。",
                "instruction": "改一下这句话", "memoryEnabled": False,
            })
        self.assertEqual(response.status_code, 502)
        self.assertEqual(model.await_count, 2)
        self.assertNotIn("缩小选区", response.json()["detail"])
        async with self.sessions() as session:
            self.assertEqual(await session.scalar(select(func.count()).select_from(NoteEditPreview)), 1)
        await self.assert_original_untouched()

    async def test_revise_new_scope_is_explicitly_rejected_without_changing_current_draft(self):
        async with self.sessions() as session:
            preview = await session.get(NoteEditPreview, "preview")
            preview.target_type = "selection"
            await session.commit()
        for instruction in ("下一章也改了", "整篇笔记重写一遍", "把这一节都改了"):
            response = await self.client.post("/api/note-edit-previews/preview/revise", json={
                "instruction": instruction, "memoryEnabled": False,
            })
            self.assertEqual(response.status_code, 409, response.text)
            self.assertIn("当前修改稿已保留", response.json()["detail"])
        self.model.assert_not_awaited()
        current = await self.client.get("/api/note-edit-previews/preview")
        self.assertEqual(current.json()["preview"]["newContent"], self.initial)

    async def test_delete_preview_cannot_accept_ignored_rewrite_content(self):
        async with self.sessions() as session:
            preview = await session.get(NoteEditPreview, "preview")
            preview.target_type = "delete"
            preview.new_content = ""
            await session.commit()
        response = await self.client.post("/api/note-edit-previews/preview/revise", json={
            "instruction": "改成通俗的解释", "memoryEnabled": False,
        })
        self.assertEqual(response.status_code, 409)
        self.model.assert_not_awaited()
        await self.assert_original_untouched()

    async def test_manual_write_is_versioned_preserves_markdown_and_does_not_write_note(self):
        text = "## 手动标题\n\n**加粗** 与 `代码`\n\n```go\nfmt.Println(1)\n```\n"
        response = await self.save(text)
        self.assertEqual(response.status_code, 200, response.text)
        preview = response.json()["preview"]
        self.assertEqual(preview["newContent"], text)
        self.assertEqual(preview["oldContent"], self.original)
        self.assertEqual(preview["instruction"], "扩写内容")
        self.assertEqual(preview["sourceContentHash"], self.source_hash)
        self.assertEqual(preview["changeSummary"], ["手动调整预览正文"])
        self.assertEqual(preview["status"], "preview")
        self.assertGreater(preview["updatedAt"], self.initial_token)
        revisions = await self.revisions()
        self.assertEqual([item["source"] for item in revisions], ["generated", "manual"])
        self.assertEqual(revisions[-1]["newContent"], text)
        self.model.assert_not_awaited()
        self.graph.assert_not_awaited()
        self.initialize_graph.assert_not_awaited()
        await self.assert_original_untouched()

    async def test_exact_retries_are_no_op_even_when_response_was_lost(self):
        original_response = await self.save(self.initial)
        self.assertEqual(original_response.json()["preview"]["updatedAt"], self.initial_token)
        self.assertEqual(original_response.json()["preview"]["changeSummary"], ["初始说明"])
        first = (await self.save("手动内容")).json()["preview"]
        retry = await self.save("手动内容", self.initial_token)
        self.assertEqual(retry.status_code, 200, retry.text)
        self.assertEqual(retry.json()["preview"], first)
        self.assertEqual(len(await self.revisions()), 2)
        await self.assert_original_untouched()

    async def test_empty_text_and_whitespace_are_valid_changes_with_no_new_small_limit(self):
        previous_token = self.initial_token
        for text in ("", "\n  \n", "长正文\n" * 33000):
            response = await self.save(text, previous_token)
            self.assertEqual(response.status_code, 200, response.text[:500])
            preview = response.json()["preview"]
            self.assertEqual(preview["newContent"], text)
            previous_token = preview["updatedAt"]
        self.assertEqual([item["source"] for item in await self.revisions()], ["generated", "manual", "manual", "manual"])
        await self.assert_original_untouched()

    async def test_conflict_rejects_stale_or_reformatted_token_without_overwriting(self):
        first = (await self.save("另一个标签页的内容")).json()["preview"]
        for token in (self.initial_token, first["updatedAt"][:23], "2026-10-20T00:00:00Z"):
            response = await self.save("本地尚未保存的内容", token)
            self.assertEqual(response.status_code, 409, response.text)
            self.assertIn("手动修改已保留", response.json()["detail"])
        current = (await self.client.get("/api/note-edit-previews/preview")).json()["preview"]
        self.assertEqual(current, first)
        self.assertEqual(len(await self.revisions()), 2)

    async def test_required_payload_fields_and_owner_scope(self):
        for payload in ({"newContent": "内容"}, {"newContent": "内容", "expectedUpdatedAt": ""},
                        {"newContent": None, "expectedUpdatedAt": self.initial_token},
                        {"expectedUpdatedAt": self.initial_token}):
            response = await self.client.patch("/api/note-edit-previews/preview/content", json=payload)
            self.assertEqual(response.status_code, 422, response.text)
        self.app.dependency_overrides[get_current_user] = lambda: CurrentUser(id="another-user", email="other@example.invalid", display_name="other")
        self.assertEqual((await self.save("非法写入")).status_code, 404)
        self.app.dependency_overrides.clear()
        self.assertEqual((await self.save("匿名写入")).status_code, 401)
        self.app.dependency_overrides[get_current_user] = lambda: self.user
        self.assertEqual((await self.save("不存在", edit_id="missing")).status_code, 404)
        self.assertEqual(len(await self.revisions()), 1)
        await self.assert_original_untouched()

    async def test_terminal_deleted_note_and_delete_preview_cannot_be_edited(self):
        for status in ("applied", "cancelled"):
            async with self.sessions() as session:
                preview = await session.get(NoteEditPreview, "preview")
                preview.status = status
                await session.commit()
            self.assertEqual((await self.save(self.initial)).status_code, 409, "even identical replay must obey terminal status")
        async with self.sessions() as session:
            preview = await session.get(NoteEditPreview, "preview")
            preview.status = "preview"
            preview.target_type = "delete"
            await session.commit()
        response = await self.save("不能伪装为已保存却应用时被删除")
        self.assertEqual(response.status_code, 409)
        self.assertIn("删除预览不能手动编辑", response.json()["detail"])
        async with self.sessions() as session:
            preview = await session.get(NoteEditPreview, "preview")
            preview.target_type = "note"
            note = await session.get(Note, "preview-note")
            note.deleted_at = datetime.utcnow()
            await session.commit()
        self.assertEqual((await self.save("已删除笔记")).status_code, 404)
        self.assertEqual(len(await self.revisions()), 1)

    async def test_manual_revision_can_be_restored_and_is_used_by_next_ai_generation(self):
        self.assertEqual((await self.save("人工写下的最新版本")).status_code, 200)
        manual = (await self.revisions())[-1]
        response = await self.client.post("/api/note-edit-previews/preview/restore-revision", json={"revisionId": "generated"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["preview"]["newContent"], self.initial)
        response = await self.client.post("/api/note-edit-previews/preview/restore-revision", json={"revisionId": manual["id"]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["preview"]["newContent"], manual["newContent"])
        response = await self.client.post("/api/note-edit-previews/preview/revise", json={"instruction": "补一个例子", "memoryEnabled": False})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.model.await_args.kwargs["current_preview"], manual["newContent"])
        self.assertEqual([item["source"] for item in await self.revisions()], ["generated", "manual", "revision"])
        await self.assert_original_untouched()

    async def test_apply_uses_current_manual_content_and_keeps_original_version(self):
        self.assertEqual((await self.save("最终人工稿")).status_code, 200)
        await self.assert_original_untouched()

        async def synthetic_index_job(session, note):
            job = NoteIndexJob(id="synthetic-index-job", user_id=note.user_id, note_id=note.id)
            session.add(job)
            await session.flush()
            return job

        with patch.object(edits, "index_note_now", synthetic_index_job):
            response = await self.client.post("/api/note-edit-previews/preview/apply")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["note"]["content"], "最终人工稿")
        self.assertEqual(response.json()["preview"]["status"], "applied")
        async with self.sessions() as session:
            versions = list((await session.scalars(select(NoteVersion))).all())
            self.assertEqual(len(versions), 1)
            self.assertEqual(versions[0].content, self.original)
        self.assertEqual((await self.save("不能再修改")).status_code, 409)

    async def test_late_ai_result_does_not_overwrite_concurrent_manual_or_restored_content(self):
        for concurrent_action in ("manual", "restore", "cancel"):
            with self.subTest(concurrent_action=concurrent_action):
                # Reset just the synthetic preview between independent races.
                async with self.sessions() as session:
                    preview = await session.get(NoteEditPreview, "preview")
                    preview.status = "preview"
                    preview.new_content = "当前版本"
                    preview.updated_at = datetime.utcnow()
                    await session.commit()
                    token = preview.updated_at.isoformat()
                started, release = asyncio.Event(), asyncio.Event()

                async def delayed_generation(**kwargs):
                    started.set()
                    await release.wait()
                    return SimpleNamespace(new_content="过时的 AI 结果", change_summary=["不应写入"])

                self.model.side_effect = delayed_generation
                task = asyncio.create_task(self.client.post("/api/note-edit-previews/preview/revise", json={"instruction": "继续改", "memoryEnabled": False}))
                await asyncio.wait_for(started.wait(), 5)
                try:
                    if concurrent_action == "manual":
                        competing = await self.save("必须保留的人工修改", token)
                    elif concurrent_action == "restore":
                        competing = await self.client.post("/api/note-edit-previews/preview/restore-revision", json={"revisionId": "generated"})
                    else:
                        competing = await self.client.post("/api/note-edit-previews/preview/cancel")
                    self.assertEqual(competing.status_code, 200, competing.text)
                finally:
                    release.set()
                late = await asyncio.wait_for(task, 5)
                self.assertEqual(late.status_code, 409, late.text)
                current = (await self.client.get("/api/note-edit-previews/preview")).json()["preview"]
                self.assertEqual(current["newContent"], competing.json()["preview"]["newContent"])
                self.assertNotEqual(current["newContent"], "过时的 AI 结果")
                self.assertFalse(any(item["newContent"] == "过时的 AI 结果" for item in await self.revisions()))
                await self.assert_original_untouched()


if __name__ == "__main__":
    unittest.main()
