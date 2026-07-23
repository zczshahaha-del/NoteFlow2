# NoteFlow Legacy RAG 固定评测基线

- 数据集：`2026-07-17-v1`
- 检索模式：legacy lexical/pg_trgm/RRF deterministic
- Recall@5：0.8
- MRR：0.8
- nDCG@5：0.8
- 引用字段覆盖率：1.0
- 预期无结果准确率：1.0
- 跨用户泄漏：0
- 冷运行检索 p95：5.18 ms
- 热运行检索 p95：2.6 ms

| 用例 | 结果数 | 目标排名 | Recall@5 | nDCG@5 | 无结果预期 | 泄漏 |
|---|---:|---:|---:|---:|---|---:|
| `zh-short-query` | 0 | - | 0.0 | 0.0 | 否 | 0 |
| `english-acronym` | 2 | 1 | 1.0 | 1.0 | 否 | 0 |
| `code-symbol` | 1 | 1 | 1.0 | 1.0 | 否 | 0 |
| `same-title-current` | 1 | 1 | 1.0 | 1.0 | 否 | 0 |
| `markdown-parser` | 2 | 1 | 1.0 | 1.0 | 否 | 0 |
| `no-answer` | 0 | - | - | - | 是 | 0 |
| `cross-user-probe` | 0 | - | - | - | 是 | 0 |

## 解释

- 本步骤为了可重复性，默认关闭外部 Embedding 请求，只评估当前 legacy 的标题/正文/pg_trgm/RRF 路径。
- `--with-embeddings` 可补充真实 DashScope + pgvector 结果，但外部服务成本和波动不作为步骤 2 的确定性门禁。
- 步骤 10～12 切换 RAG v2 后必须继续使用同一固定语料，并与本报告逐项对比。
