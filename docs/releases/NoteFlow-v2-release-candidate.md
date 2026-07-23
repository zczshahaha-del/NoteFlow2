# NoteFlow v2 Release Candidate

## 已具备能力

- React/Tiptap 笔记工作台、目录/文件夹、搜索、附件、版本、软删除与恢复、PWA；
- FastAPI + PostgreSQL/pgvector + Redis，Repository/Service/Provider 分层；
- LangGraph 只读 Agent、草稿子图、编辑子图、Checkpoint、SSE、取消/恢复与幂等；
- LlamaIndex RAG v2：Markdown AST、结构化节点、BM25 + Vector + RRF、可选 Reranker、引用和固定评测；
- Mem0 OSS 长期记忆适配、NoteFlow MemoryPolicy、Shadow、用户级灰度、Outbox 与安全删除；
- 结构化日志、请求/trace/run id、p50/p95、Provider 用量、限流/超时/熔断、备份与恢复演练。

## 已知限制

- 生产默认切换需要真实内部用户和逐档观察，本地验收不能代替；
- Provider 费用只有配置当前单价后才计算美元值，默认 0 只统计调用/token；
- Reranker 默认关闭，必须配置兼容 HTTP endpoint 后灰度；
- Mem0 使用 NoteFlow PostgreSQL 投影作为权限与删除真相源，不允许 Mem0 自主扩大可见范围；
- legacy adapters 在一个完整生产观察周期结束前保留。

## 维护清单

- 每日：Outbox/IndexJob backlog、hard violation、5xx、SSE 中断、Provider 费用；
- 每周：RAG/Memory 固定评测、备份可恢复性抽查、依赖安全更新；
- 每次发布：全量质量门禁、隔离 E2E、数据库备份、灰度门禁、回退演练；
- 观察期后：确认 legacy 流量为 0，归档 tag，再删除迁移适配。
