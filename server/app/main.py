import logging
import os
import socket
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import cfg
from app.database import init_db, init_redis
from app.routers import auth, knowledge, notes, drafts, edits, memories, ai, agent, health, settings, attachments
from app.schemas.common import API_ERROR_RESPONSES
from app.services.observability import install_observability
from app.services.index_worker import start_index_worker, stop_index_worker
from app.services.draft_worker import start_draft_worker, stop_draft_worker

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)
cfg.validate_security()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await init_redis()
    await start_index_worker()
    await start_draft_worker()
    logger.info("NoteFlow API started")
    yield
    await stop_draft_worker()
    await stop_index_worker()


app = FastAPI(
    title="NoteFlow API",
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
    responses=API_ERROR_RESPONSES,
)
install_observability(app)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=cfg.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "PUT", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-File-Name", "X-Note-Id", "X-Content-Type"],
)

# Routes
app.include_router(health.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(knowledge.router, prefix="/api")
app.include_router(notes.router, prefix="/api")
app.include_router(attachments.router, prefix="/api")
app.include_router(drafts.router, prefix="/api")
app.include_router(edits.router, prefix="/api")
app.include_router(memories.router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(agent.router, prefix="/api")


def _find_free_port(preferred: int, max_steps: int = 50) -> int:
    for candidate in range(preferred, min(preferred + max_steps, 65536)):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("", candidate))
                return candidate
        except OSError:
            continue
    raise RuntimeError(f"cannot find a free port starting from {preferred}")


def _write_dev_api_port(port: int):
    try:
        path = os.path.join(os.getcwd(), ".dev-api-port")
        with open(path, "w") as f:
            f.write(str(port))
    except Exception as e:
        logger.warning("could not write .dev-api-port: %s", e)


def main():
    preferred = int(cfg.PORT) if cfg.PORT.isdigit() else 8080
    port = _find_free_port(preferred)
    if port != preferred:
        logger.info("preferred API port %d busy, binding to %d instead", preferred, port)
    _write_dev_api_port(port)

    logger.info("NoteFlow API listening on http://127.0.0.1:%d", port)
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        log_level="info",
        access_log=False,
    )


if __name__ == "__main__":
    main()
