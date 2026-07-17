from __future__ import annotations

import re


def public_error_message(exc: Exception) -> str:
    raw = str(exc).strip()
    lowered = raw.lower()
    if "not configured" in lowered or "api key" in lowered:
        return "AI 服务还没有配置好，暂时不能生成回复。"
    if "ai_rate_limited" in lowered or "rate limit" in lowered or "too many" in lowered:
        return "模型接口请求太频繁了，系统已经自动重试过。请等十几秒后继续生成这一节。"
    if "timeout" in lowered or "timed out" in lowered:
        return "AI 服务响应有点慢，这次没有完整返回。请稍后重试。"
    if "deepseek api error" in lowered:
        return "模型服务这次没有正常返回，请稍后重试。"
    if "当前笔记不存在或已删除" in raw:
        return raw
    if raw and len(raw) <= 80 and not re.search(r"(traceback|httpx|sqlalchemy|mysql|redis|exception)", lowered):
        return raw
    return "Agent 执行失败，请稍后重试。"
