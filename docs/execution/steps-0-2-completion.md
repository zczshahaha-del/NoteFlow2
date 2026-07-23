# NoteFlow 步骤 0～2 完成报告

执行日期：2026-07-17（Asia/Shanghai）

## 结论

《NoteFlow 完全体实施执行计划》的步骤 0、1、2 已完成。现有前端 UI 没有重做；本轮建立了可恢复基线、系统事实清单、固定 RAG/Memory 评测集、真实 PostgreSQL + pgvector 集成测试、性能基线和统一质量门禁。

| 步骤 | 状态 | 核心结果 |
|---|---|---|
| 0：执行前保护 | 已完成 | Git、源码快照、数据库 dump、globals 和隔离恢复验证齐全 |
| 1：冻结事实基线 | 已完成 | API、OpenAPI、SSE、数据库、Provider、能力、目录与测试事实已固化 |
| 2：质量门禁 | 已完成 | 固定数据集、数据库集成、RAG/Memory/性能报告和一键全量命令已建立 |

## 步骤 0：保护与恢复

- 新远端：`https://github.com/zczshahaha-del/NoteFlow2.git`
- 架构改造前 Git 基线：`a9fd01024303173ac97fa0b0d29bf7ed72adfd2e`
- 源码快照、PostgreSQL dump 和 globals 均有 SHA-256 校验。
- dump 已恢复到一次性隔离数据库，并核对 27 张表、16 篇笔记、610 个 chunks 和 610 个 embeddings。
- `server/.env`、备份、附件、依赖、构建产物和临时文件均未进入 Git。

完整记录见 `docs/execution/step-0-protection.md`。

## 步骤 1：当前事实基线

`docs/current-baseline/` 已覆盖：

- API 路径、方法、认证、状态码与 OpenAPI JSON。
- SSE 事件、顺序、结束和错误行为。
- SQLAlchemy 模型、真实数据库表、索引、外键、pgvector 与 Alembic revision。
- 前端、后端、worker、RAG、Memory、草稿、编辑预览和 Runtime 能力清单。
- 本机模型 `deepseek-v4-pro` 与代码/容器 fallback `deepseek-chat` 的差异。
- 当前真实状态：意图规划已开启；显式问笔记时 RAG 已开启；Memory 受用户开关控制；LangGraph、LlamaIndex、Mem0 尚未接入。

## 步骤 2：测试与评测体系

### 全量门禁

统一入口：

```bash
npm run test:quality
```

最终套件包含 25 个分类命令：13 个前端组、后端 unittest 与合约检查、4 个 Memory 阶段检查、真实 PostgreSQL/pgvector、固定 RAG、固定 Memory 和生产构建。

- 最终运行 1：25/25 通过，16.213 秒。
- 最终运行 2：25/25 通过，16.531 秒。
- 两次均为 0 个失败，满足连续稳定运行要求。
- 真实数据库套件新增“复用子章节挂到新父章节”的重复索引回归测试。
- 真实 Runtime E2E 已通过：登录、AI SSE/tool trace、索引检索、草稿确认与保存、编辑预览/版本/应用、Memory CRUD、409 冲突和会话刷新。

### RAG legacy 基线

- Recall@5：0.8
- MRR：0.8
- nDCG@5：0.8
- 引用字段覆盖率：1.0
- 无答案准确率：1.0
- 跨用户泄漏：0
- 冷运行检索 p95：4.35 ms；热运行 p95：2.98 ms

当前已登记的检索缺口是中文短问“缓存雪崩怎么办”未命中。它是后续 RAG v2 的对照基线，不在本步骤隐藏或临时调参掩盖。

### Memory legacy 安全基线

- 9 个固定用例中 6 个符合预期。
- 3 个已登记缺口：密码敏感信息拦截、自然语言删除动作、关闭 Memory 动作。
- 非预期失败 0；后续修改不得扩大失败集合，步骤 16～18 必须清零。

### 性能基线

| 指标 | p50 | p95 |
|---|---:|---:|
| Health API | 2.49 ms | 5.76 ms |
| 已认证 Notes API | 4.26 ms | 8.18 ms |
| 检索 API | 8.39 ms | 23.91 ms |
| Worker 索引（无外部 Embedding） | 131.47 ms | 137.10 ms |
| DashScope Embedding | 297.45 ms | 335.16 ms |
| DeepSeek 首文本 token | 1420.04 ms | 1472.70 ms |

本轮是低样本 legacy 数量级基线；并发、持续负载、错误注入和成本验收在步骤 19 执行。

## 本轮发现并修复的问题

1. `server/check_memory_stage2.py` 仍引用已移动的内部函数，已改为从 checkpoint service 引用。
2. Markdown 重复索引在“复用旧子章节、新建父章节”时可能先写入不存在的 `parent_id`，导致外键失败并让任务停留 pending。现改为先无父级落库，再绑定父级，并添加真实数据库回归测试。
3. Runtime E2E 原来硬编码 8080，现支持 `NOTEFLOW_API_URL`，不会干扰已经运行的本地服务。
4. 根目录的独立后端测试入口已补齐 `PYTHONPATH=server`，可直接运行。

## 回滚与下一步

- 文档、评测数据和测试脚本可直接移除，不影响业务数据。
- 索引修复如需回滚，仅需撤销 `markdown_index.py` 的两阶段 flush；但会重新暴露已由回归测试证明的外键问题。
- 数据恢复仍以步骤 0 的快照和隔离恢复流程为准。
- 下一阶段从步骤 3 开始：依赖版本与 PoC 固化，不直接改当前生产路由。
