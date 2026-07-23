# NoteFlow 步骤 10～12 完成报告

执行日期：2026-07-17（Asia/Shanghai）

## 结论

RAG v2 的索引、权限前置混合召回、Reranker、Context、引用和评测链路已经完成。主库现有 5 篇有效笔记已建立 701 个结构化节点和 701 个真实向量，全部处于 indexed 状态；生产回答仍保持 `RAG_PROVIDER=legacy`。

| 步骤 | 状态 | 结果 |
|---|---|---|
| 10：索引基础 | 已完成 | CommonMark AST、稳定 Node、LlamaIndex adapter、增量重建、source fencing、诊断与后台任务 |
| 11：混合检索 | 已完成 | Title/BM25/Vector 并行、权限前置、加权 RRF、中文/代码 tokenizer、缓存与 trace |
| 12：上线质量 | 已完成 | 可插拔 Reranker、超时回退、Context budget、稳定 citation、引用校验、固定评测 |

## 关键实现

- `app/rag/v2/parser.py`：CommonMark AST、结构化块、原子代码/表格/列表、400～800 token 分块和 LlamaIndex `TextNode` 适配。
- `app/rag/v2/indexer.py`：独立 v2 IndexJob、content hash 增量复用、两次 source-version fencing 和原子可见指针。
- `app/rag/v2/retrieval.py`：Title、`bm25s + jieba`、pgvector HNSW、独立通道降级、加权 RRF、权限 trace 和 BM25 score cache。
- `app/rag/v2/reranker.py`：通用 HTTP Reranker Provider，覆盖成功、超时、异常和无配置回退。
- `app/rag/v2/context.py`：token budget、section 多样性、稳定 citation id、无来源严格提示和引用编号校验。
- `app/rag/v2/service.py`：LlamaIndex RAG facade 与 `rag_query_logs` 在线指标。
- Alembic `20260717_0007`：新增三个可独立清理的 RAG v2 派生表和 pgvector HNSW 索引。

## 依赖决策

- 正式镜像使用 `llama-index-core 0.14.23`、`markdown-it-py 4.2.0`、`bm25s 0.3.9`、`jieba-py 0.46.12`。
- Pydantic 统一至隔离 PoC 已验证的 `2.13.4`，解决 LlamaIndex workflow 对 `>=2.11.5` 的要求。
- 未把 `llama-index-retrievers-bm25` 放入正式 slim 镜像：其英文 PyStemmer 在 ARM64 需要源码编译和 GCC，而 NoteFlow 中文通道实际直接使用 `bm25s + jieba`。LlamaIndex 负责 Node/模块适配，检索数据和权限仍由 NoteFlow 管理。

## 数据与迁移验证

- 临时库完成 base→0007、0007→0006、0006→0007；验证库已删除。
- 主库 revision 为 `20260717_0007`。
- 有效笔记 5、indexed states 5、active nodes 701、indexed embeddings 701。
- missing state、stale state、node pointer mismatch、failed embedding、failed v2 job 均为 0。
- 单个 section 修改时未变化 section 复用 node id，变化 section 生成新 node，旧 node 失效。
- 索引期间正文变化时旧任务稳定取消，不能覆盖新 source version。

## 权限与检索验证

- Title、BM25、Vector SQL 均在召回阶段前置 user/deleted/current source version 过滤。
- 使用本地构造向量走完整 pgvector SQL 验证，跨用户私密节点不可见，没有再次外发数据。
- 固定集覆盖中文短查询、英文缩写、代码符号、同名笔记、Markdown parser、无答案和跨用户探针。
- 锁定 Python 3.12 镜像中的 LlamaIndex `TextNode` 和真实 bm25s API 已运行通过。

## 固定评测

| 指标 | Legacy | RAG v2 |
|---|---:|---:|
| Recall@5 | 0.8 | 1.0 |
| MRR | 0.8 | 1.0 |
| nDCG@5 | 0.8 | 1.0 |
| 引用字段覆盖率 | 1.0 | 1.0 |
| 无答案准确率 | 1.0 | 1.0 |
| 跨用户泄漏 | 0 | 0 |

报告见 `quality/reports/rag-v2-eval.*`。

## 测试

- RAG v2 专项单元测试：10/10 通过。
- 后端默认 unittest：93 tests，85 通过，8 个真实数据库测试默认跳过。
- 真实 PostgreSQL/pgvector 集成：8/8 通过。
- 固定 RAG v2 评测：通过，显著不劣于 legacy。
- Python 3.12 锁定依赖镜像：构建通过。
- 最终全量质量门禁：26/26 通过，报告见 `quality/reports/steps-10-12-final.*`。

## 默认与回滚

- `RAG_PROVIDER=legacy`
- `RAG_V2_INDEX_ENABLED=false`
- `RAG_RERANK_ENABLED=false`

当前服务不会因为本步骤自动切换回答路径。关闭各子功能或保持 legacy 即可回滚；数据库 downgrade 0007 只删除 RAG v2 派生表。

## 下一步

按计划进入步骤 13～15：只读 Agent/RAG 灰度切换、AI 草稿子图和编辑子图。步骤 13 开始前应先确定内部灰度用户和自动回退阈值。
