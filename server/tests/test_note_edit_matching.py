from __future__ import annotations

import unittest
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.routers.edits import (
    EditPreviewPayload,
    _apply_preview_content,
    _find_anchor_span,
    _make_edit_revision,
    _replace_once,
    _resolve_target,
    _resolve_selected_content,
)


MARKDOWN_NOTE = """## 1\\. 为什么需要 RAG？——大模型的“记忆”短板

我们平时用的大模型虽然能写出流畅段落，但它们的知识会停留在训练那天。

##  大模型的三个"硬伤"

尽管大语言模型（LLM）能力惊人，但在实际应用中仍有三个明显的"硬伤"，正是这些缺陷让 RAG（检索增强生成）变得不可或缺。

1. 知识时效性差 —— "记忆只停留在训练那天"
大模型的知识来源于训练数据，它的"知识截止日期"是固定的。比如一个模型在2023年某月完成训练，那么它对2024年发生的新事件、新政策、新产品就完全不知道。

2. 幻觉问题 —— "自信地胡说八道"
大模型本质上是根据概率预测下一个词，它没有事实检查机制。当它遇到不确定或者训练数据中少见的问题时，很容易生成看似合理但完全错误的内容。

3. 缺乏专业/私有知识 —— "没学过就是不懂"
大模型在通用领域表现优秀，但在特定专业领域或个人笔记内容上往往力不从心，因为这些专有知识从未出现在训练数据中。

总结来说，这三个硬伤分别对应时间维度（知识过时）、真实性维度（幻觉）和专有性维度（领域知识缺失），而 RAG 正是通过"先检索、后生成"的架构，巧妙地解决了这些痛点。

1. 知识有截止日期
模型训练时用的数据是某个时间点之前的，比如 2023 年底。你问"今天天气如何"或"某公司今年最新财报"，它没法给出新鲜答案。

2. 容易"胡说八道"（幻觉）
面对不知道的问题，模型可能编造一个听起来合理的回答。比如问你某本小众书的具体页码，它可能为了"完成任务"而随机造一个数字。

3. 看不到你的私有数据
你的公司内部文档、个人笔记、产品手册，模型训练时根本没接触过。

## 2. RAG 的基本流程

RAG 会先检索相关资料，再把资料交给模型生成答案。
"""


RENDERED_SELECTION = """大模型的三个"硬伤"
尽管大语言模型（LLM）能力惊人，但在实际应用中仍有三个明显的"硬伤"，正是这些缺陷让 RAG（检索增强生成）变得不可或缺。

1. 知识时效性差 —— "记忆只停留在训练那天"
大模型的知识来源于训练数据，它的"知识截止日期"是固定的。比如一个模型在2023年某月完成训练，那么它对2024年发生的新事件、新政策、新产品就完全不知道。

2. 幻觉问题 —— "自信地胡说八道"
大模型本质上是根据概率预测下一个词，它没有事实检查机制。当它遇到不确定或者训练数据中少见的问题时，很容易生成看似合理但完全错误的内容。

3. 缺乏专业/私有知识 —— "没学过就是不懂"
大模型在通用领域表现优秀，但在特定专业领域或个人笔记内容上往往力不从心，因为这些专有知识从未出现在训练数据中。

总结来说，这三个硬伤分别对应时间维度（知识过时）、真实性维度（幻觉）和专有性维度（领域知识缺失），而 RAG 正是通过"先检索、后生成"的架构，巧妙地解决了这些痛点。

知识有截止日期
模型训练时用的数据是某个时间点之前的，比如 2023 年底。你问"今天天气如何"或"某公司今年最新财报"，它没法给出新鲜答案。

容易"胡说八道"（幻觉）
面对不知道的问题，模型可能编造一个听起来合理的回答。比如问你某本小众书的具体页码，它可能为了"完成任务"而随机造一个数字。

看不到你的私有数据
你的公司内部文档、个人笔记、产品手册，模型训练时根本没接触过。"""


REVISED_CONTENT = """大模型的三大硬伤，RAG 逐个击破

1. 知识过时：模型只知道训练前的信息，RAG 可以检索最新资料。
2. 容易幻觉：模型可能编造答案，RAG 可以提供外部证据。
3. 缺少私有知识：模型没见过你的资料，RAG 可以接入个人笔记和内部文档。"""


SHORT_MARKDOWN_NOTE = """前文保留。

## 大模型的三个缺陷让 RAG 不可或缺：

1.  **知识过时**：知识止于训练日，无法回答新事件。RAG 实时检索最新文档补上。
2.  **幻觉**：模型按概率生成，无事实检查，易给出错误答案。RAG 从权威库检索正确信息。
3.  **缺私有知识**：没学过公司流程、个人笔记。RAG 接入文档后准确回答。

三个缺陷对应时间、真实性、专有性，RAG 以“先检索、后生成”解决，就像从闭卷考试变成开卷考试。

## 后文小节

后文保留。"""

SHORT_SECTION_CONTENT = SHORT_MARKDOWN_NOTE.split("前文保留。\n\n", 1)[1].split("\n\n## 后文小节", 1)[0]


SHORT_RENDERED_SELECTION = """大模型的三个缺陷让 RAG 不可或缺：
知识过时：知识止于训练日，无法回答新事件。RAG 实时检索最新文档补上。
幻觉：模型按概率生成，无事实检查，易给出错误答案。RAG 从权威库检索正确信息。
缺私有知识：没学过公司流程、个人笔记。RAG 接入文档后准确回答。
三个缺陷对应时间、真实性、专有性，RAG 以“先检索、后生成”解决，就像从闭卷考试变成开卷考试。"""


NESTED_MARKDOWN_NOTE = """# RAG 学习笔记

## 大模型虽然聪明，但也不是万能的。首先，它的知识有保质期，其次它会编故事，最后它看不到你的私密数据

这一节先解释大模型的三个限制。

### 知识过时

GPT-4 只学到某个训练时间点，后面的新闻、政策、产品更新都不知道。

### 幻觉

模型可能把不存在的答案说得很像真的。

#### 生活例子

你问一个不存在的人名，它也可能编出履历。

### 缺私有知识

公司内部流程、个人笔记、客户信息，它训练时没见过。

## RAG 怎么解决

RAG 会先查资料，再组织答案。
"""

NESTED_SECTION_TITLE = "大模型虽然聪明，但也不是万能的。首先，它的知识有保质期，其次它会编故事，最后它看不到你的私密数据"
NESTED_SECTION_CONTENT = NESTED_MARKDOWN_NOTE.split("\n## 大模型虽然聪明", 1)[1].split("\n## RAG 怎么解决", 1)[0]
NESTED_SECTION_CONTENT = f"## 大模型虽然聪明{NESTED_SECTION_CONTENT}".strip()


NUMBERED_MARKDOWN_NOTE = """## Redis 学习笔记

正文内容。

### 七、最后几点建议

1. **缓存一致性**：更新数据库后，要同步删除或更新缓存。
2. **安全配置**：生产环境请设置密码（`requirepass`），并限制 `FLUSHALL`、`KEYS`、`CONFIG` 等危险命令。
3. **别把 Redis 当万能药**：需要强事务和复杂查询时，关系型数据库通常更合适。

## 八、总结

后文保留。
"""


NUMBERED_RENDERED_SELECTION = """七、最后几点建议
缓存一致性：更新数据库后，要同步删除或更新缓存。
安全配置：生产环境请设置密码（requirepass），并限制 FLUSHALL、KEYS、CONFIG 等危险命令。
别把 Redis 当万能药：需要强事务和复杂查询时，关系型数据库通常更合适。"""


class NoteEditMatchingTest(unittest.TestCase):
    def test_edit_revision_captures_current_preview_snapshot(self) -> None:
        preview = SimpleNamespace(
            id="edit-1",
            user_id="user-1",
            new_content="修改后的正文",
            instruction="写得更清楚",
            change_summary=["补充解释"],
        )

        revision = _make_edit_revision(preview, source="revision")

        self.assertEqual(revision.edit_id, "edit-1")
        self.assertEqual(revision.user_id, "user-1")
        self.assertEqual(revision.new_content, "修改后的正文")
        self.assertEqual(revision.change_summary, ["补充解释"])
        self.assertEqual(revision.source, "revision")

    def test_rendered_selection_resolves_to_markdown_source(self) -> None:
        resolved = _resolve_selected_content(MARKDOWN_NOTE, RENDERED_SELECTION)

        self.assertNotEqual(resolved, RENDERED_SELECTION)
        self.assertTrue(resolved.startswith('##  大模型的三个"硬伤"'))
        self.assertIn("1. 知识有截止日期", resolved)
        self.assertIn("3. 看不到你的私有数据", resolved)

    def test_legacy_rendered_selection_can_be_replaced_after_revision(self) -> None:
        result = _replace_once(MARKDOWN_NOTE, RENDERED_SELECTION, REVISED_CONTENT)

        self.assertIn(REVISED_CONTENT, result)
        self.assertIn("## 1\\. 为什么需要 RAG？", result)
        self.assertIn("## 2. RAG 的基本流程", result)
        self.assertNotIn('##  大模型的三个"硬伤"', result)

    def test_apply_preview_uses_latest_revised_content(self) -> None:
        note = SimpleNamespace(content=MARKDOWN_NOTE)
        preview = SimpleNamespace(
            target_type="selection",
            old_content=RENDERED_SELECTION,
            new_content=REVISED_CONTENT,
        )

        result = _apply_preview_content(note, preview)

        self.assertIn(REVISED_CONTENT, result)
        self.assertNotIn("知识时效性差 ——", result)

    def test_anchor_matching_covers_selection_missing_list_numbers(self) -> None:
        span = _find_anchor_span(MARKDOWN_NOTE, RENDERED_SELECTION)

        self.assertIsNotNone(span)
        assert span is not None
        start, end = span
        matched = MARKDOWN_NOTE[start:end]
        self.assertTrue(matched.startswith('##  大模型的三个"硬伤"'))
        self.assertIn("1. 知识有截止日期", matched)
        self.assertIn("3. 看不到你的私有数据", matched)

    def test_missing_target_still_fails_safely(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            _replace_once(MARKDOWN_NOTE, "完全不存在的一段目标原文", REVISED_CONTENT)

        self.assertEqual(ctx.exception.status_code, 409)

    def test_short_rendered_selection_with_bold_list_items_can_be_replaced(self) -> None:
        replacement = "大模型的三大硬伤：知识过时、容易幻觉、缺少私有知识。RAG 通过检索补足这些短板。"

        resolved = _resolve_selected_content(SHORT_MARKDOWN_NOTE, SHORT_RENDERED_SELECTION)
        result = _replace_once(SHORT_MARKDOWN_NOTE, SHORT_RENDERED_SELECTION, replacement)

        self.assertTrue(resolved.startswith("## 大模型的三个缺陷"))
        self.assertIn("**知识过时**", resolved)
        self.assertIn(replacement, result)
        self.assertIn("前文保留。", result)
        self.assertIn("后文保留。", result)
        self.assertNotIn("**缺私有知识**", result)

    def test_rendered_selection_without_ordered_list_numbers_can_be_replaced(self) -> None:
        replacement = "### 七、最后几点建议\n\n这一部分已按要求改写。"

        resolved = _resolve_selected_content(NUMBERED_MARKDOWN_NOTE, NUMBERED_RENDERED_SELECTION)
        result = _replace_once(NUMBERED_MARKDOWN_NOTE, NUMBERED_RENDERED_SELECTION, replacement)

        self.assertTrue(resolved.startswith("### 七、最后几点建议"))
        self.assertIn("1. **缓存一致性**", resolved)
        self.assertIn("3. **别把 Redis 当万能药**", resolved)
        self.assertIn(replacement, result)
        self.assertIn("## 八、总结", result)
        self.assertNotIn("1. **缓存一致性**", result)

    def test_section_intent_expands_selected_title_to_whole_section(self) -> None:
        note = SimpleNamespace(id="note-1", content=SHORT_MARKDOWN_NOTE)
        section = SimpleNamespace(
            id="section-1",
            title="大模型的三个缺陷让 RAG 不可或缺：",
            content=SHORT_SECTION_CONTENT,
            sort_order=1,
        )
        payload = EditPreviewPayload(
            noteId="note-1",
            targetType="section",
            selectedText="大模型的三个缺陷让 RAG 不可或缺：",
            instruction="把这一小节的内容重新写",
        )

        with patch("app.routers.edits._get_sections", new=AsyncMock(return_value=[section])):
            target_type, section_id, old_content, label = asyncio.run(
                _resolve_target(None, "user-1", note, payload)
            )

        self.assertEqual(target_type, "section")
        self.assertEqual(section_id, "section-1")
        self.assertEqual(label, "小节：大模型的三个缺陷让 RAG 不可或缺：")
        self.assertEqual(old_content, SHORT_SECTION_CONTENT)

    def test_section_intent_expands_selected_body_fragment_to_whole_section(self) -> None:
        note = SimpleNamespace(id="note-1", content=SHORT_MARKDOWN_NOTE)
        section = SimpleNamespace(
            id="section-1",
            title="大模型的三个缺陷让 RAG 不可或缺：",
            content=SHORT_SECTION_CONTENT,
            sort_order=1,
        )
        payload = EditPreviewPayload(
            noteId="note-1",
            targetType="section",
            selectedText="幻觉：模型按概率生成，无事实检查，易给出错误答案。",
            instruction="把这一小节的内容重新写",
        )

        with patch("app.routers.edits._get_sections", new=AsyncMock(return_value=[section])):
            target_type, section_id, old_content, label = asyncio.run(
                _resolve_target(None, "user-1", note, payload)
            )

        self.assertEqual(target_type, "section")
        self.assertEqual(section_id, "section-1")
        self.assertEqual(label, "小节：大模型的三个缺陷让 RAG 不可或缺：")
        self.assertEqual(old_content, SHORT_SECTION_CONTENT)

    def test_section_intent_falls_back_to_markdown_when_index_is_stale(self) -> None:
        note = SimpleNamespace(id="note-1", content=SHORT_MARKDOWN_NOTE)
        payload = EditPreviewPayload(
            noteId="note-1",
            targetType="section",
            selectedText="大模型的三个缺陷让 RAG 不可或缺：",
            instruction="把这一小节的内容重新写",
        )

        with patch("app.routers.edits._get_sections", new=AsyncMock(return_value=[])):
            target_type, section_id, old_content, label = asyncio.run(
                _resolve_target(None, "user-1", note, payload)
            )

        self.assertEqual(target_type, "section")
        self.assertIsNone(section_id)
        self.assertEqual(label, "小节：大模型的三个缺陷让 RAG 不可或缺：")
        self.assertEqual(old_content, SHORT_SECTION_CONTENT)

    def test_section_intent_uses_current_note_when_index_content_is_stale(self) -> None:
        note = SimpleNamespace(id="note-1", content=SHORT_MARKDOWN_NOTE)
        stale_section = SimpleNamespace(
            id="section-1",
            title="大模型的三个缺陷让 RAG 不可或缺：",
            content="## 大模型的三个缺陷让 RAG 不可或缺：\n\n旧的小节内容，当前笔记里已经没有了。",
            sort_order=1,
        )
        payload = EditPreviewPayload(
            noteId="note-1",
            targetType="section",
            selectedText="大模型的三个缺陷让 RAG 不可或缺：",
            instruction="把这一小节的内容重新写",
        )

        with patch("app.routers.edits._get_sections", new=AsyncMock(return_value=[stale_section])):
            target_type, section_id, old_content, label = asyncio.run(
                _resolve_target(None, "user-1", note, payload)
            )

        self.assertEqual(target_type, "section")
        self.assertEqual(section_id, "section-1")
        self.assertEqual(label, "小节：大模型的三个缺陷让 RAG 不可或缺：")
        self.assertEqual(old_content, SHORT_SECTION_CONTENT)

    def test_section_intent_from_selected_long_title_includes_child_headings(self) -> None:
        note = SimpleNamespace(id="note-1", content=NESTED_MARKDOWN_NOTE)
        payload = EditPreviewPayload(
            noteId="note-1",
            targetType=None,
            selectedText=NESTED_SECTION_TITLE,
            instruction="重新写这一节",
        )

        with patch("app.routers.edits._get_sections", new=AsyncMock(return_value=[])):
            target_type, section_id, old_content, label = asyncio.run(
                _resolve_target(None, "user-1", note, payload)
            )

        self.assertEqual(target_type, "section")
        self.assertIsNone(section_id)
        self.assertEqual(label, f"小节：{NESTED_SECTION_TITLE}")
        self.assertEqual(old_content, NESTED_SECTION_CONTENT)
        self.assertIn("### 知识过时", old_content)
        self.assertIn("#### 生活例子", old_content)
        self.assertIn("### 缺私有知识", old_content)
        self.assertNotIn("## RAG 怎么解决", old_content)

    def test_section_intent_from_instruction_title_includes_child_headings(self) -> None:
        note = SimpleNamespace(id="note-1", content=NESTED_MARKDOWN_NOTE)
        payload = EditPreviewPayload(
            noteId="note-1",
            targetType=None,
            selectedText="",
            instruction=f"请把《{NESTED_SECTION_TITLE}》这一节重新写",
        )

        with patch("app.routers.edits._get_sections", new=AsyncMock(return_value=[])):
            target_type, section_id, old_content, label = asyncio.run(
                _resolve_target(None, "user-1", note, payload)
            )

        self.assertEqual(target_type, "section")
        self.assertIsNone(section_id)
        self.assertEqual(label, f"小节：{NESTED_SECTION_TITLE}")
        self.assertEqual(old_content, NESTED_SECTION_CONTENT)
        self.assertIn("### 幻觉", old_content)
        self.assertNotIn("## RAG 怎么解决", old_content)


if __name__ == "__main__":
    unittest.main()
