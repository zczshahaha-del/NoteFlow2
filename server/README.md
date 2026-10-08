# NoteFlow FastAPI 后端

Python API 负责身份认证、AI 编排、基于 Redis 的限流和知识库持久化。

## 工程基线

- 在 `server` 目录中使用 `python3 -m app.main` 启动本地服务。
- Alembic 负责数据库结构初始化和升级；PostgreSQL 可用后，启动流程会应用所有待执行的迁移。
- 用户 ID 使用字符串；新建的用户数据表应继续使用 `String(64)` 外键。
- `knowledge_bases` 表保存兼容旧客户端的 JSON 快照，当前正式数据模型是结构化笔记。
- Redis 启动失败不会阻止 API 启动，但会暂时失去基于 Redis 的限流能力，并记录警告日志。

## 本地运行

需要 Python 3.12，与生产 Docker 镜像保持一致。

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r server/requirements.txt
cp server/.env.example server/.env
npm run server:dev
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
AUTH_EMAIL_WEBHOOK_URL=
SMTP_HOST=
SMTP_PORT=587
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_FROM_EMAIL=
SMTP_USE_SSL=false
SMTP_USE_TLS=true
EMAIL_CODE_TTL_MINUTES=10

DEEPSEEK_API_KEY=your_deepseek_api_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash

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

### DeepSeek 模型切换

当前默认使用 DeepSeek V4.1 Flash，API 模型名为 `deepseek-flash`，不是 `deepseek-v4.1`；对应关系以[官方模型说明](https://api-docs.deepseek.com/quick_start/pricing/)为准。已有实例需将自己的 `server/.env` 中 `DEEPSEEK_MODEL` 改为 `deepseek-flash` 并重启后端；更新代码不会覆盖已有环境变量。有效的原 API Key 可以继续使用，不需要因模型升级更换密钥，真实 `.env` 不应提交 Git。

保留现有思考策略：普通对话未指定时使用提供商默认，笔记生成及已有明确关闭思考的调用继续传 `thinking.type=disabled`。非流式请求仍为 60 秒超时，本次不扩大输出限制，也不添加思考过程 UI。`/api/health` 的 `deepseekModel` 可检查进程加载的模型名，但 `deepseekReady` 仅表示密钥已配置，不代表真实调用成功。部署机和已有 Docker 容器需单独重启 / 重建验证，本机切换不代表远端已更新。

## 认证与安全

身份认证保存在 HttpOnly `noteflow_session` Cookie 中。访问 JWT 默认 30 分钟过期，并且只有服务端会话仍然有效时才能刷新。用户可以在账号菜单中撤销指定会话。

旧版浏览器迁移成功后会清除本机 Bearer Token。有 sid 的凭证必须匹配有效服务端会话；已验证邮箱账号不再接受无 sid 的旧 JWT 访问 / 迁移，需要重新登录。未验证存量用户仍有兼容路径，这不等于所有旧凭证都有一次性迁移保障。

新密码使用 Argon2id。旧 PBKDF2 密码仍可登录，并会在成功登录后自动升级。

邮箱验证码是默认登录方式，登录与注册明确分开。`/api/auth/email-code/request` 用 `purpose=login/register` 分别发码；`/api/auth/register` 只接受邮箱和注册验证码，验证成功才建号，不要求密码。登录不会自动建号；旧邮箱 + 密码注册接口契约已停止，部署时前后端需要一起更新。

旧未验证账号通过邮箱验证码 / 注册验证码 / 邮箱重设证明所有权后，保留原用户 ID 和数据归属，但清除原未验证密码、撤销旧服务端会话，再签发可信会话；已验证账号的正常登录仍保留密码及其它有效会话。无密码账号可通过现有邮箱重设流程设置密码，本轮未增加设置页入口。详见 [实施与验证说明](../design/noteflow-auth-implemented-notes.md)。

验证码邮件优先通过 `AUTH_EMAIL_WEBHOOK_URL` 发送；未配置 Webhook 时可使用标准 SMTP 配置。开发环境未配置投递渠道时会返回开发验证码并由前端自动填入，生产环境不会暴露验证码。

Webhook type 分别为 `email_login_code`、`email_register_code`、`email_change_code`、`password_reset_code`，接收端需支持注册与重设类型。

密码重置复用验证码邮件渠道：用户输入邮箱获取 6 位验证码，再在登录页填写验证码和新密码。验证码只保存 HMAC 哈希、限时且单次有效，完成改密时会注销该账号的现有会话，不依赖前端公网地址。

隔离认证检查不需要 PostgreSQL、真实邮件或现有账号：安装 `server/requirements-test.txt` 后运行 `node scripts/run-python.mjs -m unittest server.tests.test_auth_email_flow server.tests.test_auth_security -v`。SQLite 用于接口 / 事务功能检查，不代替 PostgreSQL 并发验证。性能 / Release / Runtime / Agent live 脚本使用开发验证码兜底后注册，没有返回开发码时明确停止，不支持直接以密码注册；本轮未运行这些业务写入脚本。

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
