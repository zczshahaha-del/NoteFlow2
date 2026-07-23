# NoteFlow 步骤 19 真实运行 E2E

- 环境：从空 PostgreSQL 数据库迁移到 `20260717_0009` 的隔离发布候选。
- 结果：`PASS`。
- 默认候选：LangGraph + LlamaIndex/RAG v2 index + Mem0 + LangGraph Draft/Edit。

通过项：Cookie 注册/登录、真实 DeepSeek SSE、工具轨迹、笔记创建与索引、搜索、问笔记 RAG 上下文与来源、草稿创建/确认/组装/保存、编辑预览/修订/应用、Memory CRUD、多设备 409 冲突、session refresh。

本轮首先发现并修复了两个发布阻断：

1. 全新数据库的 0001 adoption baseline 已包含当前模型，0009 重复创建 Mem0 shadow 表/索引；0009 现与 0006～0008 一样支持新库与升级库两条路径。
2. 新 Agent 灰度时未同步打开 `RAG_V2_INDEX_ENABLED`，导致新笔记没有 v2 来源；该开关现已进入全部新架构灰度配置。
