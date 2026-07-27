# NoteFlow 质量门禁报告

- Profile：`full`
- 执行时间：2026-07-23T04:54:05.207313+00:00
- 总命令：26
- 通过：22
- 失败：4
- 总耗时：14.286 秒

| 分类 | 检查 | 结果 | 耗时（秒） |
|---|---|---|---:|
| `frontend` | `editor-roundtrip` | 通过 | 0.591 |
| `frontend` | `tiptap-codec` | 通过 | 0.876 |
| `frontend` | `tiptap-selection` | 通过 | 0.551 |
| `frontend` | `editor-compatibility` | 通过 | 0.265 |
| `frontend` | `editor-ui-contract` | 通过 | 0.208 |
| `frontend` | `wiki-links` | 通过 | 0.223 |
| `frontend` | `knowledge-import` | 通过 | 0.251 |
| `frontend` | `markdown-diff` | 通过 | 0.285 |
| `frontend` | `offline-conflict` | 通过 | 0.251 |
| `frontend` | `component-store` | 通过 | 0.845 |
| `frontend` | `pwa` | 通过 | 0.213 |
| `frontend` | `editor-selection` | 通过 | 0.488 |
| `frontend` | `input-composition` | 通过 | 0.232 |
| `backend-unit` | `unittest-discovery` | 失败 | 1.638 |
| `backend-contract` | `context-planner` | 通过 | 0.525 |
| `backend-contract` | `runtime-events` | 通过 | 0.511 |
| `backend-contract` | `diagnostics` | 通过 | 0.21 |
| `backend-memory` | `memory-stage1` | 通过 | 0.504 |
| `backend-memory` | `memory-stage2` | 通过 | 0.509 |
| `backend-memory` | `memory-stage3` | 通过 | 0.513 |
| `backend-memory` | `memory-stage4` | 通过 | 0.519 |
| `database` | `postgres-pgvector-integration` | 失败 | 0.507 |
| `rag` | `legacy-fixed-eval` | 失败 | 0.517 |
| `rag` | `rag-v2-fixed-eval` | 失败 | 0.525 |
| `memory` | `memory-safety-eval` | 通过 | 0.476 |
| `build` | `production-build` | 通过 | 2.052 |

## 失败输出

### backend-unit / unittest-discovery

```text
..........s...s..2026-07-23 12:53:57,181 INFO {"event": "http_request", "request_id": "test-request-1", "trace_id": "68a7c8d81fba40fb904ad7d6da95fd09", "method": "GET", "route": "/conflict", "status": 409, "durationMs": 0.2}
2026-07-23 12:53:57,181 INFO HTTP Request: GET http://testserver/conflict "HTTP/1.1 409 Conflict"
..2026-07-23 12:53:57,191 INFO {"event": "http_request", "request_id": "a322e336d8724f1ab0c0e4d5f04839cb", "trace_id": "7066001d0809492bba87c81259c64145", "method": "GET", "route": "/ok", "status": 200, "durationMs": 0.16}
2026-07-23 12:53:57,191 INFO HTTP Request: GET http://testserver/ok "HTTP/1.1 200 OK"
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
Ran 126 tests in 0.564s

FAILED (failures=1, skipped=11)
/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/lib/python3.9/asyncio/base_events.py:681: ResourceWarning: unclosed event loop <_UnixSelectorEventLoop running=False closed=False debug=False>
```

### database / postgres-pgvector-integration

```text
E
======================================================================
ERROR: setUpClass (tests.test_database_integration.DatabaseIntegrationTest)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/Users/zhangcheng/Desktop/NoteFlow/server/tests/test_database_integration.py", line 494, in setUpClass
    cls.snapshot = asyncio.run(_database_snapshot())
  File "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/lib/python3.9/asyncio/runners.py", line 44, in run
    return loop.run_until_complete(main)
  File "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/lib/python3.9/asyncio/base_events.py", line 642, in run_until_complete
    return future.result()
  File "/Users/zhangcheng/Desktop/NoteFlow/server/tests/test_database_integration.py", line 66, in _database_snapshot
    connection = await asyncpg.connect(
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/asyncpg/connection.py", line 2421, in connect
    return await connect_utils._connect(
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/asyncpg/connect_utils.py", line 1075, in _connect
    raise last_error or exceptions.TargetServerAttributeNotMatched(
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/asyncpg/connect_utils.py", line 1049, in _connect
    conn = await _connect_addr(
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/asyncpg/connect_utils.py", line 886, in _connect_addr
    return await __connect_addr(params, True, *args)
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/asyncpg/connect_utils.py", line 931, in __connect_addr
    tr, pr = await connector
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/asyncpg/connect_utils.py", line 802, in _create_ssl_connection
    tr, pr = await loop.create_connection(
  File "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/lib/python3.9/asyncio/base_events.py", line 1056, in create_connection
    raise exceptions[0]
  File "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/lib/python3.9/asyncio/base_events.py", line 1041, in create_connection
    sock = await self._connect_sock(
  File "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/lib/python3.9/asyncio/base_events.py", line 955, in _connect_sock
    await self.sock_connect(sock, address)
  File "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/lib/python3.9/asyncio/selector_events.py", line 502, in sock_connect
    return await fut
  File "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/lib/python3.9/asyncio/selector_events.py", line 507, in _sock_connect
    sock.connect(address)
PermissionError: [Errno 1] Operation not permitted

----------------------------------------------------------------------
Ran 0 tests in 0.006s

FAILED (errors=1)
```

### rag / legacy-fixed-eval

```text
anghelpers.py", line 146, in __exit__
    raise exc_value.with_traceback(exc_tb)
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/sqlalchemy/pool/impl.py", line 177, in _do_get
    return self._create_connection()
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/sqlalchemy/pool/base.py", line 390, in _create_connection
    return _ConnectionRecord(self)
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/sqlalchemy/pool/base.py", line 674, in __init__
    self.__connect()
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/sqlalchemy/pool/base.py", line 901, in __connect
    pool.logger.debug("Error on connect(): %s", e)
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/sqlalchemy/util/langhelpers.py", line 146, in __exit__
    raise exc_value.with_traceback(exc_tb)
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/sqlalchemy/pool/base.py", line 896, in __connect
    self.dbapi_connection = connection = pool._invoke_creator(self)
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/sqlalchemy/engine/create.py", line 643, in connect
    return dialect.connect(*cargs, **cparams)
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/sqlalchemy/engine/default.py", line 621, in connect
    return self.loaded_dbapi.connect(*cargs, **cparams)
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/sqlalchemy/dialects/postgresql/asyncpg.py", line 949, in connect
    await_only(creator_fn(*arg, **kw)),
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/sqlalchemy/util/_concurrency_py3k.py", line 132, in await_only
    return current.parent.switch(awaitable)  # type: ignore[no-any-return,attr-defined] # noqa: E501
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/sqlalchemy/util/_concurrency_py3k.py", line 196, in greenlet_spawn
    value = await result
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/asyncpg/connection.py", line 2421, in connect
    return await connect_utils._connect(
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/asyncpg/connect_utils.py", line 1075, in _connect
    raise last_error or exceptions.TargetServerAttributeNotMatched(
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/asyncpg/connect_utils.py", line 1049, in _connect
    conn = await _connect_addr(
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/asyncpg/connect_utils.py", line 886, in _connect_addr
    return await __connect_addr(params, True, *args)
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/asyncpg/connect_utils.py", line 931, in __connect_addr
    tr, pr = await connector
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/asyncpg/connect_utils.py", line 802, in _create_ssl_connection
    tr, pr = await loop.create_connection(
  File "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/lib/python3.9/asyncio/base_events.py", line 1056, in create_connection
    raise exceptions[0]
  File "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/lib/python3.9/asyncio/base_events.py", line 1041, in create_connection
    sock = await self._connect_sock(
  File "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/lib/python3.9/asyncio/base_events.py", line 955, in _connect_sock
    await self.sock_connect(sock, address)
  File "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/lib/python3.9/asyncio/selector_events.py", line 502, in sock_connect
    return await fut
  File "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/lib/python3.9/asyncio/selector_events.py", line 507, in _sock_connect
    sock.connect(address)
PermissionError: [Errno 1] Operation not permitted
```
### rag / rag-v2-fixed-eval

```text
anghelpers.py", line 146, in __exit__
    raise exc_value.with_traceback(exc_tb)
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/sqlalchemy/pool/impl.py", line 177, in _do_get
    return self._create_connection()
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/sqlalchemy/pool/base.py", line 390, in _create_connection
    return _ConnectionRecord(self)
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/sqlalchemy/pool/base.py", line 674, in __init__
    self.__connect()
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/sqlalchemy/pool/base.py", line 901, in __connect
    pool.logger.debug("Error on connect(): %s", e)
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/sqlalchemy/util/langhelpers.py", line 146, in __exit__
    raise exc_value.with_traceback(exc_tb)
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/sqlalchemy/pool/base.py", line 896, in __connect
    self.dbapi_connection = connection = pool._invoke_creator(self)
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/sqlalchemy/engine/create.py", line 643, in connect
    return dialect.connect(*cargs, **cparams)
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/sqlalchemy/engine/default.py", line 621, in connect
    return self.loaded_dbapi.connect(*cargs, **cparams)
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/sqlalchemy/dialects/postgresql/asyncpg.py", line 949, in connect
    await_only(creator_fn(*arg, **kw)),
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/sqlalchemy/util/_concurrency_py3k.py", line 132, in await_only
    return current.parent.switch(awaitable)  # type: ignore[no-any-return,attr-defined] # noqa: E501
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/sqlalchemy/util/_concurrency_py3k.py", line 196, in greenlet_spawn
    value = await result
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/asyncpg/connection.py", line 2421, in connect
    return await connect_utils._connect(
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/asyncpg/connect_utils.py", line 1075, in _connect
    raise last_error or exceptions.TargetServerAttributeNotMatched(
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/asyncpg/connect_utils.py", line 1049, in _connect
    conn = await _connect_addr(
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/asyncpg/connect_utils.py", line 886, in _connect_addr
    return await __connect_addr(params, True, *args)
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/asyncpg/connect_utils.py", line 931, in __connect_addr
    tr, pr = await connector
  File "/Users/zhangcheng/Library/Python/3.9/lib/python/site-packages/asyncpg/connect_utils.py", line 802, in _create_ssl_connection
    tr, pr = await loop.create_connection(
  File "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/lib/python3.9/asyncio/base_events.py", line 1056, in create_connection
    raise exceptions[0]
  File "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/lib/python3.9/asyncio/base_events.py", line 1041, in create_connection
    sock = await self._connect_sock(
  File "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/lib/python3.9/asyncio/base_events.py", line 955, in _connect_sock
    await self.sock_connect(sock, address)
  File "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/lib/python3.9/asyncio/selector_events.py", line 502, in sock_connect
    return await fut
  File "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/lib/python3.9/asyncio/selector_events.py", line 507, in _sock_connect
    sock.connect(address)
PermissionError: [Errno 1] Operation not permitted
```
