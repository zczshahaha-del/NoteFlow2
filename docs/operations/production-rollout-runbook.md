# NoteFlow 生产发布与恢复手册

## 当前运行架构

- Agent：LangGraph
- RAG：LlamaIndex RAG v2
- Memory：Mem0 + NoteFlow 权限与安全投影
- Draft/Edit：LangGraph 持久化子图

项目不再提供旧 AI 运行时或按比例灰度开关。

## 发布前

1. 备份 PostgreSQL、附件和部署配置。
2. 执行 `python3 scripts/quality_gate.py --profile full`。
3. 执行 `python3 scripts/run_release_acceptance.py --base-url <候选环境地址>`。
4. 检查 `/api/health`、`/api/metrics`、Outbox 和 IndexJob。
5. 验证聊天、全库检索、草稿生成、AI 修改和记忆读取。

## 发布观察

- 检查 API 5xx、429、p50/p95 和 SSE 中断率。
- 检查 LangGraph checkpoint 暂停、恢复和失败情况。
- 检查 RAG 空结果、引用正确性和跨用户隔离。
- 检查 Mem0 召回、删除同步、超时和 Outbox 堆积。
- 检查 LLM、Embedding、Reranker 的调用量、token 和费用。

## 故障恢复

新框架故障时返回受控错误，不会静默切换到旧流程。

1. 暂停新写入或将服务切为维护状态。
2. 保留日志、trace、checkpoint、Outbox 和 IndexJob 现场。
3. 修复配置或外部 Provider 后重新执行健康检查和专项测试。
4. 如需紧急恢复服务，部署上一个已验证的镜像版本。
5. 只有数据库结构或数据损坏时才使用备份恢复；普通 AI 故障不要回滚数据库。
