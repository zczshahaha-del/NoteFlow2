from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.deps import CurrentUser
from app.models.db import User, NoteDraft, NoteDraftSection, NoteDraftSectionVersion
from app.routers import drafts
from app.services.draft_brief import DraftBrief, generation_request
from app.services import draft_worker


class DraftBriefTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
        async with self.engine.begin() as conn:
            for table in (User.__table__, NoteDraft.__table__, NoteDraftSection.__table__, NoteDraftSectionVersion.__table__):
                await conn.run_sync(table.create)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        self.user = CurrentUser(id="brief-user", email="brief@example.invalid", display_name="合成用户")
        async with self.sessions() as db:
            db.add(User(id=self.user.id, email=self.user.email, display_name="合成用户"))
            db.add(NoteDraft(id="brief-draft", user_id=self.user.id, title="旧标题", topic="旧主题", outline="## 原大纲", status="outline_ready",
                draft_config={"rawRequest": "不可变原始请求", "bodyInstruction": "旧全文要求", "generationJob": {"status": "completed"}}))
            db.add(NoteDraftSection(id="old-section", user_id=self.user.id, draft_id="brief-draft", title="原章节", content="原正文", status="generated"))
            await db.commit()

    async def asyncTearDown(self):
        await self.engine.dispose()

    def payload(self):
        return drafts.DraftUpdatePayload(title="《两小儿辩日》教案", outline="## 教学过程", status="outline_ready", assembledContent="",
            generationBrief=DraftBrief(title="《两小儿辩日》教案", requirements="重点设计课堂提问", rawRequest="试图替换来源"),
            includeCode=False, includeExercises=False, sections=[drafts.DraftSectionPayload(title="教学过程")])

    async def test_brief_is_saved_with_request_and_worker_uses_it(self):
        initialize = AsyncMock(return_value=True)
        with patch.object(drafts, "AsyncSessionLocal", self.sessions), patch.object(drafts, "initialize_draft_graph", initialize):
            result = await drafts.update_draft("brief-draft", self.payload(), self.user)
        record = result["draft"]
        self.assertEqual(record["topic"], "《两小儿辩日》教案")
        self.assertEqual(record["draftConfig"]["rawRequest"], "不可变原始请求")
        self.assertEqual(record["draftConfig"]["generationBrief"]["requirements"], "重点设计课堂提问")
        self.assertEqual(record["draftConfig"]["bodyInstruction"], "")
        self.assertNotIn("generationJob", record["draftConfig"])
        self.assertFalse(record["includeCode"])
        self.assertEqual(initialize.await_args.kwargs["topic"], "《两小儿辩日》教案")
        async with self.sessions() as db:
            draft = await db.get(NoteDraft, "brief-draft")
            self.assertIn("当前生成要求：重点设计课堂提问", draft_worker._raw_request(draft))
            self.assertEqual(draft_worker._raw_request(draft), draft.extra_request)

    async def test_graph_failure_rolls_back_existing_body_and_brief(self):
        with patch.object(drafts, "AsyncSessionLocal", self.sessions), patch.object(drafts, "initialize_draft_graph", AsyncMock(return_value=False)):
            with self.assertRaises(HTTPException) as error:
                await drafts.update_draft("brief-draft", self.payload(), self.user)
        self.assertEqual(error.exception.status_code, 503)
        async with self.sessions() as db:
            draft = await db.get(NoteDraft, "brief-draft")
            section = await db.get(NoteDraftSection, "old-section")
            self.assertEqual(draft.topic, "旧主题")
            self.assertEqual(draft.outline, "## 原大纲")
            self.assertEqual(section.content, "原正文")
            self.assertNotIn("generationBrief", draft.draft_config)

    async def test_other_account_cannot_change_brief(self):
        with patch.object(drafts, "AsyncSessionLocal", self.sessions):
            with self.assertRaises(HTTPException) as error:
                await drafts.update_draft("brief-draft", self.payload(), CurrentUser(id="other", email="other@example.invalid", display_name="other"))
        self.assertEqual(error.exception.status_code, 404)

    async def test_saved_or_generating_draft_rejects_new_outline(self):
        for status in ("saved", "generating", "canceled"):
            async with self.sessions() as db:
                draft = await db.get(NoteDraft, "brief-draft")
                draft.status = status
                await db.commit()
            with patch.object(drafts, "AsyncSessionLocal", self.sessions):
                with self.assertRaises(HTTPException) as error:
                    await drafts.update_draft("brief-draft", self.payload(), self.user)
            self.assertEqual(error.exception.status_code, 409)

    async def test_worker_first_pass_and_review_respect_document_purpose(self):
        async with self.sessions() as db:
            draft = await db.get(NoteDraft, "brief-draft")
            draft.topic = "《两小儿辩日》教案"
            draft.draft_config = {"generationBrief": {"title": draft.topic, "requirements": "课堂讨论", "rawRequest": "原话"}}
            section = await db.get(NoteDraftSection, "old-section")
            model = AsyncMock(side_effect=["## 教学过程\n教师引导学生讨论。", "## 教学过程\n学生讨论并归纳观点。"])
            with patch.object(draft_worker, "_complete_with_retry", model):
                result = await draft_worker._generate_section(draft, section)
            self.assertIn("学生讨论", result)
            for call in model.await_args_list:
                self.assertIn("当前生成要求：课堂讨论", call.args[0][1]["content"])
                self.assertNotIn("技术课程作者", call.args[0][0]["content"])

    def test_cleared_requirements_are_not_replaced_with_old_request(self):
        request = generation_request({"title": "新教案", "requirements": "", "rawRequest": "旧教程要求十章"})
        self.assertIn("当前生成标题：新教案", request)
        self.assertIn("不沿用已被清空或替换的旧要求", request)


if __name__ == "__main__":
    unittest.main()
