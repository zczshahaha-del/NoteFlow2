__all__ = ["ProviderRegistry", "legacy_provider_registry"]


def __getattr__(name):
    if name in __all__:
        from app.providers.registry import ProviderRegistry, legacy_provider_registry
        return {"ProviderRegistry": ProviderRegistry, "legacy_provider_registry": legacy_provider_registry}[name]
    raise AttributeError(name)
