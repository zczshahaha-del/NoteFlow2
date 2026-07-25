# NoteFlow 步骤 19 最终发布候选门禁

结论：`PASS`；高严重缺陷：`0`；生产默认未切换。

| 门禁 | 结果 |
|---|---|
| 后端干净镜像构建 | 通过 |
| 前端 `npm ci` + production build | 通过，0 vulnerabilities |
| 前端合同/组件/PWA | 13/13 通过 |
| 后端单元与合同 | 107 项通过，9 项按条件跳过 |
| PostgreSQL/pgvector/Repository | 9/9 通过 |
| legacy 真实 API/AI E2E | 通过 |
| 100% 新架构真实 API/AI/问笔记 E2E | 通过 |
| 真实浏览器工作台 E2E | 通过，控制台 0 error |
| RAG legacy | Recall@5/MRR/nDCG=0.8，跨用户泄露 0 |
| RAG v2 | Recall@5/MRR/nDCG=1.0，跨用户泄露 0，非劣 |
| Memory 安全集 | 12/12 |
| 并发、长笔记、索引、检索与成本 | 通过，见 `steps-19-release-acceptance.md` |
| 进程重启与迁移幂等 | 通过 |
| 备份恢复、Provider/Redis 降级与安全 | 通过，见 `steps-16-18-resilience-drill.md` |

发布候选具备进入内部灰度的工程条件。真实生产 1% 门禁仍按计划要求 Agent/Memory Shadow 最近 24 小时各至少 20 条；当前没有生产目标与观察数据，因此步骤 20 不得自动扩量。
