from __future__ import annotations

import json
import re
from dataclasses import dataclass

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


def _read_edit_result(raw: str, source: str, instruction: str, allow_replacement: bool) -> EditGenerationResult:
    parsed = _extract_json(raw)
    if not parsed:
        raise EditGenerationError("AI 没有返回有效的修改结果，请重试；原文和当前修改稿均已保留。")
    patches = parsed.get("edits")
    if isinstance(patches, list):
        if len(patches) > 128:
            raise EditGenerationError("本次改动过多，请分几次调整。")
        spans: list[tuple[int, int, str]] = []
        for item in patches:
            old = item.get("oldText") if isinstance(item, dict) else None
            new = item.get("newText") if isinstance(item, dict) else None
            if not isinstance(old, str) or not old or not isinstance(new, str) or source.count(old) != 1:
                raise EditGenerationError("无法准确定位 AI 要修改的原文，请重试或缩小选区；当前内容已保留。")
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
    return """
默认返回局部替换项 edits，每项 oldText 必须逐字复制当前内容中唯一出现的连续原文（保留 Markdown 和空白），newText 是替换内容。
未提到的内容不要放进 edits；只要求扩写开头，就只替换开头，不能把整个小节当 oldText。
插入请复制插入点附近一小段唯一原文作为 oldText，并在 newText 中保留它及新增内容。
删除局部内容时 newText 为空。所有 oldText 均针对同一份输入，不能重叠。无需修改时 edits 为空数组。
格式：{"edits":[{"oldText":"精确原文","newText":"修改内容"}],"changeSummary":["具体修改了什么"]}
""" + ("""
本次范围允许整体重写（选区、明确整节/全文重写）或单纯插入时，也可返回：
{"newContent":"该范围的完整新内容","changeSummary":["具体修改了什么"]}
""" if allow_replacement else "\n本次只允许 edits，不要返回整段 newContent。")


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
    insert_only = target_type == "insert"
    output_contract = (
        '本次是插入：当前修改范围仅用于确定插入位置，不要重复输出这些原文。'
        '只返回新增内容：{"newContent":"要插入的新 Markdown","changeSummary":["新增了什么"]}'
        if insert_only else _output_contract(_allow_replacement(target_type, instruction))
    )
    prompt = f"""你正在为 NoteFlow 生成正式笔记的 AI 修改预览。

重要规则：
1. 只能修改“当前修改范围”，不要扩展到其他章节。
2. 不要直接写回正式笔记，只返回预览结果。
3. 保持 Markdown 格式、标题层级和原文风格。
4. 如果 targetType 是 selection，返回修改后的选区内容，不要添加额外标题。
5. 修改范围是允许操作的边界，不是要求重写全部。只修改用户要求涉及的内容，保留其他段落、代码和子标题；明确要求整节重写时才可重写完整小节。
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

只读参考上下文（不能作为修改目标）：
{neighbor_context or "无"}

当前修改范围：
{target_content}

{output_contract}
"""
    raw = await _call_ai(prompt)
    # Insertion stores only added text; apply appends it after the untouched
    # anchor. Feeding the anchor through replacements would duplicate it.
    return _read_edit_result(raw, "" if insert_only else target_content, instruction, _allow_replacement(target_type, instruction))


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
4. 仅调整本次要求涉及的内容。当前预览中已有的手动修改、之前添加的例子和其他段落默认保留；只有本次明确要求替换时才改动。
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

{_output_contract(_allow_replacement(target_type, instruction))}
"""
    raw = await _call_ai(prompt)
    return _read_edit_result(raw, current_preview, instruction, _allow_replacement(target_type, instruction))
