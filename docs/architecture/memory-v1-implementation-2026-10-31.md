# 记忆系统接入与本机验收

日期：2026-10-31。当前状态：Hindsight 新路径已接入，服务与开发 API 已在本机运行；已有账号保留原模式，用户可在设置启用新记忆库并预览导入。没有批量改写真实用户记忆，也没有部署生产环境。

实现提交：`a0228e0`（后端）、`575798c`（界面）、`c21c20a`（部署、恢复与真实服务验收）、`7e02442`（并行旧 worker 隔离）。

## 使用入口

进入「设置 → AI 与记忆 → 记忆管理」。

1. 原模式会显示「启用自建记忆库」。启用只切换该账号的新读写路径，原记录保留。
2. 「原有记忆 · 导入预览」展示原记录，默认推荐有效且非任务流水的内容；用户逐条确认后提交整理。
3. 「记忆规则」可以修改要求、用隔离样本试运行、查看版本并恢复旧规则。保存后只影响新任务，旧版本队列不会偷偷按新规则重跑。
4. 记录可修改、停用、确认候选或查看来源。彻底删除前展示该来源关联的全部事实并确认；停用仍然可恢复。
5. 「最近处理状态」区分排队、整理、未形成事实、跳过、失败；失败任务可在开关和规则仍匹配时重试。
6. 图谱只展示该账号的有效事实，节点可查看内容与来源，连线不是因果证明。

本机维护者可访问 `http://127.0.0.1:9999` 使用原生 Hindsight 图谱、浏览和检查。这个入口经只读代理阻止 POST / PUT / PATCH / DELETE，修改操作在 NoteFlow 内完成。后台面向本机维护者，不是普通用户跨账号浏览入口。

## 数据与模块边界

- `memory/engine.py` 定义引擎无关事实和能力；`providers/hindsight.py` 负责固定版本 HTTP 转换与安全错误。
- `memory/gateway.py` 负责账号、来源生命周期、幂等、队列、发布检查、修订、删除和图谱过滤；支持构造时注入替代引擎。
- `memory_sources` 只保存来源编号、状态、规则版本、代数和保护标记；正式事实、来源原文与关联保存在 Hindsight。
- Chat / 生成 / 编辑 / 设置的新路径统一进入该边界。提示词装配在 `memory/presentation.py`；新路径不读取旧 UserMemory 来掩盖引擎空结果或故障。
- 旧 Mem0 模式仍作兼容路径，旧索引工厂收拢在 provider registry；旧 ORM 模型没有被整体重写。每个账号只有一个活动模式；切到 Hindsight 后旧索引任务跳过该账号。
- 账号的模式存入服务端 UserSettings，客户端不能指定任意 bank。修改默认环境变量不能直接覆盖已有账号的切换状态。

自动整理使用已有持久 Outbox，每条来源最多自动尝试 3 次，单次最多 8000 字、引擎超时 45 秒。每个用户的变更使用 PostgreSQL 事务锁协调；任务执行时核对开关、模式、规则版本和代数，读取返回前再核对来源与关闭状态。原任务终态不生成长期事实。新记忆 topic 使用独立就绪和租约状态，避免并行旧 worker 误领；对外仍显示等待、整理、成功和失败。

同一 run/request/source 重试不创建第二份来源；完全相同的已有事实会停用重复项并从应用列表隐藏。人工修改后，未来自动新事实先进入待确认并在引擎中失效，单条确认后才能进入回答；明确要求保存的操作仍以真实保存结果确认。语义近似、复杂矛盾和长期知识质量还需持续评测，不宣称已达到自动无误整理。

删除先提交来源删除屏障，再删除引擎来源；即使服务暂时故障，也不会把旧来源继续用于回答，物理清理任务有限重试，失败如实展示。相同的旧迁移来源不能复活。当前彻底删除语义是「来源及其相关事实」，不是把停用包装成删除。

## 固定版本与启动

本机验证 `ghcr.io/vectorize-io/hindsight:1.1.0-slim`，启动脚本固定本机已验证镜像摘要 `sha256:fbc37d194bce007b6cce2fd9f66cd7f8c050bd18b80e662090a92835d9cb191d`。当前实测为 Linux arm64；其他架构需先核对对应固定镜像。

```sh
node scripts/run-python.mjs scripts/start-hindsight.py
```

脚本复用现有 LLM / embedding 配置，将临时凭据文件限制为 0600，启动后删除，不复制密钥到代码或文档。独立数据卷为 `noteflow_hindsight_data`；API 8888 和后台 9999 只绑定本机。启动脚本用于首次启动；已有容器可使用 `docker start noteflow-hindsight`，升级需保留卷并核对镜像，不删除数据卷。

轻量镜像使用外部 embedding 与 RRF 排序，不下载本地大模型；本轮空闲占用约 464 MiB，上限 1.5 GiB。具体负载需继续监测。软件没有平台订阅费，现有模型调用和机器资源仍会消耗。

已经执行 Alembic `20261031_0011` / `0012`，新增来源控制表并隔离新记忆任务状态。当前宿主开发 API 8081 已更新，5173 代理健康。旧 Docker backend/frontend 容器未替换；容器化生产部署需要独立配置服务地址，不能直接使用宿主开发地址。

## 备份与恢复

已有备份增加 Hindsight 数据库。默认检测本机记忆容器；存在时必须成功取得数据库备份，否则整次备份失败。文件清单带校验和，目录限制为 0700；凭据不写入归档。

一致性备份需在维护窗口停下 NoteFlow API / worker，保持数据库与 Hindsight 可用，然后运行：

```sh
node scripts/run-python.mjs scripts/backup_noteflow.py --output /安全目录/本次备份
```

恢复必须使用同一份备份里的 NoteFlow 控制库和 Hindsight 事实库，包含规则、删除屏障与处理状态。恢复工具先校验摘要；Hindsight 备份要求同时指定其恢复目标，避免只恢复一半。工具只允许 `noteflow_drill_*` / `noteflow_restore_*` 隔离数据库；切换服务连接前由维护者核对记录状态，不支持简单切回旧 Mem0 而复活旧数据。

本轮真实恢复到 Hindsight 隔离数据库，验证了事实数、人工修订和停用归档仍存在，随后删除演练库。尚未在生产或全量真实账号上演练整套双数据库切换；这是运维验收边界，不能以本轮合成数据证明生产恢复已完成。

## 验证证据

- 后端 unittest discovery：258 项运行成功，其中 8 项按原测试条件跳过。
- 真实 Hindsight + PostgreSQL + 正式 ASGI API：20 个场景通过，覆盖中文抽取/检索、引用与临时指令、两个账号、来源、修改/停用/恢复、规则版本、图谱、删除、重放、开关队列、人工修订保护、隔离备份恢复。合成账号和库已清理。
- 当前开发 API 的真实 HTTP 会话与 worker：保存、召回、统一上下文通过；短暂停止新记忆容器时，管理读取与显式保存返回 503，Agent 普通聊天仍完成；容器已恢复，合成会话已清理。
- 正式管理组件隔离 Edge：736 / 320px，无横向溢出，规则试运行、历史规则、图谱键盘操作、来源与导入通过；使用正式产品 CSS，未操作真实账号。
- `npm run build`、前端 47 组组件 / 10 项 store 断言、memory-settings 8 项通过；既有 Node 弃用与 bundle 大小提示保留。
- 原生后台代理健康读取 200、写入拒绝 403；当前预览 API 健康。

运行命令：

```sh
node scripts/run-python.mjs -m unittest discover -s server/tests -p 'test_*.py'
node scripts/run-python.mjs server/tests/memory_hindsight_e2e.py
node scripts/run-python.mjs server/tests/memory_hindsight_http_smoke.py --outage
node scripts/memory-console-browser-test.mjs
```

真实服务脚本有模型调用，HTTP outage 选项会短暂停止本机记忆容器；浏览器测试支持仓库既有的 NOTEFLOW_PLAYWRIGHT_MODULE / NOTEFLOW_BROWSER_EXECUTABLE 环境参数。未把这些真实服务脚本混入普通单元测试发现，避免无意调用模型或改动运行服务。

实现依据：[Hindsight 官方源码](https://github.com/vectorize-io/hindsight)、[事实接口](https://hindsight.vectorize.io/developer/api/memories)、[来源生命周期](https://hindsight.vectorize.io/developer/api/documents)。文档可能领先已固定版本，本轮以实际接口验证为准，详见问题 DEV-28。
