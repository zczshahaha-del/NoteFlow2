import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.services.heading_numbers import (
    unnumber_generated_headings, unnumber_title, number_markdown_headings,
    markdown_headings, number_generated_section, section_number_path,
    numbering_style_from_request, draft_numbering_style,
)
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


class MaterializedHeadingNumbersTest(unittest.TestCase):
    def test_whole_document_numbers_are_real_text_and_idempotent(self):
        source = "# Docker\n\n## 一、基础\n\n### 7.1 定义\n正文不变。\n\n#### （二）示例\n\n## 9. 运行\n"
        expected = "# Docker\n\n## 1. 基础\n\n### 1.1 定义\n正文不变。\n\n#### 1.1.1 示例\n\n## 2. 运行\n"
        self.assertEqual(number_markdown_headings(source, "Docker"), expected)
        self.assertEqual(number_markdown_headings(expected, "Docker"), expected)

    def test_numbered_main_title_is_cleaned_not_counted(self):
        self.assertEqual(number_markdown_headings("# 一、笔记\n\n## 章节", "笔记"), "# 笔记\n\n## 1. 章节")

    def test_crlf_code_body_and_closing_hashes_are_preserved(self):
        source = "## **一、基础** ##\r\n\r\n1. 正文列表\r\n\r\n```md\r\n## 7. 代码中的标题\r\n```\r\n\r\n    ## 缩进代码\r\n\r\n~~~md\r\n# 样例\r\n~~~\r\n\r\n### `1.5版本变化`\r\n"
        expected = source.replace("**一、基础**", "1. **基础**").replace("### `1.5版本变化`", "### 1.1 `1.5版本变化`")
        self.assertEqual(number_markdown_headings(source), expected)

    def test_setext_quotes_and_nested_headings_use_parser_positions(self):
        source = "笔记\n====\n\n基础\n----\n\n> ### 一、引用中的标题\n\n- #### 第三章：列表中的标题\n"
        expected = "笔记\n====\n\n1. 基础\n----\n\n> ### 1.1 引用中的标题\n\n- #### 1.1.1 列表中的标题\n"
        self.assertEqual(number_markdown_headings(source, "笔记"), expected)

    def test_meaningful_digits_and_inline_formatting_survive(self):
        source = "## 2026 年总结\n### 3D 图形\n### 1.5版本变化\n### [一、链接](https://example.invalid)\n### **（二）粗体**\n### `3. 代码文字`\n"
        self.assertEqual(number_markdown_headings(source), "## 1. 2026 年总结\n### 1.1 3D 图形\n### 1.2 1.5版本变化\n### 1.3 [链接](https://example.invalid)\n### 1.4 **粗体**\n### 1.5 `代码文字`\n")

    def test_unsupported_prefix_mapping_fails_before_returning_partial_result(self):
        for source in ("## **一**、标题", "## [一、](https://example.invalid) 标题", "多行\n标题\n---\n"):
            with self.assertRaises(ValueError):
                number_markdown_headings(source)

    def test_chinese_is_explicit_only_and_descendants_stay_decimal(self):
        self.assertEqual(numbering_style_from_request("讲解第一章和中文数据"), "decimal")
        self.assertEqual(numbering_style_from_request("一级标题使用中文编号"), "chinese")
        self.assertEqual(numbering_style_from_request("不要使用中文编号"), "decimal")
        self.assertEqual(numbering_style_from_request("一级标题使用中文编号。章节改为阿拉伯数字"), "decimal")
        draft = SimpleNamespace(extra_request="", draft_config={"generationBrief": {"requirements": "一级标题使用中文编号"}, "bodyInstruction": "一级标题改为阿拉伯数字"})
        self.assertEqual(draft_numbering_style(draft), "decimal")
        self.assertEqual(number_markdown_headings("## 入门\n### 准备\n## 进阶", style="chinese"), "## 一、 入门\n### 1.1 准备\n## 二、 进阶")

    def test_individual_section_uses_global_position_and_ignores_deleted_sibling(self):
        draft = SimpleNamespace(title="笔记", draft_config={}, extra_request="")
        sections = [SimpleNamespace(id=str(i), level=2, sort_order=i, deleted_at=None, title=f"章节{i}") for i in range(4)]
        sections[1].deleted_at = "deleted"
        self.assertEqual(section_number_path(sections[3], sections), (3,))
        source = "# 笔记\n\n## 9. 章节3\n\n### 一、子节\n代码正文"
        result = number_generated_section(draft, sections[3], sections, source)
        self.assertEqual(result, "## 3. 章节3\n\n### 3.1 子节\n代码正文")
        self.assertEqual(number_generated_section(draft, sections[3], sections, result), result)

    def test_nested_section_and_missing_model_heading(self):
        draft = SimpleNamespace(title="笔记", draft_config={}, extra_request="")
        sections = [SimpleNamespace(id="a", level=2, sort_order=0, deleted_at=None, title="父节"), SimpleNamespace(id="b", level=3, sort_order=1, deleted_at=None, title="子节")]
        self.assertEqual(number_generated_section(draft, sections[1], sections, "正文"), "### 1.1 子节\n\n正文")
        self.assertEqual(number_generated_section(draft, sections[0], sections, "笔记\n====\n\n## 父节"), "## 1. 父节")
        self.assertEqual(number_generated_section(draft, sections[0], sections, "# 父节\n\n## 子标题\n\n```md\n# 示例不可改\n```"), "## 1. 父节\n\n### 1.1 子标题\n\n```md\n# 示例不可改\n```")
        self.assertEqual(number_generated_section(draft, sections[0], sections, "父节\n====\n\n## 子标题"), "## 1. 父节\n\n\n### 1.1 子标题")

    def test_parser_does_not_treat_html_or_code_as_structure(self):
        source = "<div>\n## HTML 区域\n</div>\n\n```\n# 代码\n```\n\n## 正文标题"
        self.assertEqual(len(markdown_headings(source)), 1)
        self.assertEqual(number_markdown_headings(source), source.replace("## 正文标题", "## 1. 正文标题"))
