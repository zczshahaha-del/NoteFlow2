# NoteFlow

NoteFlow is a personal knowledge-base app with a React frontend, FastAPI backend, PostgreSQL + pgvector persistence, Redis infrastructure, and DeepSeek AI features.

## Product Direction

NoteFlow is being converged into a single workbench after login:

- left: knowledge tree, folders, notes, search, and future recycle-bin entry
- center: official note reading/editing plus future AI draft and edit-preview modes
- right: AI assistant, references, task status, and future execution trace
- avatar menu: profile, preferences, memory management, export, and sign out

Standalone AI generation and settings pages are retained only as migration prototypes. New product work should be folded back into the workbench instead of adding new top-level pages.

## Stack

- React + Vite + Tailwind frontend
- Zustand app state
- TanStack Query auth/session requests
- FastAPI REST/SSE backend
- SQLAlchemy async + PostgreSQL + pgvector user, knowledge-base, and RAG vector storage
- DeepSeek chat model integration via `httpx`
- Redis AI rate limiting
- HttpOnly Cookie authentication with short-lived JWT access tokens and revocable server sessions
- Docker Compose deployment
- Nginx static hosting and `/api` reverse proxy
- LangGraph agent workflows, LlamaIndex RAG v2, and Mem0 OSS long-term memory

## Quality and release

```bash
python3 scripts/quality_gate.py --profile full
python3 scripts/run_release_acceptance.py --base-url http://127.0.0.1:8080
```

These commands validate a release candidate. See [production runbook](docs/operations/production-rollout-runbook.md).

## Engineering Baseline

- The Python backend starts with `cd server && python3 -m app.main`.
- Alembic owns schema initialization and upgrades; application startup runs `alembic upgrade head` after PostgreSQL is ready.
- User IDs are strings and should remain `String(64)` across new backend tables.
- The existing `knowledge_bases` JSON snapshot is retained only for old client-data migration; structured notes are the active data model.

## Docker Deployment

Create Docker env:

```bash
cp server/.env.example server/.env
nano server/.env
```

At minimum, set:

```env
JWT_SECRET=replace_with_a_long_random_secret
ENVIRONMENT=production
AUTH_COOKIE_SECURE=true
DEEPSEEK_API_KEY=your_deepseek_api_key_here
POSTGRES_PASSWORD=replace_with_postgres_password
AI_RATE_LIMIT_PER_MINUTE=30
```

Start the app:

```bash
docker compose up -d --build
```

Open:

```text
http://your-server-ip/
```

## Local Development

Recommended: one script starts the Python API first (tries TCP bind from `PORT` in `server/.env`, default `8080`, then `8081`, `8082`, ... until one works), waits until the API is reachable, then starts Vite. The chosen port is written to `server/.dev-api-port` so the `/api` proxy always matches the backend:

```bash
npm install
npm run dev
```

Split terminals:

```bash
npm run server:dev

npm run dev:vite
```

Backend only:

```bash
cd server
cp .env.example .env
python3 -m app.main
```

Inspect or apply migrations manually:

```bash
cd server
python3 -m alembic -c alembic.ini current
python3 -m alembic -c alembic.ini upgrade head
```

If the browser must call the Python API without the Vite dev proxy, set the real port in `.env.local` at the repo root:

```env
VITE_API_BASE_URL=http://127.0.0.1:8080
```
