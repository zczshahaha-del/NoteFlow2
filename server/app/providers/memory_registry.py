from collections.abc import Callable

from app.config import cfg
from app.memory.engine import MemoryEngine, MemoryUnavailable
from app.providers.contracts import MemoryProvider


def _hindsight() -> MemoryEngine:
    from app.providers.hindsight import HindsightProvider
    return HindsightProvider()


MEMORY_ENGINES: dict[str, Callable[[], MemoryEngine]] = {"hindsight": _hindsight}


def _mem0_index() -> MemoryProvider:
    from app.providers.mem0 import get_mem0_provider
    return get_mem0_provider()


MEMORY_INDEXES: dict[str, Callable[[], MemoryProvider]] = {"mem0": _mem0_index}


def uses_legacy_index() -> bool:
    # This backend stores formal facts in NoteFlow and only projects an index.
    # It is a different storage contract, not a substitute for MemoryEngine.
    return cfg.MEMORY_ENGINE in {"local", "mem0"}


def configured_engine(name: str | None = None) -> MemoryEngine:
    factory = MEMORY_ENGINES.get(cfg.MEMORY_ENGINE if name is None else name)
    if factory is None:
        raise MemoryUnavailable("记忆引擎配置不可用，请联系维护者。")
    return factory()


def legacy_memory_index() -> MemoryProvider | None:
    """Local facts can use an optional search projection."""
    name = cfg.MEMORY_INDEX_PROVIDER if cfg.MEMORY_ENGINE == "local" else "mem0"
    if name == "none":
        return None
    factory = MEMORY_INDEXES.get(name)
    if factory is None:
        raise MemoryUnavailable("记忆检索配置不可用，请联系维护者。")
    return factory()
