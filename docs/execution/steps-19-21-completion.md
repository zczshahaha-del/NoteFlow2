# 步骤 19～21 执行记录

## 当前结论

| 步骤 | 状态 | 结论 |
|---|---|---|
| 19：全量验收 | 已完成 | 干净构建、全量门禁、真实 API/E2E、浏览器 UI、压测和恢复均通过 |
| 20：生产灰度 | 工具与门禁完成，等待真实生产观察 | 灰度控制器只读、逐档配置和一键逻辑回退已完成；没有擅自切生产默认 |
| 21：最终清理 | 安全整理完成，破坏性删除待观察期 | 文档、配置、依赖与维护边界已整理；legacy 删除必须在 100% 稳定一个观察周期后执行 |

## 步骤 19 产出

- `quality/reports/steps-19-final.*`：全量质量门禁。
- `quality/reports/steps-19-runtime-e2e.*`：真实 API/AI E2E 结果。
- `quality/reports/steps-19-release-acceptance.*`：并发、多笔记、长笔记、索引、检索 p50/p95 与 Provider 用量。
- `/api/metrics` 现在给出 route/domain p50、p95，并汇总 LLM/Embedding 调用、cache hit、token 和配置单价估算费用。
- 浏览器验收覆盖登录/注册、目录、笔记编辑、AI 助手入口及控制台错误检查。

## 步骤 20 产出

- `scripts/release_rollout.py`：`internal/1/5/20/50/100/observation` 的只读门禁、目标配置、指标快照和回退配置。
- `docs/operations/production-rollout-runbook.md`：发布前、逐档观察、停止扩量、回退和观察期规则。
- RAG 与 Memory Provider 已接到 AI application service；打开新默认不会再让旧 `/api/ai` 端点因无关 Provider flag 直接报错。

生产未连接且没有真实流量观察记录，因此本轮不能诚实宣称步骤 20 的“100% 稳定一个完整观察周期”完成。报告会将其作为外部门槛，而不是伪造 PASS。

## 步骤 21 产出与保留项

已完成：

- 统一环境变量示例、费用统计口径和发布命令；
- 完整灰度/回退/观察/清理手册；
- 最终版本说明、已知限制和维护清单；
- 从干净构建到全量门禁的自动化入口。

故意保留：

- legacy Agent/RAG/Memory adapters；
- Shadow 表与迁移期 flags；
- `knowledge_bases` 兼容快照；
- 数据库 0005～0009 migration 历史。

这些是当前回滚路径，不是可以提前删除的“垃圾代码”。观察期签收后，按手册生成调用图和删除清单，再做最后一次破坏性清理。

## 最终默认值

当前仓库和现有服务继续保持：

```env
AGENT_RUNTIME=legacy
RAG_PROVIDER=legacy
RAG_V2_INDEX_ENABLED=false
MEMORY_PROVIDER=legacy
LANGGRAPH_CANARY_ENABLED=false
LANGGRAPH_CANARY_PERCENT=0
MEM0_CANARY_ENABLED=false
MEM0_CANARY_PERCENT=0
```

这是计划规定的发布安全状态，不代表新架构未实现。
