"""Start the pinned local memory service without copying credentials to the repo."""
from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path

from app.config import cfg

IMAGE = "ghcr.io/vectorize-io/hindsight:1.1.0-slim@sha256:fbc37d194bce007b6cce2fd9f66cd7f8c050bd18b80e662090a92835d9cb191d"


def main():
    if not cfg.DEEPSEEK_API_KEY or not cfg.EMBEDDING_API_KEY:
        raise SystemExit("Configure existing LLM and embedding credentials first.")
    values = {
        "HINDSIGHT_API_LLM_PROVIDER": "openai",
        "HINDSIGHT_API_LLM_API_KEY": cfg.DEEPSEEK_API_KEY,
        "HINDSIGHT_API_LLM_BASE_URL": cfg.DEEPSEEK_BASE_URL.rstrip("/") + ("" if cfg.DEEPSEEK_BASE_URL.endswith("/v1") else "/v1"),
        "HINDSIGHT_API_LLM_MODEL": cfg.DEEPSEEK_MODEL,
        "HINDSIGHT_API_EMBEDDINGS_PROVIDER": "openai",
        "HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY": cfg.EMBEDDING_API_KEY,
        "HINDSIGHT_API_EMBEDDINGS_OPENAI_BASE_URL": cfg.EMBEDDING_BASE_URL,
        "HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL": cfg.EMBEDDING_MODEL,
        "HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS": str(cfg.EMBEDDING_DIMENSIONS),
        "HINDSIGHT_API_EMBEDDINGS_OPENAI_BATCH_SIZE": "10",
        "HINDSIGHT_API_RERANKER_PROVIDER": "rrf",
        "HINDSIGHT_API_ENABLE_OBSERVATIONS": "false",
        "HINDSIGHT_API_ENABLE_BANK_CONFIG_API": "true",
        "HINDSIGHT_API_LLM_MAX_CONCURRENT": "2",
        "HINDSIGHT_CP_DATAPLANE_API_URL": "http://127.0.0.1:8890",
    }
    with tempfile.TemporaryDirectory(prefix="noteflow-hindsight-") as folder:
        path = Path(folder) / "service.env"
        path.write_text("\n".join(f"{k}={v}" for k, v in values.items()) + "\n")
        os.chmod(path, 0o600)
        subprocess.run([
            "docker", "run", "-d", "--name", "noteflow-hindsight", "--restart", "unless-stopped",
            "--memory", "1536m", "--env-file", str(path),
            "-p", "127.0.0.1:8888:8888", "-p", "127.0.0.1:9999:9999",
            "-v", "noteflow_hindsight_data:/home/hindsight/.pg0",
            "-v", str(Path(__file__).resolve().with_name("hindsight-readonly-proxy.py")) + ":/opt/noteflow-readonly.py:ro",
            IMAGE, "/bin/sh", "-c", "/app/api/.venv/bin/python /opt/noteflow-readonly.py & exec /app/start-all.sh",
        ], check=True)


if __name__ == "__main__":
    main()
