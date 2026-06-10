# PRD: 外层 subgraph deadline liveness 感知（#3330 补完）

## 背景

PR #3330 修了 `_waitForSubGraphCompletion` 内层 callback 超时的 liveness 感知（soft
timeout + hard ceiling + kill），但外层 `while (Date.now() < deadline)` 仍是旧行为：

- 外层 deadline（SUBGRAPH_WAIT_MS=90min）< 内层 soft timeout（100min from spawnedAt），
  首轮驱动中内层 liveness 感知根本轮不到——跑超 90min 的活 generator 仍被外层砍头。
- deadline 到期直接返回 status channel 默认值 `'queued'` → Serial gate 报
  "did not merge (status=queued)"（06-08 b249b808 实证失败模式）。
- 放弃时不 kill 容器，留活孤儿烧配额。
- 死亡分支 resume 失败时同样透传 'queued'（同根因）。

## 方案

外层循环改 `while (true)`，deadline 到期时先验活性：
- running 且未到 hard ceiling（CALLBACK_HARD_CEILING_MS）→ 延长等待；
- running 但超 hard ceiling → `_killContainer`（codex guard 内置）+ resume
  failed('callback_hard_ceiling')，与内层同语义；
- 已死/非 await_callback → 返回 failed（'queued' 钉死为 failed）。
死亡分支的 'queued' 透传一并修复。

## 成功标准

- 三条新 regression test 全绿（延长等待 / 死亡不透传 queued / 超 hard ceiling kill）
- workflows 套件无回归
- CI 全绿
