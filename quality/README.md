# NoteFlow 质量门禁与固定评测

## 一键入口

```bash
npm run test:quality
```

该命令按分类执行：

1. 前端编辑器、选区、IME、目录/store、离线冲突和 PWA。
2. 后端 unittest、API/SSE/诊断与 Memory 合约检查。
3. 真实 PostgreSQL + pgvector 结构集成检查。
4. 固定 legacy RAG 评测与跨用户泄漏探针。
5. 固定 Memory 安全集。
6. TypeScript + Vite 生产构建。

快速本地反馈使用：

```bash
npm run test:quality:fast
```

它不连接数据库、不跑固定 RAG，也不做生产构建。

真实 AI Runtime E2E 需要本地 API 已启动且模型 key 可用：

```bash
npm run test:quality:live
```

如果测试服务不在默认的 `http://127.0.0.1:8080`，先指定地址：

```bash
NOTEFLOW_API_URL=http://127.0.0.1:8081 npm run test:quality:live
```

性能基线需要已启动的 API；为了把 worker 调度与外部向量耗时拆开，建议测试服务使用
`EMBEDDING_PROVIDER=none`，脚本会另外直接测量当前 Embedding Provider：

```bash
npm run test:performance-baseline
```

## 评测数据

- `eval/rag_cases.json`：合成固定语料，不包含真实用户笔记。
- `eval/memory_safety_cases.json`：明确记住、临时、第三方、敏感、纠正、删除与关闭。
- `baseline-thresholds.json`：legacy 数值门槛与已登记 Memory 缺口。

## 规则

- 跨用户泄漏永远必须为 0，没有豁免。
- 已登记缺口可以保留到对应实施阶段，但不得增加新的失败 ID。
- 报告写入 `quality/reports/`，步骤 10～12、16～17 继续复用同一数据集做新旧对比。
- 默认 RAG 门禁关闭外部 Embedding，以保证可重复且不产生调用费用；真实向量评测使用 `python3 scripts/run_rag_baseline.py --with-embeddings` 单独执行。
- 性能报告是步骤 2 的 legacy 数量级基线，不是并发容量结论；正式压力测试在步骤 19 执行。
