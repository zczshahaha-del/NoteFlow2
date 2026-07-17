# NoteFlow FastAPI Backend

The Python API owns authentication, AI orchestration, Redis-backed rate limiting, and knowledge-base persistence.

## Baseline Notes

- Local startup is `python3 -m app.main` from the `server` directory.
- Alembic owns schema initialization and upgrades. Startup applies all pending revisions after PostgreSQL becomes reachable.
- User IDs are string identifiers and new user-owned tables should use `String(64)` foreign keys.
- The `knowledge_bases` table stores the current JSON snapshot and stays as a compatibility layer until the structured note migration is complete.
- Redis is optional at startup; if it is unavailable, the API logs a warning and continues without Redis-backed rate limiting.

## Local Run

```bash
cd server
cp .env.example .env
python3 -m app.main
```

Default API base:

```text
http://127.0.0.1:8080
```

If that port is already in use, the server binds the next free port (`8081`, `8082`, …) and logs the change. The chosen port is written to `.dev-api-port` in this directory for the Vite dev proxy.

## Environment

Put backend-only secrets in `server/.env`.

```env
PORT=8080
CORS_ORIGIN=http://127.0.0.1:5173,http://localhost:5173

DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=noteflow
DB_PASSWORD=noteflow_password
DB_NAME=noteflow

JWT_SECRET=replace_with_a_long_random_secret
ENVIRONMENT=development
AUTH_COOKIE_SECURE=false
AUTH_ACCESS_TTL_MINUTES=30
AUTH_SESSION_TTL_DAYS=7
LOGIN_RATE_LIMIT_PER_5_MINUTES=12
FRONTEND_BASE_URL=http://127.0.0.1:5173
PASSWORD_RESET_WEBHOOK_URL=
PASSWORD_RESET_TTL_MINUTES=30

DEEPSEEK_API_KEY=your_deepseek_api_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat

EMBEDDING_PROVIDER=dashscope
EMBEDDING_API_KEY=your_dashscope_api_key_here
EMBEDDING_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
EMBEDDING_MODEL=text-embedding-v4
EMBEDDING_DIMENSIONS=1024
EMBEDDING_BATCH_SIZE=10

REDIS_ADDR=127.0.0.1:6379
REDIS_PASSWORD=
REDIS_DB=0
AI_RATE_LIMIT_PER_MINUTE=30

ATTACHMENT_STORAGE_ROOT=server/data/attachments
ATTACHMENT_MAX_BYTES=10485760
```

Authentication is stored in an HttpOnly `noteflow_session` Cookie. Access JWTs expire after 30 minutes and are refreshed only while the corresponding server-side session is active. The account menu can revoke individual sessions. Existing browser Bearer tokens are accepted once by `/api/auth/migrate-legacy-token`, converted to a Cookie session, and then deleted from browser storage.

New passwords use Argon2id. Existing PBKDF2 hashes remain valid and are upgraded automatically after a successful login. Password-reset delivery uses `PASSWORD_RESET_WEBHOOK_URL`; development mode returns the one-time token in the response when no webhook is configured, while production never exposes it.

Migration commands:

```bash
python3 -m alembic -c alembic.ini heads
python3 -m alembic -c alembic.ini upgrade head
```

The Docker deployment uses the `pgvector/pgvector:pg16` image, overrides `DB_HOST` to `postgres`, and sets `REDIS_ADDR` to `redis:6379`, so local development and Docker can share the same code.

If `EMBEDDING_API_KEY` is empty, note indexing still parses Markdown into sections/chunks and marks embedding rows as `skipped`; search falls back to the existing keyword/structure retrieval path. When the key is configured, indexing calls DashScope `text-embedding-v4`, stores vectors in pgvector `vector(1024)`, and hybrid search combines keyword results with database-side vector similarity.

Attachments use the provider-neutral `ObjectStorage` interface. The default adapter writes to `ATTACHMENT_STORAGE_ROOT`; an S3/R2/OSS adapter can replace it without changing the attachment routes or editor workflow. Active HTML and SVG uploads are rejected, and the default per-file limit is 10 MB.
