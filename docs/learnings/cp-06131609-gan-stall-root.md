# Learning — GAN 容器退出后图静默卡死根治（checkpointer 连接超时硬化）

分支: cp-06131609-gan-stall-root
日期: 2026-06-13

### 根本原因

反复出现「GAN proposer/reviewer 容器完成后图静默卡死」，长期靠 watchdog(#3376/#3379)/人工重发
兜底，从未根治。systematic-debugging + 生产 run 4225330d 取证后定位真根因：

1. **证伪了流行假设**「executeInDocker 的 await 容器退出后不 resolve」。生产日志铁证：reviewer 容器
   `[docker-run] exit code=0` 紧跟 `[spawn] end exit=0` —— executeInDocker 已 return，
   `await executor()` 已 resolve。卡死发生在**容器退出之后**。
2. 真根因：所有 harness graph 用 `durability:'sync'`，每个节点转换都同步 await 一次 checkpoint
   写入（`PostgresSaver.put`）。`PostgresSaver.fromConnString(connStr)` 内部
   `new Pool({ connectionString })` —— **无 query_timeout / statement_timeout /
   connectionTimeoutMillis / keepAlive**。容器退出后心跳已被 `finally clearInterval(hbTimer)` 清掉，
   若 checkpoint 写入卡在一条静默死掉的 TCP 连接上，`put()` 永不 resolve → 图静默 →
   只能等 20min watchdog fresh-start。生产实测 reviewer 07:02:39 干净退出 → **24min 零日志** →
   07:26:43 watchdog 兜底，且 fresh-start 被 B59-idem 旧分支复用毒化，永不自愈。
3. **反复靠兜底 = 根因没治**。大家盯容器（干净退出）和 watchdog（兜底），从没人盯**容器「完成信号」
   之后的 checkpoint 写入链**——那才是无限挂起点。容器完成信号链必须可靠 settle，否则任何下游
   IO/DB await 静默挂起都会被误当成「容器卡住」。

### 修复

`getPgCheckpointer()`（全部 graph 唯一 checkpointer 来源 → 单点全覆盖）改用自建 pg Pool 注入超时
构造 PostgresSaver：`query_timeout`（客户端定时器，连接静默死也强制 reject，关键）+
`statement_timeout`（服务端）+ `connectionTimeoutMillis` + `keepAlive`。让 checkpoint await 必然
settle——成功，或报错走 LangGraph 错误/重试路径让图推进，不再静默无限挂起。治本，非再加 watchdog。

### 下次预防

- [ ] 任何 `durability:'sync'` 节点链上的 DB/IO await 必须有界（timeout），不得依赖底层连接「正常会返回」。
- [ ] 凡新建 pg Pool（尤其跨容器/跨网段连接），默认带 query_timeout + connectionTimeoutMillis + keepAlive。
- [ ] 排查「容器完成后卡住」先看容器退出之后的 await 链（checkpoint 写入/文件读/下游 DB），
      不要只盯容器与 watchdog；`[spawn] end` 日志 = executor 已返回，卡点在其后。
- [ ] 反复需要 watchdog/人工兜底的现象 = 根因没治的信号，必须 systematic-debugging 找真根因而非加兜底层。

### 遗留（本 PR 不含，已向 team-lead 报告作后续）

- GAN 子图 thread_id = 裸 taskId（不带 attempt 版本），与父图 `harness-initiative:id:attemptN` 不一致 →
  父图 fresh-start 时 GAN 复用旧 thread；叠加 proposer B59-idem 分支按 round+taskId 命名复用旧合同 →
  fresh-start 无法自愈，空转烧 execution_attempts。
- inferTaskPlan 产出空 tasks → dbUpsert `taskPlan.tasks required` → 非 terminal error 触发 fresh-start 循环。
