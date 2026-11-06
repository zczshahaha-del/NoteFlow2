from __future__ import annotations

import json
import re
from dataclasses import dataclass

from app.services.prompt_templates import render_prompt
from app.services.ai import ChatRequest, stream_chat
from app.services.edit_scope import requests_note, requests_section, requests_rewrite


class EditGenerationError(ValueError):
    pass


@dataclass
class EditGenerationResult:
    new_content: str
    change_summary: list[str]


def _strip_code_fence(value: str) -> str:
    text = value.strip()
    match = re.match(r"^```(?:json|markdown|md)?\s*(.*?)\s*```$", text, flags=re.S)
    return match.group(1).strip() if match else text


def _extract_json(value: str) -> dict | None:
    text = _strip_code_fence(value)
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        try:
            parsed = json.loads(text[start : end + 1])
            return parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            return None
    return None


async def _call_ai(prompt: str, max_tokens: int = 9000) -> str:
    chunks: list[str] = []
    async for chunk in stream_chat(
        ChatRequest(
            question=prompt,
            maxTokens=max_tokens,
            temperature=0.45,
        )
    ):
        delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content")
        if delta:
            chunks.append(delta)
    return "".join(chunks).strip()


def _fallback_summary(instruction: str) -> list[str]:
    cleaned = re.sub(r"\s+", " ", instruction.strip())
    return [f"根据要求生成修改预览：{cleaned[:80] or '调整内容'}"]


def _allow_replacement(target_type: str, instruction: str) -> bool:
    return target_type in {"selection", "insert"} or (
        requests_rewrite(instruction)
        and (requests_note(instruction) or requests_section(instruction))
        and not re.search(r"开头|结尾|第[一二三四五六七八九十\d]+段|其中|只改|仅改", instruction)
    )


def _read_edit_result(raw: str, source: str, instruction: str, allow_replacement: bool,
                      replacement_only: bool = False) -> EditGenerationResult:
    parsed = _extract_json(raw)
    if not parsed:
        raise EditGenerationError("AI 没有返回有效的修改结果，请重试；原文和当前修改稿均已保留。")
    patches = parsed.get("edits")
    if replacement_only:
        # The server already resolved the selected range. Do not ask the model
        # to locate it again, or let a redundant edits field override its text.
        if not isinstance(parsed.get("newContent"), str):
            raise EditGenerationError("AI 返回的改写格式不正确，未应用任何修改。请重试。")
        content = parsed["newContent"]
    elif isinstance(patches, list):
        if len(patches) > 128:
            raise EditGenerationError("本次改动过多，请分几次调整。")
        spans: list[tuple[int, int, str]] = []
        for item in patches:
            old = item.get("oldText") if isinstance(item, dict) else None
            new = item.get("newText") if isinstance(item, dict) else None
            if not isinstance(old, str) or not old or not isinstance(new, str) or source.count(old) != 1:
                raise EditGenerationError("AI 返回的修改片段与原文不一致，未应用任何修改。请重试。")
            start = source.index(old)
            spans.append((start, start + len(old), new))
        spans.sort(key=lambda span: span[0])
        if any(left[1] > right[0] for left, right in zip(spans, spans[1:])):
            raise EditGenerationError("AI 返回了相互重叠的改动，请重试；当前内容已保留。")
        content = source
        for start, end, replacement in reversed(spans):
            content = content[:start] + replacement + content[end:]
    elif allow_replacement and isinstance(parsed.get("newContent"), str):
        content = parsed["newContent"]
    else:
        raise EditGenerationError("AI 没有按局部修改要求返回结果，请重试；未用整段重写覆盖当前内容。")
    summary = parsed.get("changeSummary")
    return EditGenerationResult(content, [str(item).strip() for item in summary if str(item).strip()]
                                if isinstance(summary, list) else _fallback_summary(instruction))


def _output_contract(allow_replacement: bool) -> str:
    suffix = "notes/edit-replacement-contract" if allow_replacement else "notes/edit-patches-only"
    return render_prompt("notes/edit-output-contract") + render_prompt(suffix)


def _selection_contract() -> str:
    return render_prompt("notes/edit-selection-contract")


async def _generate_validated_result(prompt: str, source: str, instruction: str,
                                     allow_replacement: bool, replacement_only: bool = False) -> EditGenerationResult:
    for attempt in range(2):
        raw = await _call_ai(prompt)
        try:
            return _read_edit_result(raw, source, instruction, allow_replacement, replacement_only)
        except EditGenerationError as error:
            if attempt:
                raise
            # One bounded repair using the same source and scope. Never loosen
            # exact-match checks or switch a local chapter edit to full rewrite.
            prompt += render_prompt("notes/edit-repair", error=str(error))
    raise AssertionError("unreachable")


async def generate_edit_preview(
    *,
    note_title: str,
    target_type: str,
    target_content: str,
    instruction: str,
    neighbor_context: str = "",
    keep_style: bool = True,
    memory_context: str = "",
) -> EditGenerationResult:
    memory_block = (
        render_prompt("notes/edit-memory", memory=memory_context.strip())
        if memory_context and memory_context.strip()
        else ""
    )
    insert_only = target_type == "insert"
    output_contract = (
        render_prompt("notes/edit-insert-contract")
        if insert_only else _selection_contract() if target_type == "selection"
        else _output_contract(_allow_replacement(target_type, instruction))
    )
    prompt = render_prompt(
        "notes/rewrite",
        note_title=note_title,
        target_type=target_type,
        keep_style=str(keep_style).lower(),
        instruction=instruction,
        memory_block=memory_block,
        neighbor_context=neighbor_context or '无',
        target_content=target_content,
        output_contract=output_contract,
    )
    # Insertion stores only added text; apply appends it after the untouched
    # anchor. Feeding the anchor through replacements would duplicate it.
    return await _generate_validated_result(
        prompt, "" if insert_only else target_content, instruction,
        _allow_replacement(target_type, instruction), target_type in {"selection", "insert"},
    )


async def revise_edit_preview(
    *,
    note_title: str,
    target_type: str,
    original_content: str,
    current_preview: str,
    instruction: str,
    memory_context: str = "",
) -> EditGenerationResult:
    memory_block = (
        render_prompt("notes/edit-memory", memory=memory_context.strip())
        if memory_context and memory_context.strip()
        else ""
    )
    prompt = render_prompt(
        "notes/refine-preview",
        note_title=note_title,
        target_type=target_type,
        original_content=original_content,
        current_preview=current_preview,
        instruction=instruction,
        memory_block=memory_block,
        output_contract=(
            _selection_contract() if target_type == "selection"
            else _output_contract(_allow_replacement(target_type, instruction))
        ),
    )
    return await _generate_validated_result(
        prompt, current_preview, instruction, _allow_replacement(target_type, instruction),
        target_type == "selection",
    )
