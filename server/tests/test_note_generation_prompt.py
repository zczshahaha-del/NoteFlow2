import unittest

from app.services.prompts import NoteGenerateRequest, build_note_generate_prompt


class NoteGenerationPromptTests(unittest.TestCase):
    def test_outline_prompt_only_generates_top_level_toc(self):
        prompt = build_note_generate_prompt(
            NoteGenerateRequest(
                mode="outline",
                topic="AI 应用开发",
                noteType="智能笔记",
                noteFormat="AI 自动组织结构",
                writingTone="根据用户需求自动匹配",
            )
        )

        self.assertIn("Create only the top-level table of contents", prompt)
        self.assertIn("silently infer the user's real learning goal", prompt)
        self.assertIn("not only from isolated keywords", prompt)
        self.assertIn("应用开发 / application development / 做应用 / 项目", prompt)
        self.assertIn("LLM application engineering milestones", prompt)
        self.assertIn("unless the user asks for a narrower topic", prompt)
        self.assertIn("RAG", prompt)
        self.assertIn("tool/function calling", prompt)
        self.assertIn("memory", prompt)
        self.assertIn("LangChain/LlamaIndex", prompt)
        self.assertIn("agents", prompt)
        self.assertIn("tracing/observability", prompt)
        self.assertIn("do not drift into a machine-learning training syllabus", prompt)
        self.assertIn("Output format only", prompt)
        self.assertIn("output only main sections", prompt)
        self.assertIn("Each main section should be one short line", prompt)
        self.assertIn("compact, coherent table of contents", prompt)
        self.assertIn("Avoid long grab-bag lists", prompt)
        self.assertIn("merge them into one stronger main section", prompt)
        self.assertIn("Do not output subsections", prompt)
        self.assertIn("body text in this outline stage", prompt)
        self.assertNotIn("section count, order, and depth", prompt)
        self.assertNotIn("tools/workflows", prompt)
        self.assertNotIn("not PPT labels", prompt)
        self.assertNotIn("字段名", prompt)
        self.assertNotIn("先把连接跑起来", prompt)
        self.assertNotIn("这个坑到底炸在哪", prompt)
        self.assertNotIn("Usually use 5-7", prompt)
        self.assertNotIn("核心心智模型", prompt)
        self.assertNotIn("mental model", prompt)
        self.assertNotIn("minimal runnable example", prompt)
        self.assertNotIn("enterprise lifecycle", prompt)

    def test_section_prompt_does_not_force_style_taste(self):
        prompt = build_note_generate_prompt(
            NoteGenerateRequest(
                mode="section",
                topic="AI 应用开发",
                outlinePlan="## 1. 最小 AI 应用闭环\n- 输入、模型、工具、输出",
            )
        )

        self.assertIn("best fits the user's request", prompt)
        self.assertNotIn("Avoid stiff methodology language", prompt)
        self.assertNotIn("concrete examples", prompt)
        self.assertNotIn("practical caveats", prompt)


if __name__ == "__main__":
    unittest.main()
