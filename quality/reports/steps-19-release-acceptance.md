# NoteFlow 步骤 19 发布候选压测与成本统计

- 结果：`PASS`
- 笔记：20；长笔记：114007 字符；并发：8

| 指标 | 样本 | p50 | p95 | 最大 |
|---|---:|---:|---:|---:|
| `createNote` | 20 | 3.29 ms | 6.94 ms | 11.06 ms |
| `index` | 21 | 226.9 ms | 342.58 ms | 3762.14 ms |
| `search` | 20 | 250.2 ms | 277.81 ms | 300.23 ms |
| `concurrentList` | 60 | 16.36 ms | 81.25 ms | 83.36 ms |
| `longNote` | 1 | 17.54 ms | 17.54 ms | 17.54 ms |

## Provider token / 调用 / 费用

```json
{
  "deepseek.completion": {
    "calls": 2,
    "cacheHits": 0,
    "failures": 0,
    "inputTokens": 1748,
    "outputTokens": 1060,
    "estimatedCostUsd": 0.0
  },
  "deepseek.chat": {
    "calls": 1,
    "cacheHits": 0,
    "failures": 0,
    "inputTokens": 435,
    "outputTokens": 3,
    "estimatedCostUsd": 0.0
  },
  "dashscope.embedding": {
    "calls": 53,
    "cacheHits": 0,
    "failures": 0,
    "inputTokens": 62996,
    "outputTokens": 0,
    "estimatedCostUsd": 0.0
  }
}
```

费用为环境变量单价 × 实际/估算 token；单价为 0 时只统计用量，不虚构供应商费用。
