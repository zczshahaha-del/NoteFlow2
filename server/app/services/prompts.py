from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


def _first_non_empty(value: str | None, fallback: str) -> str:
    return (value or "").strip() or fallback


def _trim_text(value: str, max_runes: int) -> str:
    text = (value or "").strip()
    if len(text) <= max_runes:
        return text
    return text[-max_runes:]


def _outline_block(outline: str | None) -> str:
    if not outline or not outline.strip():
        return ""
    return "Original outline plan:\n" + outline.strip()


@dataclass
class NoteGenerateRequest:
    mode: str = "generate"
    topic: str = ""
    noteType: str = ""
    writingTone: str = ""
    noteFormat: str = ""
    headingLevel: str = ""
    includeCode: bool = False
    includeExercises: bool = False
    extraRequest: str = ""
    memoryContext: str = ""
    markdown: str = ""
    outlinePlan: str = ""
    maxTokens: int = 0
    temperature: Optional[float] = None


def build_note_generate_prompt(req: NoteGenerateRequest) -> str:
    topic = _first_non_empty(req.topic, "Untitled knowledge point")
    note_type = _first_non_empty(req.noteType, "study note")
    writing_tone = _first_non_empty(req.writingTone, "plain and easy to understand")
    note_format = _first_non_empty(req.noteFormat, "detailed tutorial")
    heading_level = _first_non_empty(req.headingLevel, "H2 / H3 / H4")

    code_rule = (
        "Include necessary code examples, label code block languages, and explain applicable scenarios and common mistakes."
        if req.includeCode
        else "Do not add code examples unless they are necessary."
    )
    exercise_rule = (
        "Include practice questions with answers and explanations at the end."
        if req.includeExercises
        else "Do not add practice questions."
    )
    extra_rule = ""
    if req.extraRequest and req.extraRequest.strip():
        extra_rule = "\nAdditional user requirement: " + req.extraRequest.strip()
    memory_rule = ""
    if req.memoryContext and req.memoryContext.strip():
        memory_rule = (
            "\nLong-term user memory, only as default preference. "
            "If the current user request conflicts with memory, follow the current request:\n"
            + req.memoryContext.strip()
        )

    base_info = (
        f"Topic: {topic}\n"
        f"Note type: {note_type}\n"
        f"Tone: {writing_tone}\n"
        f"Format: {note_format}\n"
        f"Heading level: {heading_level}\n"
        f"{code_rule}\n"
        f"{exercise_rule}{extra_rule}{memory_rule}"
    )

    mode = (req.mode or "").strip()

    if mode == "outline":
        outline_info = (
            f"Topic: {topic}\n"
            f"{extra_rule.strip()}\n"
            f"{memory_rule.strip()}"
        ).strip()
        final_note_expectation = ""
        if req.includeCode:
            final_note_expectation += "\nWhen the note is expanded later, it should include examples and code where useful."
        if req.includeExercises:
            final_note_expectation += "\nWhen the note is expanded later, it should include exercises where useful."
        return (
            f"Return Simplified Chinese Markdown.\n"
            f"Create only the top-level table of contents for the user's note request.\n"
            f"Before writing, silently infer the user's real learning goal from the full request, not only from isolated keywords. "
            f"If a topic can mean several things, choose the interpretation that best matches the user's wording. "
            f"For example, wording like “应用开发 / application development / 做应用 / 项目” normally means building usable software with existing capabilities, not a course about training models from scratch, unless the user explicitly asks for model training. "
            f"For a broad modern AI application development note, cover the main LLM application engineering milestones unless the user asks for a narrower topic: model/API calling, prompts and context, RAG, memory, tool/function calling, orchestration frameworks such as LangChain/LlamaIndex, agents, tracing/observability, evaluation, and deployment. You may merge related milestones into stronger main sections, but do not drift into a machine-learning training syllabus.\n\n"
            f"{outline_info}{final_note_expectation}\n\n"
            f"Output format only:\n"
            f"- Output only Markdown table-of-contents text. Do not wrap it in a code block.\n"
            f"- Include one # title.\n"
            f"- After the # title, output only main sections as H2 headings or a single numbered list.\n"
            f"- Each main section should be one short line.\n"
            f"- Prefer a compact, coherent table of contents. Avoid long grab-bag lists of loosely related mini projects.\n"
            f"- If two sections belong to the same learning step, merge them into one stronger main section.\n"
            f"- Do not output subsections, child bullets, explanations, examples, code, summaries, or body text in this outline stage."
        )

    if mode == "fromOutline":
        return (
            f"Return Simplified Chinese Markdown.\n"
            f"You are performing stage 2 of two-stage note generation: expand the outline into a complete note.\n\n"
            f"{base_info}\n\n"
            f"Outline plan:\n"
            f"{req.outlinePlan.strip()}\n\n"
            f"Expansion requirements:\n"
            f"1. Return complete Markdown body only. Do not wrap it in a code block.\n"
            f"2. Preserve the outline's heading hierarchy, numbering, and parent-child relationships.\n"
            f"3. Do not print a separate table of contents before the body.\n"
            f"4. Expand every core section with background, concepts, mechanisms, scenarios, examples, boundaries, and common pitfalls.\n"
            f"5. Keep headings concise. If an outline heading is a long explanatory sentence, shorten it into a clear label and move the details into the body.\n"
            f"6. If the topic is broad, prioritize depth in the core modules."
        )

    if mode == "section":
        return (
            f"Return Simplified Chinese Markdown.\n"
            f"You are generating one section of a larger draft note, not the entire note.\n\n"
            f"{base_info}\n\n"
            f"Current section outline:\n"
            f"{req.outlinePlan.strip()}\n\n"
            f"Section generation requirements:\n"
            f"1. Return only this section's Markdown content. Do not wrap it in a code block.\n"
            f"2. Do not output the note's main title, document title, table of contents, or any extra parent heading.\n"
            f"3. Start with the section heading from the outline, then expand only this section.\n"
            f"4. Do not repeat the user's raw topic as a standalone heading unless it is exactly the current section heading.\n"
            f"5. Keep the section heading concise. If the outline heading is a long explanatory sentence, shorten it into a clear label and move details into the body.\n"
            f"6. Write the section in the way that best fits the user's request and the current outline."
        )

    if mode == "continue":
        return (
            f"Return Simplified Chinese Markdown.\n"
            f"The previous note was truncated by output length. Continue after the existing content. "
            f"Return only the continuation. Do not repeat existing content. Do not wrap it in a code block.\n\n"
            f"{base_info}\n\n"
            f"{_outline_block(req.outlinePlan)}\n\n"
            f"Continuation rules:\n"
            f"1. Do not output the # main title again.\n"
            f"2. If the tail ends mid-sentence, mid-list item, mid-code block, or mid-heading, continue directly.\n"
            f"3. Keep the existing heading numbering and hierarchy.\n"
            f"4. Keep new headings concise; do not turn explanatory paragraphs into headings.\n"
            f'5. Do not say "continue" or "below is the continuation".\n\n'
            f"Existing content tail:\n"
            f"{_trim_text(req.markdown, 8000)}"
        )

    if mode == "expand":
        return (
            f"Return Simplified Chinese Markdown.\n"
            f"The note below is too short. Expand it into a more complete version. "
            f"Return the full expanded Markdown note. Do not wrap it in a code block.\n\n"
            f"{base_info}\n\n"
            f"Expansion rules:\n"
            f"1. Keep correct and useful original content.\n"
            f"2. Expand weak sections with background, mechanisms, steps, examples, boundaries, pitfalls, and applicable/non-applicable scenarios.\n"
            f'3. Integrate additions into the full structure instead of appending a loose "extra notes" section.\n'
            f"4. Keep headings concise. If an existing heading is a long explanatory sentence, shorten it and move the details into body text.\n"
            f"5. If the topic is small, explain the key points deeply rather than adding meaningless headings.\n\n"
            f"Original Markdown:\n"
            f"{req.markdown.strip()}"
        )

    if mode == "revise":
        direction = _first_non_empty(req.extraRequest, "improve quality and completeness")
        return (
            f"Return Simplified Chinese Markdown.\n"
            f"Revise the Markdown note below. Return the full revised note. Do not wrap it in a code block.\n\n"
            f"{base_info}\n\n"
            f"Revision direction: {direction}\n\n"
            f"Revision rules:\n"
            f"1. The user's revision direction has the highest priority.\n"
            f"2. If the original is too short, expand it into a complete version.\n"
            f"3. Preserve correct content and fix weak structure, missing explanation, missing examples, and unclear wording.\n"
            f"4. Keep headings concise. If a heading is a long explanatory sentence, shorten it and move details into body text.\n\n"
            f"Original Markdown:\n"
            f"{req.markdown.strip()}"
        )

    # default "generate"
    return (
        f"Return Simplified Chinese Markdown.\n"
        f"Generate a Markdown note according to the requirements below. "
        f"Return only the Markdown body. Do not wrap it in a code block.\n\n"
        f"{base_info}\n\n"
        f"Writing requirements:\n"
        f"1. The content must be substantial and complete, not a shallow outline.\n"
        f'2. Use exactly one # main title. Major sections should use numbered H2 headings such as "## 1. Basics".\n'
        f"3. Keep headings short and structural: headings should be concise labels, not full explanatory sentences. Put explanation, examples, and caveats in body text under the heading.\n"
        f"4. Explain background, concepts, mechanisms, scenarios, examples, boundaries, and common pitfalls for each core point.\n"
        f"5. If the topic is broad, make the core modules solid instead of ending early.\n"
        f"6. The user's additional requirement has the highest priority."
    )
