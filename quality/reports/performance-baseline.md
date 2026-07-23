# NoteFlow 性能基线

执行时间：2026-07-17T08:13:28.573613+00:00

| 指标 | 样本 | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| `healthApi` | 9 | 2.49 ms | 5.76 ms | 2.28 ms | 5.76 ms |
| `authenticatedNotesApi` | 9 | 4.26 ms | 8.18 ms | 3.59 ms | 8.18 ms |
| `retrievalApi` | 9 | 8.39 ms | 23.91 ms | 7.39 ms | 23.91 ms |
| `workerIndexWithoutEmbedding` | 3 | 131.47 ms | 137.1 ms | 122.25 ms | 137.1 ms |
| `embeddingExternal` | 3 | 297.45 ms | 335.16 ms | 265.1 ms | 335.16 ms |
| `firstTokenExternal` | 3 | 1420.04 ms | 1472.7 ms | 1400.03 ms | 1472.7 ms |

## 口径

- `healthApi`：包含 PostgreSQL/Redis 诊断的 `/api/health` 往返时间。
- `authenticatedNotesApi`：登录后 `/api/notes` 往返时间。
- `retrievalApi`：固定测试笔记的 `/api/notes/search` 往返时间。
- `workerIndexWithoutEmbedding`：API 创建笔记后到索引任务 success，测试服务使用 `EMBEDDING_PROVIDER=none`。
- `embeddingExternal`：直接调用当前 DashScope `text-embedding-v4` 单文本请求。
- `firstTokenExternal`：直接 Chat SSE 从发起请求到首个文本 token，使用当前 DeepSeek 模型。
- 当前样本用于冻结 legacy 数量级，不代表生产容量压测；步骤 19 再执行并发与长时间压测。
