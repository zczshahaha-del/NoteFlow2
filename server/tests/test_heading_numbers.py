import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.services.heading_numbers import unnumber_generated_headings, unnumber_title
from app.routers.drafts import _clean_section_title, _parse_outline_sections
from app.services import draft_worker


class HeadingNumbersTest(unittest.TestCase):
    def test_new_outline_titles_and_provenance_are_unnumbered(self):
        sections = _parse_outline_sections("# Docker\n\n## 一、Docker 是什么\n\n## （二）安装\n\n## 3. 运行")
        self.assertEqual([item.title for item in sections], ["Docker 是什么", "安装", "运行"])
        self.assertEqual([item.outlineText for item in sections], ["## Docker 是什么", "## 安装", "## 运行"])

    def test_meaningful_numbers_and_words_survive(self):
        for title in ("2026 年总结", "3D 图形", "1.5版本变化", "一体化设计", "二叉树", "（Docker）基础"):
            self.assertEqual(_clean_section_title(title), title)
        self.assertEqual(unnumber_title("1. 一、Docker"), "Docker")
        self.assertEqual(unnumber_title("第十二章：进阶"), "进阶")

    def test_generated_headings_only_not_code_or_body(self):
        source = "## 一、Docker\r\n\r\n一句话解释。\r\n\r\n### 1.1 定义\r\n\r\n```md\r\n## 一、示例不可改\r\n```\r\n\r\n2026 年总结"
        self.assertEqual(unnumber_generated_headings(source), source.replace("## 一、Docker", "## Docker").replace("### 1.1 定义", "### 定义"))


class GeneratedSectionNumbersTest(unittest.IsolatedAsyncioTestCase):
    async def test_reviewed_model_response_cannot_reintroduce_chapter_numbers(self):
        draft = SimpleNamespace(topic="Docker", title="Docker", draft_config={}, extra_request="通俗", note_type="笔记", writing_tone="自然", note_format="Markdown", heading_level="二级", include_code=True, include_exercises=False)
        section = SimpleNamespace(level=2, title="Docker 是什么", outline_text="## Docker 是什么")
        model = AsyncMock(side_effect=["## 1. Docker", "## 一、Docker\n\n### （一）定义\n\n```md\n## 1. 示例\n```"])
        with patch.object(draft_worker, "_complete_with_retry", model):
            content = await draft_worker._generate_section(draft, section)
        self.assertEqual(content, "## Docker\n\n### 定义\n\n```md\n## 1. 示例\n```")
