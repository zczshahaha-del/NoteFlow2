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
| Tiptap pilot 与 Markdown round-trip | 可用 | 保留改造 | `TiptapPilotEditor.tsx`、8 个固定 codec fixtures |
| 代码块编辑、选择、复制、语言切换 | 可用，已有 UI 契约与交互测试 | 已实现 | Tiptap extension、editor UI/selection tests |
| IME 中文输入、选区、离线冲突 | 可用 | 已实现 | input-composition、selection、offline-conflict tests |
| 自动保存、版本、恢复、乐观冲突 | 可用 | 已实现 | notes API、NoteVersion、conflict tests |
| 附件上传/下载/删除 | API 与 UI 已存在；当前数据为 0 | 已实现 | attachments router/service/panel |
| PWA 安装与离线 shell | 可用 | 已实现 | manifest、service worker、PWA test |
| 桌面封装、本地文件夹双向同步 | 未实现 | 后续扩展 | 已有评估文档，不属于当前架构切换 |

## AI、Agent 与写入安全

| 能力 | 当前状态 | 分类 | 事实依据 |
|---|---|---|---|
| 普通对话 | 自研 Router 编排，DeepSeek streaming | 保留改造 | `/api/agent/chat` |
| 意图识别 | **已开启**；LLM planner + 规则 fallback | 保留改造 | `context_planner.py` |
| 当前笔记问答 | 明确意图时读取选区/未保存正文/笔记索引 | 保留改造 | `build_note_context` |
| 全库 RAG | **已开启但不会自动泛化触发**；仅显式全库搜索模式/意图调用 | 保留改造 | `note_search` 与 visible mode policy |
| Agent checkpoint/resume/cancel | 业务 checkpoint 已实现 | 保留改造 | `agent_checkpoints`、Agent API |
| LangGraph | 未接入 | 目标新增 | 步骤 8～15 |
| LlamaIndex | 未接入 | 目标新增 | 步骤 10～12 |
| 工具轨迹、运行记录 | 已持久化并通过 SSE 输出 | 保留改造 | agent runs/steps/tool traces |
| AI 草稿 | 大纲、分节、后台生成、组装、保存、取消 | 保留改造 | DraftService/Worker/Workspace |
| AI 修改预览 | 创建、修订、版本恢复、应用、取消、冲突校验 | 保留改造 | EditPreviewWorkspace、edits router |
| AI 直接无确认覆盖正式笔记 | 禁止 | 已实现安全边界 | 草稿 save-to-notes 与 edit apply 分离 |

## RAG 与索引

| 能力 | 当前状态 | 分类 |
|---|---|---|
| Markdown 标题解析、section/chunk 落库 | 正则标题解析，固定字符 chunk | 保留改造 |
| 增量索引与可重试 worker | 已实现 hash 复用、pending/retry 状态 | 保留改造 |
| 标题检索 | PostgreSQL pg_trgm | 保留改造 |
| 正文/小节检索 | PostgreSQL lexical/pg_trgm | 保留改造 |
| 向量检索 | pgvector + DashScope embedding，配置存在且当前数据已索引 | 保留改造 |
| RRF 合并与去重 | 自研实现 | 保留改造，步骤 11 统一 |
| Query understanding/rewrite | 规则实现 | 保留改造，步骤 11 引入 LlamaIndex 模块 |
| Markdown AST Parser | 未接入，当前是正则 parser | 目标新增 |
| 标准 BM25 库 | 未接入，当前不是正式 BM25 库 | 目标新增 |
| Reranker | 未接入 | 目标新增 |
| 引用来源 | 当前已有 context sources；缺少统一 citation contract | 保留改造 |
| RAG 固定评测 | 当前只有单元级 evaluator；步骤 2 补固定集和报告 | 保留改造 |

## Memory

| 能力 | 当前状态 | 分类 |
|---|---|---|
| 用户级 memory 开关 | 已有数据库设置与 API | 已实现 |
| 规则/LLM 记忆提取 | 已启用 | 保留改造 |
| 语义、情景、工作等五层概念 | 自研模型已存在 | 保留改造 |
| Memory CRUD、事件审计 | 已实现 | 保留改造 |
| 记忆检索与上下文注入 | 已实现 | 保留改造 |
| Mem0 OSS | 未接入 | 目标新增 |
| 第三方/临时信息过滤 | 规则与 prompt 已有，尚需固定安全评测 | 保留改造 |
| 敏感信息统一策略 | 尚无完整类型化策略 | 目标新增，步骤 16～18 |

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
