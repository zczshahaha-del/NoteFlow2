"""Number generated Markdown once as actual text; never run on ordinary saves."""
import re
import unicodedata
from dataclasses import dataclass
from markdown_it import MarkdownIt

_CN = "零〇一二两三四五六七八九十百千"
_PREFIX = re.compile(
    rf"^\s*(?:\d+(?:\.\d+)+(?:[.、．](?!\d)\s*|\s+)"
    rf"|\d+[.、．](?!\d)\s*|[{_CN}]+[、．.]\s*"
    rf"|[（(](?:[{_CN}]+|\d+)[）)]\s*"
    rf"|第(?:[{_CN}]+|\d+)[章节篇部]\s*[:：、.]?\s*)"
)


def unnumber_title(title: str) -> str:
    # A model can accidentally return both “1. 一、”. Remove only recognized
    # prefixes, retaining years, versions and meaningful leading digits.
    for _ in range(4):
        match = _PREFIX.match(title)
        if not match or not title[match.end():].strip():
            break
        title = title[match.end():]
    return title.strip()


def unnumber_generated_headings(markdown: str) -> str:
    fence = None
    result = []
    for line in markdown.splitlines(keepends=True):
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})", line)
        if marker:
            run = marker.group(1)
            if fence is None:
                fence = (run[0], len(run))
            elif run[0] == fence[0] and len(run) >= fence[1] and not line[marker.end():].strip():
                fence = None
        elif fence is None:
            heading = re.match(r"^( {0,3}#{1,6}[ \t]+)(.*?)(\r?\n)?$", line)
            if heading:
                line = heading.group(1) + unnumber_title(heading.group(2)) + (heading.group(3) or "")
        result.append(line)
    return "".join(result)


@dataclass(frozen=True)
class HeadingLine:
    line: int
    column: int
    level: int
    raw: str
    plain: str


def markdown_headings(markdown: str) -> list[HeadingLine]:
    """Parser maps exclude fenced/indented code, HTML blocks and ordinary lists.
    Keep exact source positions; unsupported multiline titles fail closed."""
    lines = markdown.splitlines(keepends=True)
    tokens = MarkdownIt("commonmark").parse(markdown)
    result = []
    for index, token in enumerate(tokens):
        if token.type != "heading_open" or not token.map:
            continue
        inline = tokens[index + 1]
        raw = inline.content
        if not raw.strip():
            continue
        if "\n" in raw:
            raise ValueError("多行 Setext 标题暂不自动整理，请先核对标题范围")
        line = lines[token.map[0]]
        start = 0
        if token.markup.startswith("#"):
            marker = re.search(r"#{1,6}[ \t]+", line)
            if marker is None:
                raise ValueError("无法准确定位标题，未修改原文")
            start = marker.end()
        column = line.find(raw, start)
        if column < 0:
            raise ValueError("无法准确定位标题文字，未修改原文")
        plain = "".join(child.content for child in inline.children or [] if child.type in {"text", "code_inline"})
        result.append(HeadingLine(token.map[0], column, int(token.tag[1:]), raw, plain))
    return result


def _plain(value: str) -> str:
    return " ".join(unicodedata.normalize("NFC", value).split()).casefold()


def _without_ordinal(raw: str, plain: str) -> str:
    cleaned = unnumber_title(raw)
    if cleaned != raw.strip():
        return cleaned
    # Preserve common inline formatting while removing a model's old ordinal.
    wrapper = re.match(r"^(\*\*|__|\*|_|`+|\[|<(?:u|mark|span|kbd)(?:\s[^>]*)?>)(.*)$", raw)
    if wrapper:
        opening, inner = wrapper.groups()
        stripped = unnumber_title(inner)
        if stripped != inner.strip():
            if opening == "[" and stripped.startswith("]"):
                raise ValueError("编号单独位于链接中，未修改原文")
            if stripped.startswith(opening) and opening in {"**", "__", "*", "_"}:
                return stripped[len(opening):]  # Avoid an empty **** rule.
            return opening + stripped
    if unnumber_title(plain) != plain.strip():
        raise ValueError("标题序号含有无法安全定位的行内格式，未修改原文")
    return raw


def chinese_number(number: int) -> str:
    if not 0 < number < 10000:
        return str(number)
    digits = "零一二三四五六七八九"
    output, zero = "", False
    for unit, label in ((1000, "千"), (100, "百"), (10, "十"), (1, "")):
        digit, number = divmod(number, unit)
        if digit:
            if zero:
                output += "零"
            output += ("" if unit == 10 and digit == 1 and not output else digits[digit]) + label
            zero = False
        elif output and number:
            zero = True
    return output


def _requested_numbering_style(request: str) -> str | None:
    """Only explicit chapter-number requests count, not numbers in the topic."""
    choices = [(m.start(), "decimal") for m in re.finditer(r"(?:不要|不用|禁止|避免|不使用)[^。\n]{0,10}(?:中文|汉字)[^。\n]{0,6}(?:编号|序号)", request)]
    pattern = r"(?:大标题|章标题|一级标题|章节|编号|序号)[^。\n]{0,10}?(?:用|使用|采用|改为)[^。\n]{0,4}?(中文|汉字|一、二、|阿拉伯(?:数字)?|数字)"
    choices.extend((m.start(), "chinese" if m.group(1) in {"中文", "汉字", "一、二、"} else "decimal") for m in re.finditer(pattern, request))
    return max(choices, key=lambda item: item[0])[1] if choices else None


def numbering_style_from_request(request: str) -> str:
    return _requested_numbering_style(request) or "decimal"


def draft_numbering_style(draft) -> str:
    config = draft.draft_config or {}
    brief = config.get("generationBrief") or {}
    request = str(brief.get("requirements") if "requirements" in brief else config.get("rawRequest") or draft.extra_request or "")
    supplement = str(config.get("bodyInstruction") or "")
    return _requested_numbering_style(supplement) or numbering_style_from_request(request)


def number_markdown_headings(markdown: str, document_title: str = "", *, start_path: tuple[int, ...] = (), base_level: int | None = None, style: str = "decimal") -> str:
    """Materialize numbers during generation/replanning or explicit repair only.
    Everything outside recognized heading ordinal spans stays byte-for-byte.
    start_path places an individually generated section in its whole outline."""
    headings = markdown_headings(markdown)
    lines = markdown.splitlines(keepends=True)
    if headings and headings[0].level == 1 and not "".join(lines[:headings[0].line]).strip() and _plain(unnumber_title(headings[0].plain)) == _plain(document_title):
        main = headings[0]
        line = lines[main.line]
        lines[main.line] = line[:main.column] + _without_ordinal(main.raw, main.plain) + line[main.column + len(main.raw):]
        headings = headings[1:]
    if not headings:
        return "".join(lines)
    base = base_level if base_level is not None else min(h.level for h in headings)
    counters = [0] * 6
    if start_path:
        if len(start_path) > 6 or any(number < 1 for number in start_path):
            raise ValueError("章节路径无效")
        counters[:len(start_path)] = start_path
        counters[len(start_path) - 1] -= 1
    offset = max(0, len(start_path) - 1)
    for heading in headings:
        depth = min(5, offset + max(0, heading.level - base))
        for parent in range(depth):
            if not counters[parent]:
                counters[parent] = 1
        counters[depth] += 1
        for child in range(depth + 1, 6):
            counters[child] = 0
        number = str(counters[0]) + "." if depth == 0 else ".".join(map(str, counters[:depth + 1]))
        if style == "chinese" and depth == 0:
            number = chinese_number(counters[0]) + "、"
        clean = _without_ordinal(heading.raw, heading.plain)
        line = lines[heading.line]
        lines[heading.line] = line[:heading.column] + number + " " + clean + line[heading.column + len(heading.raw):]
    return "".join(lines)


def section_number_path(section, sections) -> tuple[int, ...]:
    active = sorted((item for item in sections if item.deleted_at is None), key=lambda item: item.sort_order)
    base = min((max(1, min(item.level, 6)) for item in active), default=2)
    counters = [0] * 6
    for item in active:
        depth = max(0, min(5, item.level - base))
        for parent in range(depth):
            counters[parent] = counters[parent] or 1
        counters[depth] += 1
        counters[depth + 1:] = [0] * (5 - depth)
        if item.id == section.id:
            return tuple(counters[:depth + 1])
    raise ValueError("章节不在当前有效大纲中")


def number_generated_section(draft, section, sections, content: str) -> str:
    headings = markdown_headings(content)
    if headings and headings[0].level == 1 and _plain(unnumber_title(headings[0].plain)) == _plain(draft.title):
        lines = content.splitlines(keepends=True)
        # A model's repeated main title is not another section in this draft.
        end = headings[0].line + 1
        if end < len(lines) and re.fullmatch(r" {0,3}=+[ \t]*(?:\r?\n)?", lines[end]):
            end += 1
        del lines[headings[0].line:end]
        content = "".join(lines).strip()
        headings = markdown_headings(content)
    if not headings:
        content = "#" * section.level + " " + section.title + "\n\n" + content
        headings = markdown_headings(content)
    # A model may return H1 for a section assigned H2 in the outline. Align its
    # relative hierarchy here, or final whole-document assembly would treat
    # later H2 chapters as descendants of that accidental H1.
    shift = section.level - headings[0].level
    if shift:
        lines = content.splitlines(keepends=True)
        for heading in headings:
            level = max(1, min(6, heading.level + shift))
            line = lines[heading.line]
            marker = re.search(r"#{1,6}(?=[ \t])", line[:heading.column])
            if marker:
                lines[heading.line] = line[:marker.start()] + "#" * level + line[marker.end():]
            else:
                # A single-line Setext heading has a parser-confirmed underline.
                lines[heading.line] = line[:heading.column] + "#" * level + " " + line[heading.column:]
                underline = lines[heading.line + 1]
                lines[heading.line + 1] = "\r\n" if underline.endswith("\r\n") else "\n" if underline.endswith("\n") else ""
        content = "".join(lines)
        headings = markdown_headings(content)
    return number_markdown_headings(content, draft.title, start_path=section_number_path(section, sections), base_level=headings[0].level, style=draft_numbering_style(draft))
