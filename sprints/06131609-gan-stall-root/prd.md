# PRD — GAN 子图容器退出后图静默卡死根治（checkpointer 连接超时硬化）

## 背景

Harness pipeline 反复出现「GAN proposer/reviewer 容器完成后图静默卡死」，一直靠 watchdog
(#3376/#3379) 或人工重发兜底，从未根治。execution_attempts 很快耗尽上限，体验差。

## 真根因（systematic-debugging + 生产 run 4225330d 取证）

证伪了「executeInDocker 的 await 容器退出后不 resolve」假设：
- 生产日志证明 reviewer 容器 `[docker-run] exit code=0` 后紧跟 `[spawn] end exit=0` ——
  executeInDocker **已 return**，`await executor()` **已 resolve**。
- 真正的静默发生在**容器退出之后**：reviewer 节点 executor 返回后 `finally` 立即
  `clearInterval(hbTimer)` 关掉心跳，但后续 LangGraph 的 checkpoint 写入（所有 harness graph
  用 `durability:'sync'`，每个节点转换都同步 await 一次 `PostgresSaver.put`）若卡在一条静默死掉的
  TCP 连接上会**永不 resolve**。
- 旧实现 `PostgresSaver.fromConnString(connStr)` 内部 `new Pool({ connectionString })` ——
  **无 query_timeout / statement_timeout / connectionTimeoutMillis / keepAlive**。一旦连接 wedge，
  checkpoint 写入无限挂起，心跳已停 → 图静默 → 只能等 20min watchdog fresh-start。
- 生产实测：reviewer 07:02:39 干净退出 → **24 分钟零日志** → 07:26:43 watchdog 兜底。
- `getPgCheckpointer()` 是全部 graph（harness-initiative / harness-gan / harness-task /
  dev-task / consciousness / walking-skeleton）的唯一 checkpointer 来源 → 单点修复全覆盖。

## 方案

`getPgCheckpointer()` 改用自建 pg Pool 注入超时构造 PostgresSaver（替代无超时的 fromConnString）：
- `query_timeout`（客户端定时器，连接静默死也强制 reject）
- `statement_timeout`（服务端兜底）
- `connectionTimeoutMillis`（建连有界）
- `keepAlive`（探测死 TCP 连接）

让 checkpoint 写入 await **必然 settle**——成功，或报错走 LangGraph 错误/重试路径让图推进，
不再静默无限挂起靠 watchdog 兜底。**治本，不是再加 watchdog 层。**

## 范围

仅改 `packages/brain/src/orchestrator/pg-checkpointer.js`（新增 buildCheckpointerPool /
buildPgCheckpointer，getPgCheckpointer 改走它）+ 新增 regression test。
不动 GAN graph 节点逻辑、不动 watchdog、不破坏 #3335/#3340/#3356/#3361/#3376/#3379。

## 成功标准

- checkpointer 的 pg pool 注入 query_timeout + statement_timeout + connectionTimeoutMillis + keepAlive。
- 连接不可达时 checkpointer query 在有界时间内 reject，绝不无限挂起。
- 不再使用无超时的 `PostgresSaver.fromConnString`。
- getPgCheckpointer 仍返回可用的 PostgresSaver 单例（setup 幂等），现有 harness graph 回归全绿。
