from __future__ import annotations

import hashlib
import threading
import time
from collections import deque
from dataclasses import dataclass

from app.config import cfg
from app.services.observability import record_metric


@dataclass(frozen=True)
class RuntimeDecision:
    runtime: str
    reason: str
    bucket: int
    circuit_open: bool = False


class RuntimeCircuitBreaker:
    """Small process-local safety valve; configuration remains the global kill switch."""

    def __init__(self) -> None:
        self._failures: deque[float] = deque()
        self._open_until = 0.0
        self._lock = threading.Lock()

    def _prune(self, now: float) -> None:
        cutoff = now - cfg.LANGGRAPH_CANARY_WINDOW_SECONDS
        while self._failures and self._failures[0] < cutoff:
            self._failures.popleft()

    def is_open(self) -> bool:
        now = time.monotonic()
        with self._lock:
            self._prune(now)
            return now < self._open_until

    def success(self) -> None:
        record_metric("agent_canary", "run", status="success")

    def failure(self, reason: str) -> None:
        now = time.monotonic()
        with self._lock:
            self._prune(now)
            self._failures.append(now)
            if len(self._failures) >= cfg.LANGGRAPH_CANARY_ERROR_THRESHOLD:
                self._open_until = now + cfg.LANGGRAPH_CANARY_COOLDOWN_SECONDS
        record_metric("agent_canary", "run", status=reason or "failed")

    def reset(self) -> None:
        with self._lock:
            self._failures.clear()
            self._open_until = 0.0


runtime_circuit = RuntimeCircuitBreaker()


def rollout_bucket(user_id: str) -> int:
    digest = hashlib.sha256(f"noteflow:langgraph:{user_id}".encode()).digest()
    return int.from_bytes(digest[:4], "big") % 100


def select_agent_runtime(*, user_id: str, intent: str, mode: str) -> RuntimeDecision:
    bucket = rollout_bucket(user_id)
    if cfg.AGENT_RUNTIME != "langgraph" or not cfg.LANGGRAPH_CANARY_ENABLED:
        return RuntimeDecision("legacy", "disabled", bucket)
    if intent not in {"general_chat", "note_search", "note_qa"} or mode not in {"chat", "ask_notes"}:
        return RuntimeDecision("legacy", "write_or_resume_intent", bucket)
    if runtime_circuit.is_open():
        return RuntimeDecision("legacy", "circuit_open", bucket, circuit_open=True)
    if user_id in cfg.LANGGRAPH_CANARY_USER_IDS:
        return RuntimeDecision("langgraph", "allowlist", bucket)
    if bucket < cfg.LANGGRAPH_CANARY_PERCENT:
        return RuntimeDecision("langgraph", "percentage", bucket)
    return RuntimeDecision("legacy", "outside_percentage", bucket)


def select_child_runtime(kind: str) -> str:
    value = cfg.DRAFT_RUNTIME if kind == "draft" else cfg.EDIT_RUNTIME
    return "langgraph" if value == "langgraph" else "legacy"
