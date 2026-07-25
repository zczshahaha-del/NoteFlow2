# NoteFlow RAG v2 固定评测

- 数据集：`2026-07-17-v1`
- Recall@5：1.0（门槛 0.8）
- MRR：1.0（门槛 0.8）
- nDCG@5：1.0（门槛 0.8）
- 引用字段覆盖率：1.0
- 预期无结果准确率：1.0
- 跨用户泄漏：0
- 质量门禁：通过
- 冷运行 p95：23.86 ms
- 热运行 p95：2.94 ms

| 用例 | 结果数 | 目标排名 | Recall@5 | nDCG@5 | 无结果预期 | 泄漏 |
|---|---:|---:|---:|---:|---|---:|
| `zh-short-query` | 1 | 1 | 1.0 | 1.0 | 否 | 0 |
| `english-acronym` | 3 | 1 | 1.0 | 1.0 | 否 | 0 |
| `code-symbol` | 1 | 1 | 1.0 | 1.0 | 否 | 0 |
| `same-title-current` | 1 | 1 | 1.0 | 1.0 | 否 | 0 |
| `markdown-parser` | 2 | 1 | 1.0 | 1.0 | 否 | 0 |
| `no-answer` | 0 | - | - | - | 是 | 0 |
| `cross-user-probe` | 0 | - | - | - | 是 | 0 |

## 运行边界

- 评测数据为固定测试语料，运行结束后用户、笔记、节点、向量和任务全部级联清理。
- 默认关闭外部 Embedding，确定性验证 Title + BM25 + RRF；`--with-embeddings` 才调用真实向量服务。
- 每个通道在 SQL 取数阶段先应用 user_id、deleted 和当前 source_version 过滤。
