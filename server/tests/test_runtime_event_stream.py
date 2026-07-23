from __future__ import annotations

import json
import logging
import unittest

from app.agent.contracts import RuntimeEvent
from app.agent.sse import DONE_FRAME, SSEStreamAdapter, encode_event, legacy_encode_event
from app.observability.context import redact_data, trace_scope
from app.services.observability import metrics_snapshot, record_metric


class RuntimeEventStreamTest(unittest.TestCase):
    def test_runtime_event_round_trip_preserves_legacy_fields(self) -> None:
        wire = {
            "type": "tool_action", "status": "success", "sessionId": "s1",
            "runId": "r1", "toolName": "search_notes", "choices": [{"delta": {"content": "ok"}}],
        }
        event = RuntimeEvent.from_wire(wire)
        self.assertEqual(event.to_wire(), wire)
        self.assertEqual(encode_event(event), f"data: {json.dumps(wire, ensure_ascii=False)}\n\n")

    def test_adapter_emits_exactly_one_done_and_rejects_late_events(self) -> None:
        adapter = SSEStreamAdapter(enabled=True)
        self.assertIn('"type": "context"', adapter.event({"type": "context"}))
        self.assertEqual(adapter.done(), DONE_FRAME)
        self.assertEqual(adapter.done(), "")
        with self.assertRaises(RuntimeError):
            adapter.event({"type": "late"})

    def test_legacy_rollback_encoder_is_byte_compatible(self) -> None:
        wire = {"type": "context", "message": "中文"}
        self.assertEqual(encode_event(wire), legacy_encode_event(wire))

    def test_stream_error_has_controlled_terminal_order(self) -> None:
        frames = list(SSEStreamAdapter().adapt([
            RuntimeEvent(type="context"),
            RuntimeEvent(type="agent_error", status="failed", code="agent_failed"),
            RuntimeEvent(type="agent_done", status="failed"),
        ]))
        self.assertEqual(frames[-1], DONE_FRAME)
        self.assertEqual(sum(frame == DONE_FRAME for frame in frames), 1)

    def test_disconnect_close_is_idempotent_for_reconnect_boundary(self) -> None:
        adapter = SSEStreamAdapter()
        adapter.event({"type": "context", "runId": "r1"})
        self.assertEqual(adapter.done(), DONE_FRAME)
        resumed = SSEStreamAdapter()
        self.assertIn('"runId": "r1"', resumed.event({"type": "context", "runId": "r1"}))
        self.assertEqual(resumed.done(), DONE_FRAME)

    def test_structured_redaction_and_domain_metrics(self) -> None:
        safe = redact_data({"authorization": "Bearer secret", "prompt": "x" * 500})
        self.assertEqual(safe["authorization"], "[REDACTED]")
        self.assertLess(len(safe["prompt"]), 310)
        with trace_scope(request_id="req", trace_id="trace"):
            record_metric("provider", "chat", status="failed", duration_ms=12)
        metric = metrics_snapshot()["domains"]["provider.chat"]
        self.assertGreaterEqual(metric["operations"], 1)
        self.assertGreaterEqual(metric["failures"], 1)


if __name__ == "__main__":
    unittest.main()
