"""Conservative scope cues shared by chat routing and edit execution.

Reading position is context, not permission. Unknown wording is resolved against
the note or clarified by the endpoint rather than defaulting to the whole note.
"""
import re


def positive_instruction(text: str) -> str:
    # Exclude protected clauses from scope/action cues, but keep them in the
    # actual model instruction. "只改选区，不要重写整篇" must stay a selection.
    return re.sub(r"(?:不要|别|无需|不用|不必|保留|保持)[^，。；,;！!\n]*", "", text)


def requests_note(text: str) -> bool:
    return bool(re.search(r"整篇|全文|全篇|整份|整本|整个笔记|全部内容|(?:这篇|这份|当前|我的)笔记", positive_instruction(text)))


def requests_section(text: str) -> bool:
    clean = positive_instruction(text)
    # Mentioning protected later chapters is not a request to edit them.
    clean = re.sub(r"(?:其他|其它|别的|剩余)(?:小节|章节|节|章)", "", clean)
    return bool(re.search(r"小节|章节|这一节|这节|本节|当前节|这一章|这章|本章|整节|整章", clean))


def requests_current_section(text: str) -> bool:
    return bool(re.search(r"(?:当前|这个|这一个|这一|本)(?:整)?(?:小节|章节|节|章)|这节|这章", positive_instruction(text)))


def infer_edit_target(text: str) -> str | None:
    clean = positive_instruction(text).strip()
    # Only an unambiguous whole-target deletion may bypass the model. Removing
    # repeated sentences / one example is an ordinary localized edit.
    if re.fullmatch(r"(?:请|帮我|请帮我|把|将|\s)*(?:删掉|删除|移除)(?:这段|这句|选中(?:的)?(?:文字|文本|内容)|(?:当前|这个|这一)(?:小节|章节|节|章))(?:内容)?[。！!\s]*", clean):
        return "delete"
    if requests_section(clean):
        return "section"
    if requests_note(clean):
        return "note"
    return None


def requests_rewrite(text: str) -> bool:
    return bool(re.search(r"重写|重新写|重新组织|整体改写|全部改写|全篇改写|整体重构", positive_instruction(text)))
