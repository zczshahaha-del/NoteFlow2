from __future__ import annotations

import json
import re
from dataclasses import dataclass

from app.services.ai import ChatRequest, stream_chat


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
        f"\n长期记忆（只作为默认偏好；用户本次明确要求优先）：\n{memory_context.strip()}\n"
        if memory_context and memory_context.strip()
        else ""
    )
    prompt = f"""你正在为 NoteFlow 生成正式笔记的 AI 修改预览。

重要规则：
1. 只能修改“当前修改范围”，不要扩展到其他章节。
2. 不要直接写回正式笔记，只返回预览结果。
3. 保持 Markdown 格式、标题层级和原文风格。
4. 如果 targetType 是 selection，返回修改后的选区内容，不要添加额外标题。
5. 如果 targetType 是 section，必须重写并返回整个小节范围；范围里若包含子标题，也要连同子标题和正文一起处理。可以保留或优化小节标题，但不要只输出标题、单段摘要或遗漏子标题内容。
6. 如果用户要求删除，newContent 可以为空字符串。
7. 只返回 JSON，不要包裹代码块，不要输出解释文字。

当前笔记标题：
{note_title}

targetType：
{target_type}

是否保持原风格：
{str(keep_style).lower()}

用户修改要求：
{instruction}
{memory_block}

相邻上下文：
{neighbor_context or "无"}

当前修改范围：
{target_content}

返回 JSON 格式：
{{
  "newContent": "修改后的 Markdown 内容",
  "changeSummary": ["本次修改摘要 1", "本次修改摘要 2"]
}}
"""
    raw = await _call_ai(prompt)
    parsed = _extract_json(raw)
    if parsed:
        new_content = str(parsed.get("newContent") or "").strip()
        raw_summary = parsed.get("changeSummary")
        if isinstance(raw_summary, list):
            summary = [str(item).strip() for item in raw_summary if str(item).strip()]
        else:
            summary = _fallback_summary(instruction)
        return EditGenerationResult(new_content=new_content, change_summary=summary)

    return EditGenerationResult(
        new_content=_strip_code_fence(raw),
        change_summary=_fallback_summary(instruction),
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
        f"\n长期记忆（只作为默认偏好；用户本次明确要求优先）：\n{memory_context.strip()}\n"
        if memory_context and memory_context.strip()
        else ""
    )
    prompt = f"""你正在继续调整一个 NoteFlow AI 修改预览。

重要规则：
1. 基于“当前预览内容”继续调整，不要重新从整篇笔记开始。
2. 仍然只修改目标范围，不要输出整篇文章主标题。
3. 保持 Markdown 格式。
4. 如果 targetType 是 section，继续调整整个小节范围；范围里若包含子标题，也要连同子标题和正文一起处理。可以保留或优化小节标题，但不要只输出标题、单段摘要或遗漏子标题内容。
5. 只返回 JSON，不要包裹代码块，不要输出解释文字。

当前笔记标题：
{note_title}

targetType：
{target_type}

原始内容：
{original_content}

当前预览内容：
{current_preview}

用户继续调整要求：
{instruction}
{memory_block}

返回 JSON 格式：
{{
  "newContent": "再次调整后的 Markdown 内容",
  "changeSummary": ["本次调整摘要 1", "本次调整摘要 2"]
}}
"""
    raw = await _call_ai(prompt)
    parsed = _extract_json(raw)
    if parsed:
        new_content = str(parsed.get("newContent") or "").strip()
        raw_summary = parsed.get("changeSummary")
        if isinstance(raw_summary, list):
            summary = [str(item).strip() for item in raw_summary if str(item).strip()]
        else:
            summary = _fallback_summary(instruction)
        return EditGenerationResult(new_content=new_content, change_summary=summary)

    return EditGenerationResult(
        new_content=_strip_code_fence(raw),
        change_summary=_fallback_summary(instruction),
    )
