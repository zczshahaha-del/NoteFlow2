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


def _env_float(key: str, default: float = 0.0) -> float:
    try:
        return float(os.environ.get(key, ""))
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
    LLM_INPUT_USD_PER_MILLION_TOKENS: float = max(0.0, _env_float("LLM_INPUT_USD_PER_MILLION_TOKENS", 0.0))
    LLM_OUTPUT_USD_PER_MILLION_TOKENS: float = max(0.0, _env_float("LLM_OUTPUT_USD_PER_MILLION_TOKENS", 0.0))
    REDIS_ADDR: str = _env("REDIS_ADDR", "127.0.0.1:6379")
    REDIS_PASSWORD: str = _env("REDIS_PASSWORD", "")
    REDIS_DB: int = _env_int("REDIS_DB", 0)
    AI_RATE_LIMIT: int = _env_int("AI_RATE_LIMIT_PER_MINUTE", 30)
    EMBEDDING_RATE_LIMIT: int = _env_int("EMBEDDING_RATE_LIMIT_PER_MINUTE", 60)
    RERANKER_RATE_LIMIT: int = _env_int("RERANKER_RATE_LIMIT_PER_MINUTE", 60)
    MEMORY_RATE_LIMIT: int = _env_int("MEMORY_RATE_LIMIT_PER_MINUTE", 60)
    INDEX_RATE_LIMIT: int = _env_int("INDEX_RATE_LIMIT_PER_MINUTE", 30)
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
    EMBEDDING_USD_PER_MILLION_TOKENS: float = max(0.0, _env_float("EMBEDDING_USD_PER_MILLION_TOKENS", 0.0))
    EMBEDDING_FAIL_INDEX_ON_ERROR: bool = _env_bool("EMBEDDING_FAIL_INDEX_ON_ERROR", False)
    AGENT_RUNTIME: str = _env("AGENT_RUNTIME", "legacy")
    RAG_PROVIDER: str = _env("RAG_PROVIDER", "legacy")
    MEMORY_PROVIDER: str = _env("MEMORY_PROVIDER", "legacy")
    RERANKER_PROVIDER: str = _env("RERANKER_PROVIDER", "legacy")
    VECTOR_STORE_PROVIDER: str = _env("VECTOR_STORE_PROVIDER", "legacy")
    AGENT_SHADOW_ENABLED: bool = _env_bool("AGENT_SHADOW_ENABLED", False)
    LANGGRAPH_POC_ENABLED: bool = _env_bool("LANGGRAPH_POC_ENABLED", False)
    LANGGRAPH_SHADOW_ENABLED: bool = _env_bool("LANGGRAPH_SHADOW_ENABLED", AGENT_SHADOW_ENABLED)
    LANGGRAPH_SHADOW_SAMPLE_PERCENT: int = max(0, min(100, _env_int("LANGGRAPH_SHADOW_SAMPLE_PERCENT", 0)))
    LANGGRAPH_SHADOW_TIMEOUT_MS: int = max(100, _env_int("LANGGRAPH_SHADOW_TIMEOUT_MS", 2500))
    LANGGRAPH_SHADOW_MAX_CONCURRENCY: int = max(1, _env_int("LANGGRAPH_SHADOW_MAX_CONCURRENCY", 2))
    LANGGRAPH_SHADOW_USER_IDS: set[str] = {
        item.strip() for item in _env("LANGGRAPH_SHADOW_USER_IDS", "").split(",") if item.strip()
    }
    LANGGRAPH_CANARY_ENABLED: bool = _env_bool("LANGGRAPH_CANARY_ENABLED", False)
    LANGGRAPH_CANARY_PERCENT: int = max(
        0,
        min(100, _env_int("LANGGRAPH_CANARY_PERCENT", _env_int("AI_CANARY_PERCENT", 0))),
    )
    LANGGRAPH_CANARY_USER_IDS: set[str] = {
        item.strip() for item in _env("LANGGRAPH_CANARY_USER_IDS", "").split(",") if item.strip()
    }
    LANGGRAPH_CANARY_ERROR_THRESHOLD: int = max(1, _env_int("LANGGRAPH_CANARY_ERROR_THRESHOLD", 5))
    LANGGRAPH_CANARY_WINDOW_SECONDS: int = max(10, _env_int("LANGGRAPH_CANARY_WINDOW_SECONDS", 60))
    LANGGRAPH_CANARY_COOLDOWN_SECONDS: int = max(10, _env_int("LANGGRAPH_CANARY_COOLDOWN_SECONDS", 120))
    DRAFT_RUNTIME: str = _env("DRAFT_RUNTIME", "legacy")
    EDIT_RUNTIME: str = _env("EDIT_RUNTIME", "legacy")
    RAG_SHADOW_ENABLED: bool = _env_bool("RAG_SHADOW_ENABLED", False)
    MEMORY_SHADOW_ENABLED: bool = _env_bool("MEMORY_SHADOW_ENABLED", False)
    MEMORY_SHADOW_READ_PERCENT: int = max(0, min(100, _env_int("MEMORY_SHADOW_READ_PERCENT", 0)))
    MEMORY_SHADOW_WRITE_ENABLED: bool = _env_bool("MEMORY_SHADOW_WRITE_ENABLED", False)
    MEM0_CANARY_ENABLED: bool = _env_bool("MEM0_CANARY_ENABLED", False)
    MEM0_CANARY_PERCENT: int = max(0, min(100, _env_int("MEM0_CANARY_PERCENT", 0)))
    MEM0_CANARY_USER_IDS: set[str] = {
        item.strip() for item in _env("MEM0_CANARY_USER_IDS", "").split(",") if item.strip()
    }
    MEM0_TIMEOUT_MS: int = max(100, _env_int("MEM0_TIMEOUT_MS", 1800))
    MEM0_ERROR_THRESHOLD: int = max(1, _env_int("MEM0_ERROR_THRESHOLD", 5))
    MEM0_ERROR_WINDOW_SECONDS: int = max(10, _env_int("MEM0_ERROR_WINDOW_SECONDS", 60))
    MEM0_CIRCUIT_COOLDOWN_SECONDS: int = max(10, _env_int("MEM0_CIRCUIT_COOLDOWN_SECONDS", 120))
    MEMORY_CONTEXT_LIMIT: int = max(3, min(8, _env_int("MEMORY_CONTEXT_LIMIT", 6)))
    AI_CANARY_PERCENT: int = max(0, min(100, _env_int("AI_CANARY_PERCENT", 0)))
    RAG_CHUNK_SIZE: int = _env_int("RAG_CHUNK_SIZE", 900)
    RAG_CHUNK_OVERLAP: int = _env_int("RAG_CHUNK_OVERLAP", 120)
    RAG_CANDIDATE_K: int = _env_int("RAG_CANDIDATE_K", 40)
    RAG_TOP_K: int = _env_int("RAG_TOP_K", 8)
    RAG_RRF_K: int = _env_int("RAG_RRF_K", 60)
    RAG_RERANK_TIMEOUT_SECONDS: int = _env_int("RAG_RERANK_TIMEOUT_SECONDS", 3)
    RAG_BM25_TOKENIZER: str = _env("RAG_BM25_TOKENIZER", "jieba_search")
    RAG_V2_INDEX_ENABLED: bool = _env_bool("RAG_V2_INDEX_ENABLED", False)
    RAG_REWRITE_ENABLED: bool = _env_bool("RAG_REWRITE_ENABLED", True)
    RAG_BM25_ENABLED: bool = _env_bool("RAG_BM25_ENABLED", True)
    RAG_VECTOR_ENABLED: bool = _env_bool("RAG_VECTOR_ENABLED", True)
    RAG_RERANK_ENABLED: bool = _env_bool("RAG_RERANK_ENABLED", False)
    RAG_CHANNEL_TIMEOUT_MS: int = max(100, _env_int("RAG_CHANNEL_TIMEOUT_MS", 1800))
    RAG_CONTEXT_TOKEN_BUDGET: int = max(500, _env_int("RAG_CONTEXT_TOKEN_BUDGET", 6000))
    RAG_QUERY_CACHE_TTL_SECONDS: int = max(0, _env_int("RAG_QUERY_CACHE_TTL_SECONDS", 60))
    RAG_TITLE_RRF_WEIGHT: float = max(0.0, _env_float("RAG_TITLE_RRF_WEIGHT", 1.25))
    RAG_BM25_RRF_WEIGHT: float = max(0.0, _env_float("RAG_BM25_RRF_WEIGHT", 1.0))
    RAG_VECTOR_RRF_WEIGHT: float = max(0.0, _env_float("RAG_VECTOR_RRF_WEIGHT", 1.0))
    RAG_VECTOR_MIN_SIMILARITY: float = max(0.0, min(1.0, _env_float("RAG_VECTOR_MIN_SIMILARITY", 0.45)))
    RERANKER_BASE_URL: str = _env("RERANKER_BASE_URL", "").rstrip("/")
    # Alibaba Cloud Model Studio uses the same API key for embeddings and reranking.
    # A dedicated key can still override this for another reranker provider.
    RERANKER_API_KEY: str = _env("RERANKER_API_KEY", EMBEDDING_API_KEY)
    RERANKER_MODEL: str = _env("RERANKER_MODEL", "")
    RERANKER_BATCH_SIZE: int = max(1, min(100, _env_int("RERANKER_BATCH_SIZE", 50)))
    MEM0_COLLECTION_NAME: str = _env("MEM0_COLLECTION_NAME", "noteflow_mem0_v1")
    MEM0_HISTORY_DB_PATH: str = _env("MEM0_HISTORY_DB_PATH", "/tmp/noteflow-mem0-history.db")
    ATTACHMENT_STORAGE_ROOT: str = _env("ATTACHMENT_STORAGE_ROOT", "server/data/attachments")
    ATTACHMENT_MAX_BYTES: int = _env_int("ATTACHMENT_MAX_BYTES", 10 * 1024 * 1024)
    OUTBOX_WORKER_ENABLED: bool = _env_bool("OUTBOX_WORKER_ENABLED", True)
    OUTBOX_POLL_SECONDS: int = _env_int("OUTBOX_POLL_SECONDS", 2)
    OUTBOX_STALE_SECONDS: int = _env_int("OUTBOX_STALE_SECONDS", 300)
    OUTBOX_MAX_ATTEMPTS: int = _env_int("OUTBOX_MAX_ATTEMPTS", 8)
    INDEX_JOB_STALE_SECONDS: int = _env_int("INDEX_JOB_STALE_SECONDS", 300)
    SSE_ADAPTER_ENABLED: bool = _env_bool("SSE_ADAPTER_ENABLED", True)

    @property
    def DATABASE_URL(self) -> str:
        return (
            f"postgresql+asyncpg://{self.DB_USER}:{self.DB_PASSWORD}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
        )

    def validate_security(self) -> None:
        allowed_runtime = {"legacy", "langgraph"}
        allowed_provider = {"legacy", "llamaindex", "mem0", "none"}
        for key, value in {
            "AGENT_RUNTIME": self.AGENT_RUNTIME,
            "DRAFT_RUNTIME": self.DRAFT_RUNTIME,
            "EDIT_RUNTIME": self.EDIT_RUNTIME,
        }.items():
            if value not in allowed_runtime:
                raise RuntimeError(f"unsupported {key}: {value}")
        for key, value in {
            "RAG_PROVIDER": self.RAG_PROVIDER,
            "MEMORY_PROVIDER": self.MEMORY_PROVIDER,
            "RERANKER_PROVIDER": self.RERANKER_PROVIDER,
            "VECTOR_STORE_PROVIDER": self.VECTOR_STORE_PROVIDER,
        }.items():
            allowed = {*allowed_provider, "http"} if key == "RERANKER_PROVIDER" else allowed_provider
            if value not in allowed:
                raise RuntimeError(f"unsupported {key}: {value}")
        if self.ENVIRONMENT != "production":
            return
        if self.JWT_SECRET == "dev-only-change-this-secret" or len(self.JWT_SECRET) < 32:
            raise RuntimeError("production JWT_SECRET must be at least 32 characters and must not use the development default")
        if not self.AUTH_COOKIE_SECURE:
            raise RuntimeError("AUTH_COOKIE_SECURE must be enabled in production")
        if any(origin == "*" for origin in self.CORS_ORIGINS):
            raise RuntimeError("wildcard CORS origins are not allowed in production")


cfg = Config()
