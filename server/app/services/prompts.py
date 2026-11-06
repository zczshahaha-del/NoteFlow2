from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from app.services.prompt_templates import render_prompt


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
        render_prompt("notes/with-code")
        if req.includeCode
        else render_prompt("notes/default-code")
    )
    exercise_rule = (
        render_prompt("notes/with-exercises")
        if req.includeExercises
        else render_prompt("notes/default-exercises")
    )
    extra_rule = ""
    if req.extraRequest and req.extraRequest.strip():
        extra_rule = "\nAdditional user requirement: " + req.extraRequest.strip()
    memory_rule = ""
    if req.memoryContext and req.memoryContext.strip():
        memory_rule = (
            render_prompt("notes/memory-preference")
            + req.memoryContext.strip()
        )

    base_info = (
        render_prompt(
            "notes/generation-brief",
            topic=topic,
            note_type=note_type,
            writing_tone=writing_tone,
            note_format=note_format,
            heading_level=heading_level,
            code_rule=code_rule,
            exercise_rule=exercise_rule,
            extra_rule=extra_rule,
            memory_rule=memory_rule,
        )
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
            final_note_expectation += render_prompt("notes/outline-code")
        if req.includeExercises:
            final_note_expectation += render_prompt("notes/outline-exercises")
        return (
            render_prompt(
                "notes/outline",
                outline_info=outline_info,
                final_note_expectation=final_note_expectation,
            )
        )

    if mode == "fromOutline":
        return (
            render_prompt(
                "notes/expand-outline",
                base_info=base_info,
                outline=req.outlinePlan.strip(),
            )
        )

    if mode == "section":
        return (
            render_prompt("notes/section", base_info=base_info, outline=req.outlinePlan.strip())
        )

    if mode == "continue":
        return (
            render_prompt(
                "notes/continue",
                base_info=base_info,
                outline=_outline_block(req.outlinePlan),
                existing_tail=_trim_text(req.markdown, 8000),
            )
        )

    if mode == "expand":
        return (
            render_prompt("notes/expand", base_info=base_info, markdown=req.markdown.strip())
        )

    if mode == "revise":
        direction = _first_non_empty(req.extraRequest, "improve quality and completeness")
        return (
            render_prompt(
                "notes/revise",
                base_info=base_info,
                direction=direction,
                markdown=req.markdown.strip(),
            )
        )

    # default "generate"
    return (
        render_prompt("notes/generate", base_info=base_info)
    )
