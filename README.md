# NoteFlow

NoteFlow 是一款个人知识库应用，采用 React 前端、FastAPI 后端、PostgreSQL + pgvector 持久化存储和 Redis 基础设施，并集成了 DeepSeek AI 能力。

## 产品方向

NoteFlow 正在统一为登录后的单一工作台：

- 左侧：知识树、文件夹、笔记、搜索，以及后续的回收站入口
- 中间：正式笔记的阅读与编辑，以及后续的 AI 草稿和修改预览模式
- 右侧：AI 助手、引用来源、任务状态，以及后续的执行轨迹
- 头像菜单：个人资料、偏好设置、记忆管理、导出和退出登录

独立的 AI 生成页和设置页仅作为迁移原型保留。新的产品功能应整合回工作台，不再新增顶层页面。

## 技术栈

- React + Vite + Tailwind 前端
- Zustand 应用状态管理
- TanStack Query 认证与会话请求
- FastAPI REST/SSE 后端
- SQLAlchemy 异步访问 PostgreSQL，并使用 pgvector 存储用户、知识库和 RAG 向量数据
- 通过 `httpx` 集成 DeepSeek 对话模型
- Redis AI 请求限流
- HttpOnly Cookie 认证、短期 JWT 访问令牌和可撤销的服务端会话
- Docker Compose 部署
- Nginx 静态资源托管和 `/api` 反向代理
- LangGraph Agent 工作流、LlamaIndex RAG 和 Mem0 OSS 长期记忆

## 质量检查与发布

```bash
python3 scripts/quality_gate.py --profile full
python3 scripts/run_release_acceptance.py --base-url http://127.0.0.1:8080
```

以上命令用于验证候选发布版本。具体操作请参阅[生产发布运行手册](docs/operations/production-rollout-runbook.md)。

## 工程基线

- Python 后端通过 `cd server && python3 -m app.main` 启动。
- Alembic 负责数据库结构的初始化和升级；PostgreSQL 就绪后，应用启动流程会执行 `alembic upgrade head`。
- 用户 ID 使用字符串，新建后端数据表时应继续保持为 `String(64)`。
- 现有的 `knowledge_bases` JSON 快照仅用于迁移旧客户端数据；当前生效的数据模型是结构化笔记。

## Docker 部署

创建 Docker 环境配置：

```bash
cp server/.env.example server/.env
nano server/.env
```

至少需要配置：

```env
JWT_SECRET=replace_with_a_long_random_secret
ENVIRONMENT=production
AUTH_COOKIE_SECURE=true
DEEPSEEK_API_KEY=your_deepseek_api_key_here
POSTGRES_PASSWORD=replace_with_postgres_password
AI_RATE_LIMIT_PER_MINUTE=30
```

启动应用：

```bash
docker compose up -d --build
```

访问：

```text
http://your-server-ip/
```

## 本地开发

推荐方式：使用一个脚本先启动 Python API。脚本会从 `server/.env` 中的 `PORT` 开始尝试绑定 TCP 端口，默认依次尝试 `8080`、`8081`、`8082`……直到找到可用端口。确认 API 可访问后，脚本再启动 Vite。最终选中的端口会写入 `server/.dev-api-port`，确保 `/api` 代理始终指向正确的后端端口：

```bash
npm install
npm run dev
```

分别使用两个终端启动：

```bash
npm run server:dev

npm run dev:vite
```

仅启动后端：

```bash
cd server
cp .env.example .env
python3 -m app.main
```

手动检查或执行数据库迁移：

```bash
cd server
python3 -m alembic -c alembic.ini current
python3 -m alembic -c alembic.ini upgrade head
```

如果浏览器不通过 Vite 开发代理直接调用 Python API，请在仓库根目录的 `.env.local` 中配置真实端口：

```env
VITE_API_BASE_URL=http://127.0.0.1:8080
```
