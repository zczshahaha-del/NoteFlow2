from __future__ import annotations

import asyncio
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Awaitable, Callable, TypeVar


T = TypeVar("T")


class CircuitOpenError(RuntimeError):
    pass


@dataclass
class AsyncCircuitBreaker:
    failure_threshold: int
    window_seconds: int
    cooldown_seconds: int
    _failures: deque[float] = field(default_factory=deque)
    _opened_at: float | None = None

    def _prune(self, now: float) -> None:
        while self._failures and now - self._failures[0] > self.window_seconds:
            self._failures.popleft()

    def allow(self) -> bool:
        now = time.monotonic()
        if self._opened_at is None:
            return True
        if now - self._opened_at >= self.cooldown_seconds:
            self._opened_at = None
            self._failures.clear()
            return True
        return False

    def success(self) -> None:
        self._failures.clear()
        self._opened_at = None

    def failure(self) -> None:
        now = time.monotonic()
        self._prune(now)
        self._failures.append(now)
        if len(self._failures) >= self.failure_threshold:
            self._opened_at = now

    async def call(self, operation: Callable[[], Awaitable[T]], *, timeout_ms: int) -> T:
        if not self.allow():
            raise CircuitOpenError("provider circuit is open")
        try:
            result = await asyncio.wait_for(operation(), timeout=max(0.1, timeout_ms / 1000))
        except Exception:
            self.failure()
            raise
        self.success()
        return result
