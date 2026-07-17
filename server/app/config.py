import os
from pathlib import Path


def _load_env_file(path: str):
    p = Path(path)
    if not p.exists():
        return
    with open(p) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip("\"'")
            if key and key not in os.environ:
                os.environ[key] = value


_load_env_file("server/.env")
_load_env_file(".env")


def _env(key: str, default: str = "") -> str:
    return os.environ.get(key, default).strip() or default


def _env_int(key: str, default: int = 0) -> int:
    try:
        return int(os.environ.get(key, ""))
    except (ValueError, TypeError):
        return default


def _env_bool(key: str, default: bool = False) -> bool:
    value = os.environ.get(key)
    if value is None or value.strip() == "":
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


class Config:
    ENVIRONMENT: str = _env("ENVIRONMENT", "development")
    PORT: str = _env("PORT", "8080")
    CORS_ORIGINS: list[str] = [o.strip() for o in _env("CORS_ORIGIN", "http://127.0.0.1:5173,http://localhost:5173").split(",") if o.strip()]
    DB_HOST: str = _env("DB_HOST", "127.0.0.1")
    DB_PORT: str = _env("DB_PORT", "5432")
    DB_USER: str = _env("DB_USER", "noteflow")
    DB_PASSWORD: str = _env("DB_PASSWORD", "noteflow_password")
    DB_NAME: str = _env("DB_NAME", "noteflow")
    JWT_SECRET: str = _env("JWT_SECRET", "dev-only-change-this-secret")
    AUTH_COOKIE_NAME: str = _env("AUTH_COOKIE_NAME", "noteflow_session")
    AUTH_COOKIE_SECURE: bool = _env_bool("AUTH_COOKIE_SECURE", ENVIRONMENT == "production")
    AUTH_ACCESS_TTL_MINUTES: int = _env_int("AUTH_ACCESS_TTL_MINUTES", 30)
    AUTH_SESSION_TTL_DAYS: int = _env_int("AUTH_SESSION_TTL_DAYS", 7)
    LOGIN_RATE_LIMIT: int = _env_int("LOGIN_RATE_LIMIT_PER_5_MINUTES", 12)
    PASSWORD_RESET_TTL_MINUTES: int = _env_int("PASSWORD_RESET_TTL_MINUTES", 30)
    PASSWORD_RESET_WEBHOOK_URL: str = _env("PASSWORD_RESET_WEBHOOK_URL", "")
    FRONTEND_BASE_URL: str = _env("FRONTEND_BASE_URL", "http://127.0.0.1:5173").rstrip("/")
    DEEPSEEK_API_KEY: str = _env("DEEPSEEK_API_KEY", "")
    DEEPSEEK_BASE_URL: str = _env("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
    DEEPSEEK_MODEL: str = _env("DEEPSEEK_MODEL", "deepseek-chat")
    REDIS_ADDR: str = _env("REDIS_ADDR", "127.0.0.1:6379")
    REDIS_PASSWORD: str = _env("REDIS_PASSWORD", "")
    REDIS_DB: int = _env_int("REDIS_DB", 0)
    AI_RATE_LIMIT: int = _env_int("AI_RATE_LIMIT_PER_MINUTE", 30)
    AI_CACHE_ENABLED: bool = _env_bool("AI_CACHE_ENABLED", True)
    AI_CACHE_TTL_SECONDS: int = _env_int("AI_CACHE_TTL_SECONDS", 3600)
    EMBEDDING_PROVIDER: str = _env("EMBEDDING_PROVIDER", "dashscope")
    EMBEDDING_API_KEY: str = _env("EMBEDDING_API_KEY", _env("DASHSCOPE_API_KEY", ""))
    EMBEDDING_BASE_URL: str = _env(
        "EMBEDDING_BASE_URL",
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
    ).rstrip("/")
    EMBEDDING_MODEL: str = _env("EMBEDDING_MODEL", "text-embedding-v4")
    EMBEDDING_DIMENSIONS: int = _env_int("EMBEDDING_DIMENSIONS", 1024)
    EMBEDDING_BATCH_SIZE: int = _env_int("EMBEDDING_BATCH_SIZE", 10)
    EMBEDDING_TIMEOUT_SECONDS: int = _env_int("EMBEDDING_TIMEOUT_SECONDS", 60)
    EMBEDDING_FAIL_INDEX_ON_ERROR: bool = _env_bool("EMBEDDING_FAIL_INDEX_ON_ERROR", False)
    ATTACHMENT_STORAGE_ROOT: str = _env("ATTACHMENT_STORAGE_ROOT", "server/data/attachments")
    ATTACHMENT_MAX_BYTES: int = _env_int("ATTACHMENT_MAX_BYTES", 10 * 1024 * 1024)

    @property
    def DATABASE_URL(self) -> str:
        return (
            f"postgresql+asyncpg://{self.DB_USER}:{self.DB_PASSWORD}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
        )

    def validate_security(self) -> None:
        if self.ENVIRONMENT != "production":
            return
        if self.JWT_SECRET == "dev-only-change-this-secret" or len(self.JWT_SECRET) < 32:
            raise RuntimeError("production JWT_SECRET must be at least 32 characters and must not use the development default")
        if not self.AUTH_COOKIE_SECURE:
            raise RuntimeError("AUTH_COOKIE_SECURE must be enabled in production")
        if any(origin == "*" for origin in self.CORS_ORIGINS):
            raise RuntimeError("wildcard CORS origins are not allowed in production")


cfg = Config()
