# NoteFlow 当前环境与代码清单

## 环境

| 项目 | 当前值 |
|---|---|
| 操作系统 | macOS-26.5.2-arm64-arm-64bit |
| 架构 | arm64 |
| Node | v26.0.0 |
| npm | 11.12.1 |
| Python | 3.9.6 |
| Docker | Docker version 29.4.3, build 055a478 |
| Git | git version 2.50.1 (Apple Git-155) |

## AI Provider（不包含密钥）

| 能力 | 当前本机配置 | 代码/容器默认 |
|---|---|---|
| Chat completion | `https://api.deepseek.com` / `deepseek-v4-pro` | DeepSeek / `deepseek-chat` |
| Embedding | `dashscope` / `text-embedding-v4` | DashScope `text-embedding-v4` |
| Embedding dimensions | `1024` | `1024` |
| Embedding batch | `10` | `10` |
| Database endpoint | `127.0.0.1:5433/noteflow` | Docker PostgreSQL `postgres:5432/noteflow` |
| Redis endpoint | `127.0.0.1:6380` | Docker Redis `redis:6379` |

## 代码清单

| 分组 | 数量 |
|---|---:|
| React TSX 组件 | 14 |
| Store slices | 6 |
| 前端 API services | 12 |
| FastAPI routers | 12 |
| 后端 services | 30 |
| SQLAlchemy model modules | 1 |
| Alembic revisions | 7 |
| Python unit test files | 17 |
| 前端 test/audit scripts | 11 |

## 当前实现状态摘要

- 前端：React/TypeScript、Tiptap/Markdown 双编辑兼容、三栏工作台、AI 面板、草稿与修改预览。
- 后端：主要 Router 已迁移到 Service/Repository；旧业务状态机作为兼容 facade 保留。
- RAG：Markdown 标题/内容/pg_trgm 与可选向量通道已经启用；只有明确的当前笔记或全库搜索意图才调用。
- Intent：`context_planner` 已启用 LLM 规划并带规则 fallback；并非关闭状态。
- Memory：自研五层模型、规则/LLM 提取、用户设置和 CRUD 已启用；Mem0 尚未接入。
- Agent：自研 Router 编排继续作为默认；业务 checkpoint 与 LangGraph 官方 checkpoint 表已语义分离，RuntimeEvent/SSE Adapter/trace 已启用，LangGraph 运行时尚未接入流量。
- Reliability：Outbox、索引任务 claim/heartbeat/崩溃恢复与 RAG 评测/查询日志数据面已建立。
- Draft/Edit：已有持久化草稿、worker、修改预览、确认、取消和版本保护。
