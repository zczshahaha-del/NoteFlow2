"""Canonical unnumbered titles for newly generated drafts, not existing notes."""
import re

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
