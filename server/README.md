# NoteFlow FastAPI 后端

Python API 负责身份认证、AI 编排、基于 Redis 的限流和知识库持久化。

## 工程基线

- 在 `server` 目录中使用 `python3 -m app.main` 启动本地服务。
- Alembic 负责数据库结构初始化和升级；PostgreSQL 可用后，启动流程会应用所有待执行的迁移。
- 用户 ID 使用字符串；新建的用户数据表应继续使用 `String(64)` 外键。
- `knowledge_bases` 表保存兼容旧客户端的 JSON 快照，当前正式数据模型是结构化笔记。
- Redis 启动失败不会阻止 API 启动，但会暂时失去基于 Redis 的限流能力，并记录警告日志。

## 本地运行

```bash
cd server
cp .env.example .env
python3 -m app.main
```

默认 API 地址：

```text
http://127.0.0.1:8080
```

如果端口已被占用，服务会依次尝试 `8081`、`8082` 等端口，并将最终端口写入当前目录的 `.dev-api-port`，供 Vite 开发代理读取。

## 环境变量

后端密钥和本地配置保存在 `server/.env`。

```env
PORT=8080
CORS_ORIGIN=http://127.0.0.1:5173,http://localhost:5173

DB_HOST=127.0.0.1
DB_PORT=5433
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

REDIS_ADDR=127.0.0.1:6380
REDIS_PASSWORD=
REDIS_DB=0
AI_RATE_LIMIT_PER_MINUTE=30

ATTACHMENT_STORAGE_ROOT=server/data/attachments
ATTACHMENT_MAX_BYTES=10485760
```

## 认证与安全

身份认证保存在 HttpOnly `noteflow_session` Cookie 中。访问 JWT 默认 30 分钟过期，并且只有服务端会话仍然有效时才能刷新。用户可以在账号菜单中撤销指定会话。

旧版浏览器 Bearer Token 只会被 `/api/auth/migrate-legacy-token` 接受一次；迁移为 Cookie 会话后，旧 Token 会从浏览器存储中删除。

新密码使用 Argon2id。旧 PBKDF2 密码仍可登录，并会在成功登录后自动升级。

密码重置通过 `PASSWORD_RESET_WEBHOOK_URL` 发送。开发环境未配置 Webhook 时会在响应中返回一次性 Token；生产环境不会暴露该 Token。

## 数据库迁移

```bash
python3 -m alembic -c alembic.ini heads
python3 -m alembic -c alembic.ini upgrade head
```

Docker 部署使用 `pgvector/pgvector:pg16`，将 `DB_HOST` 改为 `postgres`，并将 `REDIS_ADDR` 改为 `redis:6379`，因此本地开发和 Docker 可以共用同一套代码。

## RAG 与附件

如果 `EMBEDDING_API_KEY` 为空，笔记索引仍会将 Markdown 解析为章节和分块，并将向量状态标记为 `skipped`；检索会退回关键词和结构检索。

配置密钥后，索引会调用 DashScope `text-embedding-v4`，将向量保存到 pgvector `vector(1024)`，混合检索会结合关键词结果与数据库向量相似度。

附件使用与供应商无关的 `ObjectStorage` 接口。默认实现写入 `ATTACHMENT_STORAGE_ROOT`；以后可以替换为 S3、R2 或 OSS，而不需要修改附件路由和编辑器流程。

系统会拒绝包含主动内容的 HTML、SVG 文件，默认单文件上限为 10 MB。
