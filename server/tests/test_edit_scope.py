"""Scope boundaries and exact local edits; no app data or real model calls."""
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from app.routers.edits import EditPreviewPayload, _resolve_target, _apply_preview_content
from app.services.edit_scope import infer_edit_target
from app.services.note_edit import EditGenerationError, generate_edit_preview, revise_edit_preview


NOTE = "# API 笔记\n\n## 安装与配置\n\nAPI 用来调用模型。\n\n```python\nprint('保留代码')\n```\n\n## 错误处理\n\n出错时重试。\n"


class EditScopeTest(unittest.IsolatedAsyncioTestCase):
    async def resolve(self, instruction, selected="", **kwargs):
        with patch("app.routers.edits._get_sections", new=AsyncMock(return_value=[])):
            return await _resolve_target(None, "owner", SimpleNamespace(id="note", content=NOTE),
                                         EditPreviewPayload(noteId="note", instruction=instruction, selectedText=selected, **kwargs))

    async def test_selection_wins_over_passive_chapter(self):
        result = await self.resolve("讲得通俗一点", "API 用来调用模型。", contextSectionId="unrelated")
        self.assertEqual(result[:3], ("selection", None, "API 用来调用模型。"))
        legacy = await self.resolve("讲得通俗一点", "API 用来调用模型。", sectionId="unrelated")
        self.assertEqual(legacy[0], "selection")
        self.assertEqual(infer_edit_target("这个段落讲得通俗一点"), None)

    async def test_explicit_expansion_includes_only_selected_section(self):
        result = await self.resolve("把这一整节补充完整", "API 用来调用模型。")
        self.assertEqual(result[0], "section")
        self.assertIn("保留代码", result[2])
        self.assertNotIn("错误处理", result[2])

    async def test_current_section_context_is_only_used_when_explicitly_requested(self):
        section = SimpleNamespace(id="current", title="安装与配置", content=NOTE.split("## 安装与配置", 1)[1].split("## 错误处理", 1)[0])
        with patch("app.routers.edits._get_section", new=AsyncMock(return_value=section)) as get_section:
            result = await self.resolve("把当前小节写详细一些", contextSectionId="current")
        self.assertEqual(result[0], "section")
        self.assertEqual(result[1], "current")
        get_section.assert_awaited_once()

    async def test_named_section_does_not_use_reading_position(self):
        result = await self.resolve("重写安装与配置这一节", contextSectionId="wrong-section")
        self.assertEqual(result[0], "section")
        self.assertTrue(result[2].startswith("## 安装与配置"))
        self.assertNotIn("错误处理", result[2])

    async def test_whole_note_is_explicit_and_can_override_selection(self):
        result = await self.resolve("整篇整理一下，去掉重复内容", "API 用来调用模型。", contextSectionId="wrong")
        self.assertEqual(result[0], "note")
        self.assertEqual(result[2], NOTE)

    async def test_ambiguous_here_is_clarified_despite_current_chapter(self):
        with self.assertRaises(HTTPException) as caught:
            await self.resolve("这里改一下", contextSectionId="current")
        self.assertEqual(caught.exception.status_code, 400)
        self.assertIn("哪一部分", caught.exception.detail)

    async def test_partial_deletion_does_not_delete_entire_scope(self):
        self.assertIsNone(infer_edit_target("删除重复内容"))
        self.assertIsNone(infer_edit_target("不要删除内容，讲得通俗一点"))
        self.assertEqual(infer_edit_target("删除选中文字"), "delete")
        self.assertEqual(infer_edit_target("整篇整理一下，删除重复内容"), "note")
        result = await self.resolve("只改选中文字，不要重写整篇", "API 用来调用模型。")
        self.assertEqual(result[0], "selection")

    async def test_duplicate_heading_or_selection_requires_clarification(self):
        for content, instruction, selected in [
            (NOTE + "\n## 安装与配置\n\n另一节", "重写安装与配置这一节", ""),
            (NOTE + "\nAPI 用来调用模型。", "通俗一点", "API 用来调用模型。"),
        ]:
            with self.assertRaises(HTTPException) as caught:
                await _resolve_target(None, "owner", SimpleNamespace(id="note", content=content),
                                      EditPreviewPayload(noteId="note", instruction=instruction, selectedText=selected))
            self.assertEqual(caught.exception.status_code, 409)

    async def test_code_heading_is_not_a_target(self):
        with patch("app.routers.edits._get_sections", new=AsyncMock(return_value=[])), self.assertRaises(HTTPException):
            await _resolve_target(None, "owner", SimpleNamespace(id="note", content="# 正文\n\n```python\n# 假章节\n```\n"),
                                  EditPreviewPayload(noteId="note", instruction="修改假章节"))

    async def test_patch_preserves_other_text_and_applies_only_at_target(self):
        target = (await self.resolve("把安装与配置的开头介绍写详细一点"))[2]
        answer = {"edits": [{"oldText": "API 用来调用模型。", "newText": "API 是程序与模型通信的接口。\n\n例如，程序发送问题，模型返回回答。"}],
                  "changeSummary": ["扩写开头介绍"]}
        with patch("app.services.note_edit._call_ai", new=AsyncMock(return_value=json.dumps(answer, ensure_ascii=False))) as model:
            result = await generate_edit_preview(note_title="API 笔记", target_type="section", target_content=target,
                                                 instruction="把开头介绍写详细一点，代码保留")
        self.assertIn("只读参考上下文", model.call_args.args[0])
        self.assertEqual(result.new_content, target.replace("API 用来调用模型。", answer["edits"][0]["newText"]))
        applied = _apply_preview_content(SimpleNamespace(content=NOTE),
                                        SimpleNamespace(target_type="section", old_content=target, new_content=result.new_content))
        self.assertEqual(applied, NOTE.replace("API 用来调用模型。", answer["edits"][0]["newText"]))

    async def test_revise_uses_current_draft_and_retains_manual_changes(self):
        current = "## 安装与配置\n\n手动改过的开头。\n\n已经认可的例子。\n"
        with patch("app.services.note_edit._call_ai", new=AsyncMock(return_value=json.dumps({
            "edits": [{"oldText": "已经认可的例子。", "newText": "已经认可的例子。\n\n再加一个例子。"}],
            "changeSummary": ["补例子"],
        }, ensure_ascii=False))):
            result = await revise_edit_preview(note_title="API", target_type="section", original_content="旧原文",
                                               current_preview=current, instruction="再加一个例子")
        self.assertTrue(result.new_content.startswith("## 安装与配置\n\n手动改过的开头。"))
        self.assertIn("已经认可的例子", result.new_content)

    async def test_insert_and_continue_do_not_duplicate_anchor(self):
        anchor = "API 用来调用模型。"
        with patch("app.services.note_edit._call_ai", new=AsyncMock(return_value=json.dumps({
            "newContent": "例如，发送问题获取回答。", "changeSummary": ["新增例子"],
        }, ensure_ascii=False))):
            initial = await generate_edit_preview(note_title="API", target_type="insert", target_content=anchor,
                                                  instruction="后面加个例子")
        with patch("app.services.note_edit._call_ai", new=AsyncMock(return_value=json.dumps({
            "edits": [{"oldText": initial.new_content, "newText": initial.new_content + "\n\n再加一句解释。"}],
        }, ensure_ascii=False))):
            revised = await revise_edit_preview(note_title="API", target_type="insert", original_content=anchor,
                                                current_preview=initial.new_content, instruction="加一句解释")
        applied = _apply_preview_content(SimpleNamespace(content=NOTE),
                                        SimpleNamespace(target_type="insert", old_content=anchor, new_content=revised.new_content))
        self.assertEqual(applied.count(anchor), 1)
        self.assertEqual(applied, NOTE.replace(anchor, anchor + "\n\n" + revised.new_content))

    async def test_invalid_patches_never_fall_back_to_replacing_the_section(self):
        cases = [
            {"newContent": "整节被误重写"},
            {"edits": [{"oldText": "不存在", "newText": "错"}]},
            {"edits": [{"oldText": "API", "newText": "一"}, {"oldText": "API 用来调用模型。", "newText": "二"}]},
            {"edits": [{"oldText": "", "newText": "随处插入"}]},
        ]
        for value in cases:
            with self.subTest(value=value), patch("app.services.note_edit._call_ai", new=AsyncMock(return_value=json.dumps(value))):
                with self.assertRaises(EditGenerationError):
                    await generate_edit_preview(note_title="API", target_type="section", target_content=NOTE, instruction="扩写开头")

    async def test_explicit_rewrite_allows_complete_new_content(self):
        with patch("app.services.note_edit._call_ai", new=AsyncMock(return_value='{"newContent":"新小节","changeSummary":["重写"]}')):
            result = await generate_edit_preview(note_title="API", target_type="section", target_content=NOTE, instruction="重写这一节")
        self.assertEqual(result.new_content, "新小节")


if __name__ == "__main__":
    unittest.main()
