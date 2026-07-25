# NoteFlow 当前能力基线与改造分类

## 分类说明

- **已实现**：当前代码与基线测试均存在，后续必须保持兼容。
- **保留改造**：能力已存在，只调整边界、框架或内部实现。
- **目标新增**：当前没有完整实现，按执行计划后续增加。
- **后续扩展**：不属于本轮完全体的阻塞项。

## 前端与笔记

| 能力 | 当前状态 | 分类 | 事实依据 |
|---|---|---|---|
| 三栏工作台、目录、搜索框、移动端抽屉 | 可用 | 已实现 | `App.tsx`、`AppNav.tsx`、`DirectoryTree.tsx` |
| 分类/文件夹新建、重命名、移动、软删除 | 可用 | 已实现 | notes/categories API、DirectoryTree store actions |
| Markdown 正文编辑 | 可用 | 已实现 | `NoteEditor.tsx`、编辑器 codec 测试 |
| Tiptap 与 Markdown round-trip | 可用，已作为唯一编辑器 | 已实现 | `NoteEditor.tsx`、8 个固定 codec fixtures |
| 代码块编辑、选择、复制、语言切换 | 可用，已有 UI 契约与交互测试 | 已实现 | Tiptap extension、editor UI/selection tests |
| IME 中文输入、选区、离线冲突 | 可用 | 已实现 | input-composition、selection、offline-conflict tests |
| 自动保存、版本、恢复、乐观冲突 | 可用 | 已实现 | notes API、NoteVersion、conflict tests |
| 附件上传/下载/删除 | API 与 UI 已存在；当前数据为 0 | 已实现 | attachments router/service/panel |
| PWA 安装与离线 shell | 可用 | 已实现 | manifest、service worker、PWA test |
| 桌面封装、本地文件夹双向同步 | 未实现 | 后续扩展 | 已有评估文档，不属于当前架构切换 |

## AI、Agent 与写入安全

| 能力 | 当前状态 | 分类 | 事实依据 |
|---|---|---|---|
| 普通对话 | LangGraph 只读执行图，DeepSeek streaming | 已实现 | `/api/agent/chat`、`langgraph_readonly.py` |
| 意图识别 | 强类型 TurnPlan；chat 使用模型 Planner、规则仅容灾、Validator 复核 | 已实现 | `turn_planner.py`、`langgraph_turn.py` |
| 当前笔记问答 | TurnPlan 显式选择当前笔记或选区，由 RAG Service 读取 | 已实现 | `context_sources`、`langgraph_readonly.py` |
| 全库 RAG | 仅用户显式选择 `ask_notes` 时启用 | 已实现 | `knowledge_base` 硬规则 |
| Agent checkpoint/resume/cancel | LangGraph checkpoint 与业务 checkpoint 分层 | 已实现 | PostgreSQL Saver、`agent_checkpoints` |
| LangGraph | 正式运行；TurnPlan、只读回答、草稿和编辑图 | 已实现 | `app/agent` |
| LlamaIndex | RAG v2 唯一服务实现 | 已实现 | `app/rag/v2` |
| 工具轨迹、运行记录 | 已持久化并通过 SSE 输出 | 保留改造 | agent runs/steps/tool traces |
| AI 草稿 | 大纲、分节、后台生成、组装、保存、取消 | 保留改造 | DraftService/Worker/Workspace |
| AI 修改预览 | 创建、修订、版本恢复、应用、取消、冲突校验 | 保留改造 | EditPreviewWorkspace、edits router |
| AI 直接无确认覆盖正式笔记 | 禁止 | 已实现安全边界 | 草稿 save-to-notes 与 edit apply 分离 |

## RAG 与索引

| 能力 | 当前状态 | 分类 |
|---|---|---|
| Markdown 标题解析、section/chunk 落库 | Markdown 分块与增量索引 | 已实现 |
| 增量索引与可重试 worker | 已实现 hash 复用、pending/retry 状态 | 保留改造 |
| 标题检索 | PostgreSQL pg_trgm | 保留改造 |
| 正文/小节检索 | PostgreSQL lexical/pg_trgm | 保留改造 |
| 向量检索 | pgvector + DashScope embedding，配置存在且当前数据已索引 | 保留改造 |
| RRF 合并与去重 | 自研实现 | 保留改造，步骤 11 统一 |
| Query understanding/rewrite | 规则实现 | 保留改造，步骤 11 引入 LlamaIndex 模块 |
| Markdown AST Parser | 未接入，当前是正则 parser | 目标新增 |
| 标准 BM25 检索 | 已接入并与向量检索融合 | 已实现 |
| Reranker | 千问兼容 Reranker，配置后强制启用 | 已实现 |
| 引用来源 | 统一 sources/citation contract | 已实现 |
| RAG 固定评测 | 固定数据集与报告均存在 | 已实现 |

## Memory

| 能力 | 当前状态 | 分类 |
|---|---|---|
| 用户级 memory 开关 | 已有数据库设置与 API | 已实现 |
| 规则/LLM 记忆提取 | 已启用 | 保留改造 |
| 语义、情景、工作等五层概念 | 自研模型已存在 | 保留改造 |
| Memory CRUD、事件审计 | 已实现 | 保留改造 |
| 记忆检索与上下文注入 | 已实现 | 保留改造 |
| Mem0 OSS | 已接入；PostgreSQL 真相源通过 Outbox 同步 | 已实现 |
| 第三方/临时信息过滤 | 规则、LLM extractor 与固定安全评测 | 已实现 |
| 敏感信息统一策略 | 类型化策略、审计和安全删除 | 已实现 |

## 数据、可靠性与运维

| 能力 | 当前状态 | 分类 |
|---|---|---|
| PostgreSQL 业务真相源 | 已实现 | 已实现 |
| pgvector | 0.8.4，HNSW 索引存在 | 已实现 |
| Redis 缓存/限流 | 已实现，可降级为内存 | 保留改造 |
| Alembic | 4 个 revision，当前 `20260715_0004` | 已实现 |
| 结构化日志/metrics/request id | 基础版本已有 | 保留改造 |
| 分布式 trace | 未实现 | 目标新增 |
| Outbox | 未实现 | 目标新增 |
| 双 checkpoint（LangGraph + 业务） | 仅业务 checkpoint 已有 | 目标新增 |
| Feature flags/Shadow 指标 | 尚未系统化 | 目标新增 |
| 异地备份、生产灾备演练 | 未实现 | 目标新增 |

## 必须保持的外部行为

1. 现有前端 UI 不因内部框架迁移而重做。
2. 普通“对话”不会偷偷变成全库搜索；用户选择“全库搜索”才执行全库 RAG。
3. AI 正式写入必须经过草稿保存或修改预览确认。
4. SSE 事件和 `[DONE]` 结束语义在 RuntimeEvent Adapter 切换前后保持兼容。
5. 所有 note/chunk/vector/memory/run 查询继续以 `user_id` 前置过滤。
