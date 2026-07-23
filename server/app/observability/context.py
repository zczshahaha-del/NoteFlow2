from __future__ import annotations

import json
import re
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import asdict, dataclass, replace
from typing import Any, Iterator

_SENSITIVE = re.compile(r"(authorization|cookie|password|secret|api.?key|token)", re.I)
_SECRET_VALUE = re.compile(
    r"(?:(?:password|passwd|secret|api[_ -]?key|access[_ -]?token|密码|口令)\s*[:=是]\s*)"
    r"[^\s,，;；]{4,}|sk-[a-z0-9_-]{12,}|bearer\s+[a-z0-9._-]+",
    re.I,
)


@dataclass(frozen=True)
class TraceContext:
    request_id: str = ""
    trace_id: str = ""
    session_id: str = ""
    run_id: str = ""
    node: str = ""
    tool: str = ""
    provider: str = ""
    worker: str = ""


_trace_context: ContextVar[TraceContext] = ContextVar("noteflow_trace_context", default=TraceContext())


def current_trace() -> TraceContext:
    return _trace_context.get()


def new_trace_id() -> str:
    return uuid.uuid4().hex


@contextmanager
def trace_scope(**updates: str) -> Iterator[TraceContext]:
    context = replace(current_trace(), **{key: value for key, value in updates.items() if value is not None})
    token = _trace_context.set(context)
    try:
        yield context
    finally:
        _trace_context.reset(token)


def redact_data(value: Any, *, key: str = "", max_length: int = 300) -> Any:
    if _SENSITIVE.search(key):
        return "[REDACTED]"
    if isinstance(value, dict):
        return {str(k): redact_data(v, key=str(k), max_length=max_length) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact_data(item, max_length=max_length) for item in value[:50]]
    if isinstance(value, str):
        cleaned = _SECRET_VALUE.sub("[REDACTED]", value)
        return cleaned if len(cleaned) <= max_length else cleaned[:max_length] + "…"
    return value


def structured_log(logger, level: int, event: str, **fields: Any) -> None:
    context = {k: v for k, v in asdict(current_trace()).items() if v}
    record = {"event": event, **context, **redact_data(fields)}
    logger.log(level, json.dumps(record, ensure_ascii=False, default=str))
