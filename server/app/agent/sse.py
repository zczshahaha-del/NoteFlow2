from __future__ import annotations

import json
from collections.abc import Iterable, Iterator
from typing import Any

from app.agent.contracts import RuntimeEvent
from app.config import cfg

DONE_FRAME = "data: [DONE]\n\n"


def legacy_encode_event(data: dict[str, Any]) -> str:
    """Frozen pre-Step-7 emitter used by the rollback flag."""
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def encode_event(event: RuntimeEvent | dict[str, Any]) -> str:
    payload = event.to_wire() if isinstance(event, RuntimeEvent) else event
    if not cfg.SSE_ADAPTER_ENABLED:
        return legacy_encode_event(payload)
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def encode_done() -> str:
    return DONE_FRAME


class SSEStreamAdapter:
    """Maps internal events to the established browser contract exactly once."""

    def __init__(self, *, enabled: bool | None = None):
        self.enabled = cfg.SSE_ADAPTER_ENABLED if enabled is None else enabled
        self.closed = False

    def event(self, event: RuntimeEvent | dict[str, Any]) -> str:
        if self.closed:
            raise RuntimeError("cannot emit an event after [DONE]")
        return encode_event(event)

    def done(self) -> str:
        if self.closed:
            return ""
        self.closed = True
        return encode_done()

    def adapt(self, events: Iterable[RuntimeEvent | dict[str, Any]]) -> Iterator[str]:
        try:
            for event in events:
                yield self.event(event)
        finally:
            frame = self.done()
            if frame:
                yield frame
