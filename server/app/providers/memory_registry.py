from collections.abc import Callable

from app.config import cfg
from app.memory.engine import MemoryEngine, MemoryUnavailable
from app.providers.contracts import MemoryProvider


def _hindsight() -> MemoryEngine:
    from app.providers.hindsight import HindsightProvider
    return HindsightProvider()


MEMORY_ENGINES: dict[str, Callable[[], MemoryEngine]] = {"hindsight": _hindsight}


def uses_legacy_index() -> bool:
    # This backend stores formal facts in NoteFlow and only projects an index.
    # It is a different storage contract, not a substitute for MemoryEngine.
    return cfg.MEMORY_ENGINE == "mem0"


def configured_engine() -> MemoryEngine:
    factory = MEMORY_ENGINES.get(cfg.MEMORY_ENGINE)
    if factory is None:
        raise MemoryUnavailable("记忆引擎配置不可用，请联系维护者。")
    return factory()


def legacy_memory_index() -> MemoryProvider:
    """The legacy projection is isolated from the new formal-fact engine."""
    from app.providers.mem0 import get_mem0_provider
    return get_mem0_provider()
