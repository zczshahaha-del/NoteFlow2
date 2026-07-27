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
| Store selectors | 6 |
| 前端 API services | 13 |
| FastAPI routers | 12 |
| 通用后端 services | 25 |
| Memory 领域模块 | 9 |
| RAG 领域模块 | 8 |
| SQLAlchemy model modules | 1 |
| Alembic revisions | 9 |
| Python unit test files | 25 |
| 前端 test/audit scripts | 11 |

## 当前实现状态摘要

- 前端：React/TypeScript、Tiptap/Markdown 双编辑兼容、三栏工作台、AI 面板、草稿与修改预览。
- 后端：主要 Router 已迁移到 Service/Repository，AI 运行时只保留正式实现。
- RAG：LlamaIndex RAG、BM25/向量融合、引用与可选 Qwen Reranker 已成为唯一检索链路。
- Intent：`context_planner` 已启用 LLM 规划并带规则 fallback；并非关闭状态。
- Memory：五层记忆规则、用户设置与 CRUD 继续作为安全真相层，相关性检索和同步固定使用 Mem0。
- Agent：LangGraph 是唯一运行时；业务 checkpoint 与 LangGraph checkpoint 表语义分离，RuntimeEvent/SSE Adapter/trace 已启用。
- Reliability：Outbox、索引任务 claim/heartbeat/崩溃恢复与 RAG 评测/查询日志数据面已建立。
- Draft/Edit：LangGraph 草稿图和修改图负责持久化状态流转，并保留 worker、确认、取消和版本保护。
