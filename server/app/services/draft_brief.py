from pydantic import BaseModel, Field


class DraftBrief(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    requirements: str = Field(default="", max_length=2000)
    rawRequest: str = Field(default="", max_length=32000)


def generation_request(brief: dict) -> str:
    return "\n\n".join([
        f"原始请求（仅供来源核对，与当前要求冲突时以当前要求为准）：\n{str(brief.get('rawRequest') or '').strip()}",
        f"当前生成标题：{str(brief.get('title') or '').strip()}",
        f"当前生成要求：{str(brief.get('requirements') or '').strip() or '未另行指定。不沿用已被清空或替换的旧要求。'}",
        "按当前标题和要求确定文档用途与组织方式，不统一套用技术教程；不要擅自补造用户未指定的年级、课时等条件。",
    ])


def body_supplement(instruction: str) -> str:
    if not instruction.strip():
        return ""
    return (
        f"\n\n正文补充要求（在最初要求基础上，适用于每章正文）：\n{instruction.strip()}\n"
        "相同条件有明确修改时，正文采用本次补充；本章单独要求优先。保持当前笔记主题和大纲结构，不自动重排章节。"
    )
