# NoteFlow 生产灰度与最终交付手册

## 原则

- 发布候选验收不改变生产默认值。
- Agent、RAG、Memory、Draft、Edit 可独立回退，不用破坏性数据库回滚处理普通故障。
- `internal → 1% → 5% → 20% → 50% → 100% → observation` 不得跳档。
- 每档必须使用真实流量观察；本机或 CI 演练不能替代生产观察窗口。
- legacy 至少保留一个完整观察周期。只有证明无生产流量且归档 tag、备份、恢复演练均有效后，才能删除。

## 发布前

1. 保存数据库备份、配置快照和当前镜像 digest。
2. 执行 `python3 scripts/quality_gate.py --profile full`。
3. 在隔离数据库运行 `server/tests/runtime_e2e.py`、`scripts/run_release_acceptance.py`。
4. 核对 `/api/health`、`/api/metrics`、Outbox、IndexJob、Agent Shadow、Memory Shadow。
5. 确认 on-call、告警、回退负责人和观察窗口起止时间。

## 灰度门禁

```bash
python3 scripts/release_rollout.py --stage internal --base-url https://notes.example.com
python3 scripts/release_rollout.py --stage 1 --base-url https://notes.example.com
```

该命令只读数据库和健康接口，生成目标配置与门禁报告；不会修改部署。只有报告 `PASS` 才能由部署系统应用目标配置。

每档至少检查：

- API 5xx、429、p50/p95；
- Agent 首 payload、SSE 中断、取消/恢复、checkpoint 失败；
- RAG 空结果、引用正确性、跨用户 hard violation；
- Mem0 召回 overlap、跨用户 hard violation、删除同步、超时和熔断；
- Outbox/IndexJob pending、failed、stale；
- LLM、Embedding、Reranker、Memory 调用、token 与费用。

生产样本要求：Agent Shadow 与 Memory Shadow 最近 24 小时各至少 20 条、hard violation 为 0、失败率不超过 1%，Outbox 和 IndexJob 无失败项。实际生产可在此基础上设置更严格门槛。

## 回退

```env
AGENT_RUNTIME=legacy
LANGGRAPH_CANARY_ENABLED=false
LANGGRAPH_CANARY_PERCENT=0
RAG_PROVIDER=legacy
RAG_V2_INDEX_ENABLED=false
MEMORY_PROVIDER=legacy
MEM0_CANARY_ENABLED=false
MEM0_CANARY_PERCENT=0
DRAFT_RUNTIME=legacy
EDIT_RUNTIME=legacy
```

先逻辑回退并观察队列收敛，再分析故障。除非 schema 本身不兼容，否则不要紧急 downgrade 数据库。

## 观察期与清理

100% 后记录完整观察周期：版本、时间、样本数、错误率、p95、费用、对账差异、事故。满足全部门禁后才执行步骤 21 的 legacy 删除。删除前：

1. 创建发布 tag/归档分支；
2. 备份数据库和配置；
3. 用调用图与日志证明 legacy 流量为 0；
4. 列出拟删除文件和对应替代路径；
5. 删除后从干净环境重跑 build、全量测试、真实浏览器 E2E 和恢复演练。
