# NoteFlow 生产灰度门禁

- 时间：2026-07-17T15:59:36.702400+00:00
- 目标档位：`1`
- 结论：`BLOCKED`
- 检查模式：`真实生产观察`

## 目标配置

```env
AGENT_RUNTIME=langgraph
LANGGRAPH_CANARY_ENABLED=true
LANGGRAPH_CANARY_PERCENT=1
RAG_PROVIDER=legacy
RAG_V2_INDEX_ENABLED=true
MEMORY_PROVIDER=mem0
MEM0_CANARY_ENABLED=true
MEM0_CANARY_PERCENT=1
DRAFT_RUNTIME=legacy
EDIT_RUNTIME=legacy
```

## 指标快照

```json
{
  "agentShadow": {
    "total": 0,
    "hard": 0,
    "failed": 0
  },
  "memoryShadow": {
    "total": 0,
    "hard": 0,
    "failed": 0
  },
  "outbox": {
    "total": 0,
    "pending": 0,
    "failed": 0
  },
  "indexJobs": {
    "total": 2,
    "pending": 0,
    "failed": 0
  },
  "ragQueries": {
    "total": 3,
    "empty": 2,
    "average_latency_ms": 562.67
  }
}
```

## 阻塞项

- agentShadow has fewer than 20 observations in 24h
- memoryShadow has fewer than 20 observations in 24h

## 一键逻辑回退配置

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
