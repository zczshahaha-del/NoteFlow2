# NoteFlow 质量门禁报告

- Profile：`full`
- 执行时间：2026-07-23T04:54:34.781269+00:00
- 总命令：26
- 通过：24
- 失败：2
- 总耗时：14.559 秒

| 分类 | 检查 | 结果 | 耗时（秒） |
|---|---|---|---:|
| `frontend` | `editor-roundtrip` | 通过 | 0.409 |
| `frontend` | `tiptap-codec` | 通过 | 0.782 |
| `frontend` | `tiptap-selection` | 通过 | 0.52 |
| `frontend` | `editor-compatibility` | 通过 | 0.197 |
| `frontend` | `editor-ui-contract` | 通过 | 0.158 |
| `frontend` | `wiki-links` | 通过 | 0.184 |
| `frontend` | `knowledge-import` | 通过 | 0.2 |
| `frontend` | `markdown-diff` | 通过 | 0.179 |
| `frontend` | `offline-conflict` | 通过 | 0.193 |
| `frontend` | `component-store` | 通过 | 0.865 |
| `frontend` | `pwa` | 通过 | 0.149 |
| `frontend` | `editor-selection` | 通过 | 0.436 |
| `frontend` | `input-composition` | 通过 | 0.193 |
| `backend-unit` | `unittest-discovery` | 失败 | 1.608 |
| `backend-contract` | `context-planner` | 通过 | 0.629 |
| `backend-contract` | `runtime-events` | 通过 | 0.52 |
| `backend-contract` | `diagnostics` | 通过 | 0.21 |
| `backend-memory` | `memory-stage1` | 通过 | 0.5 |
| `backend-memory` | `memory-stage2` | 通过 | 0.495 |
| `backend-memory` | `memory-stage3` | 通过 | 0.498 |
| `backend-memory` | `memory-stage4` | 通过 | 0.498 |
| `database` | `postgres-pgvector-integration` | 失败 | 1.124 |
| `rag` | `legacy-fixed-eval` | 通过 | 0.697 |
| `rag` | `rag-v2-fixed-eval` | 通过 | 0.726 |
| `memory` | `memory-safety-eval` | 通过 | 0.512 |
| `build` | `production-build` | 通过 | 2.072 |

## 失败输出

### backend-unit / unittest-discovery

```text
..........s...s..2026-07-23 12:54:25,643 INFO {"event": "http_request", "request_id": "test-request-1", "trace_id": "c884be114bdd4213bbb5e40b83612129", "method": "GET", "route": "/conflict", "status": 409, "durationMs": 0.21}
2026-07-23 12:54:25,643 INFO HTTP Request: GET http://testserver/conflict "HTTP/1.1 409 Conflict"
..2026-07-23 12:54:25,652 INFO {"event": "http_request", "request_id": "7dcafb8f1cff4ae7a00a405ab4eafac1", "trace_id": "fce0814024b947e5bc645adc44b988e6", "method": "GET", "route": "/ok", "status": 200, "durationMs": 0.15}
2026-07-23 12:54:25,653 INFO HTTP Request: GET http://testserver/ok "HTTP/1.1 200 OK"
.F.......................sssssssss../Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/urllib3/__init__.py:35: NotOpenSSLWarning: urllib3 v2 only supports OpenSSL 1.1.1+, currently the 'ssl' module is compiled with 'LibreSSL 2.8.3'. See: https://github.com/urllib3/urllib3/issues/3020
  warnings.warn(
.......................................................................
======================================================================
FAIL: test_legacy_flags_are_safe_defaults (test_architecture_contracts.ArchitectureContractTest)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/Users/zhangcheng/Desktop/NoteFlow/server/tests/test_architecture_contracts.py", line 42, in test_legacy_flags_are_safe_defaults
    self.assertEqual(cfg.AGENT_RUNTIME, "legacy")
AssertionError: 'langgraph' != 'legacy'
- langgraph
+ legacy


----------------------------------------------------------------------
Ran 126 tests in 0.527s

FAILED (failures=1, skipped=11)
/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/lib/python3.9/asyncio/base_events.py:681: ResourceWarning: unclosed event loop <_UnixSelectorEventLoop running=False closed=False debug=False>
```
### database / postgres-pgvector-integration

```text
./Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/urllib3/__init__.py:35: NotOpenSSLWarning: urllib3 v2 only supports OpenSSL 1.1.1+, currently the 'ssl' module is compiled with 'LibreSSL 2.8.3'. See: https://github.com/urllib3/urllib3/issues/3020
  warnings.warn(
....s..F
======================================================================
FAIL: test_runtime_tables_match_sqlalchemy_metadata (tests.test_database_integration.DatabaseIntegrationTest)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/Users/zhangcheng/Desktop/NoteFlow/server/tests/test_database_integration.py", line 498, in test_runtime_tables_match_sqlalchemy_metadata
    self.assertEqual(self.snapshot["tables"] - {"alembic_version"} - library_owned, set(Base.metadata.tables))
AssertionError: Items in the first set but not the second:
'mem0migrations'
'noteflow_mem0_v1'

----------------------------------------------------------------------
Ran 9 tests in 0.594s

FAILED (failures=1, skipped=1)
/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/lib/python3.9/asyncio/base_events.py:681: ResourceWarning: unclosed event loop <_UnixSelectorEventLoop running=False closed=False debug=False>
```
