"""Real router/worker persistence with synthetic model replies; no external AI."""
import unittest
from unittest.mock import AsyncMock, patch

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.deps import CurrentUser
from app.models.db import User, Note, NoteCategory, NoteVersion, NoteIndexJob, NoteDraft, NoteDraftSection, NoteDraftSectionVersion, NoteEditPreview
from app.routers import drafts, notes
from app.services import draft_worker
from app.services.heading_number_repair import repair_heading_numbers, content_hash
from app.services import heading_number_repair


class GeneratedHeadingLifecycleTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
        self.addAsyncCleanup(self.engine.dispose)
        async with self.engine.begin() as connection:
            for model in (User, NoteCategory, Note, NoteVersion, NoteIndexJob, NoteDraft, NoteDraftSection, NoteDraftSectionVersion, NoteEditPreview):
                await connection.run_sync(model.__table__.create)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        self.user = CurrentUser(id="heading-user", email="headings@example.invalid", display_name="合成用户")
        async with self.sessions() as session:
            session.add(User(id=self.user.id, email=self.user.email, display_name=self.user.display_name))
            await session.commit()
        self.patches = [patch.object(module, "AsyncSessionLocal", self.sessions) for module in (drafts, notes, draft_worker)]
        self.patches.extend([patch.object(drafts, "initialize_draft_graph", AsyncMock(return_value=True)), patch.object(drafts, "authorize_draft_save", AsyncMock(return_value=True))])
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

    async def asyncTearDown(self):
        await self.engine.dispose()

    async def create(self):
        result = await drafts.create_draft(drafts.DraftCreatePayload(topic="合成笔记", outline="# 合成笔记\n\n## 一、基础\n\n## 7. 安装\n\n## 8. 运行",
            sections=[drafts.DraftSectionPayload(id=str(i), title=title, sortOrder=i, outlineText=f"## {title}") for i, title in enumerate(("基础", "安装", "运行"))]), self.user)
        return result["draft"]

    async def index(self, session, note):
        job = NoteIndexJob(id="job-" + note.id, user_id=note.user_id, note_id=note.id)
        session.add(job)
        await session.flush()
        return job

    async def test_outline_chapter_assembly_save_and_manual_delete_reopen(self):
        draft = await self.create()
        self.assertIn("## 1. 基础", draft["outline"])
        self.assertIn("## 3. 运行", draft["outline"])
        self.assertEqual([s["title"] for s in draft["sections"]], ["基础", "安装", "运行"])
        self.assertEqual(draft["sections"][2]["outlineText"], "## 3. 运行")
        generated = await drafts.update_draft_section(draft["id"], "2", drafts.DraftSectionUpdatePayload(content="## 一、运行\n\n### 9.1 示例\n\n```md\n## 一、代码\n```", source="generate_section", status="generated"), self.user)
        section_content = next(s["content"] for s in generated["draft"]["sections"] if s["id"] == "2")
        self.assertIn("## 3. 运行", section_content)
        self.assertIn("### 3.1 示例", section_content)
        self.assertIn("## 一、代码", section_content)
        assembled = await drafts.assemble_draft(draft["id"], drafts.DraftAssemblePayload(content="# 合成笔记\n\n## 基础\n\n## 安装\n\n" + section_content), self.user)
        content = assembled["draft"]["assembledContent"]
        self.assertIn("### 3.1 示例", content)
        with patch.object(drafts, "index_note_now", self.index):
            saved = await drafts.save_draft_to_notes(draft["id"], drafts.DraftSavePayload(confirm=True), self.user)
            replay = await drafts.save_draft_to_notes(draft["id"], drafts.DraftSavePayload(confirm=True), self.user)
        self.assertEqual(saved["note"]["content"], content)
        self.assertEqual(replay["note"]["content"], content)
        edited = content.replace("### 3.1 示例", "### 示例")
        with patch.object(notes, "index_note_now", AsyncMock()):
            await notes.update_note(saved["note"]["id"], notes.NoteUpdatePayload(content=edited, expectedContentHash=saved["note"]["contentHash"]), self.user)
        async with self.sessions() as session:
            reopened = await session.get(Note, saved["note"]["id"])
            versions = list((await session.execute(select(NoteVersion).where(NoteVersion.note_id == reopened.id))).scalars())
            self.assertEqual(reopened.content, edited, "Ordinary save must not revive a deleted number")
            self.assertTrue(any(v.content == content for v in versions))

    async def test_manual_section_update_and_assembled_save_do_not_repair_user_text(self):
        draft = await self.create()
        manual = "## 运行\n\n### 我手动删过编号\n"
        result = await drafts.update_draft_section(draft["id"], "2", drafts.DraftSectionUpdatePayload(content=manual, source="manual_edit"), self.user)
        self.assertEqual(next(s["content"] for s in result["draft"]["sections"] if s["id"] == "2"), manual)
        await drafts.update_draft(draft["id"], drafts.DraftUpdatePayload(assembledContent=manual, status="assembled"), self.user)
        with patch.object(drafts, "index_note_now", self.index):
            saved = await drafts.save_draft_to_notes(draft["id"], drafts.DraftSavePayload(confirm=True), self.user)
        self.assertEqual(saved["note"]["content"], manual.strip())

    async def test_background_worker_uses_global_number_and_full_assembly(self):
        draft = await self.create()
        with patch.object(draft_worker, "_generate_section", AsyncMock(return_value="## 运行\n\n### 示例\n\n正文")):
            await draft_worker._run_claim(draft["id"], "2")
        async with self.sessions() as session:
            section = await session.get(NoteDraftSection, "2")
            self.assertEqual(section.content, "## 3. 运行\n\n### 3.1 示例\n\n正文")
            document = await session.get(NoteDraft, draft["id"])
            siblings = list((await session.execute(select(NoteDraftSection))).scalars())
            for item in siblings[:2]:
                item.content = "## " + item.title
            assembled = draft_worker._assemble(document, siblings)
            self.assertIn("## 3. 运行", assembled)
            self.assertIn("### 3.1 示例", assembled)
            document.status = "generating"
            for item in siblings:
                item.status = "generated"
            await session.commit()
        await draft_worker._finalize_draft(draft["id"])
        async with self.sessions() as session:
            document = await session.get(NoteDraft, draft["id"])
            self.assertEqual(document.status, "assembled")
            self.assertIn("### 3.1 示例", document.assembled_content)
            self.assertEqual(list((await session.execute(select(Note))).scalars()), [], "Generation cannot silently create a formal note")

    async def test_bad_model_heading_does_not_leave_worker_generating_or_overwrite_body(self):
        draft = await self.create()
        async with self.sessions() as session:
            section = await session.get(NoteDraftSection, "2")
            section.content, section.status = "原正文", "generating"
            await session.commit()
        with patch.object(draft_worker, "_generate_section", AsyncMock(return_value="## **一**、无法安全映射")):
            await draft_worker._run_claim(draft["id"], "2")
        async with self.sessions() as session:
            section = await session.get(NoteDraftSection, "2")
            self.assertEqual(section.status, "failed")
            self.assertEqual(section.content, "原正文")

    async def test_unassembled_outline_save_does_not_duplicate_heading(self):
        draft = await self.create()
        with patch.object(drafts, "index_note_now", self.index):
            saved = await drafts.save_draft_to_notes(draft["id"], drafts.DraftSavePayload(confirm=True), self.user)
        self.assertEqual(saved["note"]["content"], "## 1. 基础\n\n## 2. 安装\n\n## 3. 运行")

    async def test_explicit_workspace_reorder_reforms_numbers_and_keeps_section_versions(self):
        draft = await self.create()
        for section in draft["sections"]:
            await drafts.update_draft_section(draft["id"], section["id"], drafts.DraftSectionUpdatePayload(content=f'## {section["title"]}\n\n### 示例\n\n正文', source="generate_section", status="generated"), self.user)
        result = await drafts.update_draft(draft["id"], drafts.DraftUpdatePayload(sectionOrder=["2", "0", "1"]), self.user)
        sections = result["draft"]["sections"]
        self.assertEqual(sections[0]["id"], "2")
        self.assertIn("## 1. 运行", sections[0]["content"])
        self.assertIn("### 1.1 示例", sections[0]["content"])
        self.assertIn("## 2. 基础", sections[1]["content"])
        self.assertEqual(result["draft"]["assembledContent"], "")
        async with self.sessions() as session:
            versions = list((await session.execute(select(NoteDraftSectionVersion).where(NoteDraftSectionVersion.source == "outline_reorder"))).scalars())
            self.assertEqual(len(versions), 3)
            self.assertTrue(any("## 3. 运行" in v.content for v in versions))

    async def seed_repair_notes(self):
        async with self.sessions() as session:
            for name in ("repair-a", "repair-b"):
                session.add(Note(id=name, user_id=self.user.id, title="笔记", content="# 笔记\n\n## 基础\n\n正文\n\n```md\n## 示例\n```", index_status="indexed"))
            await session.commit()

    async def test_explicit_repair_dry_run_then_hash_guarded_backup_and_apply(self):
        await self.seed_repair_notes()
        async with self.sessions() as session:
            dry = await repair_heading_numbers(session, self.user.id, {"repair-a": None})
            self.assertEqual(dry[0]["changed_headings"], 1)
            self.assertIsNone(dry[0]["backup_version_id"])
            before = (await session.get(Note, "repair-a")).content
        expected = (dry[0]["source_hash"], dry[0]["target_hash"])
        with patch.object(heading_number_repair, "index_note_now", self.index):
            async with self.sessions() as session:
                async with session.begin():
                    applied = await repair_heading_numbers(session, self.user.id, {"repair-a": expected}, apply=True)
        async with self.sessions() as session:
            note = await session.get(Note, "repair-a")
            version = await session.get(NoteVersion, applied[0]["backup_version_id"])
            self.assertEqual(version.content, before)
            self.assertEqual(content_hash(note.content), expected[1])
            self.assertEqual(note.content, before.replace("## 基础", "## 1. 基础"))
            self.assertEqual((await session.get(Note, "repair-b")).content, before)

    async def test_repair_all_scope_validation_precedes_writes(self):
        await self.seed_repair_notes()
        async with self.sessions() as session:
            dry = await repair_heading_numbers(session, self.user.id, {"repair-a": None, "repair-b": None})
        targets = {row["note_id"]: (row["source_hash"], row["target_hash"]) for row in dry}
        targets["repair-b"] = ("0" * 64, "0" * 64)
        index = AsyncMock()
        with patch.object(heading_number_repair, "index_note_now", index):
            with self.assertRaises(ValueError):
                async with self.sessions() as session:
                    async with session.begin():
                        await repair_heading_numbers(session, self.user.id, targets, apply=True)
        index.assert_not_awaited()
        async with self.sessions() as session:
            self.assertNotIn("## 1.", (await session.get(Note, "repair-a")).content)
            self.assertEqual(list((await session.execute(select(NoteVersion))).scalars()), [])

    async def test_repair_rejects_other_account_or_pending_ai_preview(self):
        await self.seed_repair_notes()
        async with self.sessions() as session:
            with self.assertRaises(ValueError):
                await repair_heading_numbers(session, "other-account", {"repair-a": None})
            session.add(NoteEditPreview(id="pending", user_id=self.user.id, note_id="repair-a", status="preview"))
            await session.commit()
        async with self.sessions() as session:
            with self.assertRaisesRegex(ValueError, "待确认 AI"):
                await repair_heading_numbers(session, self.user.id, {"repair-a": None})
