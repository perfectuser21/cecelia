# PRD — runHarnessInitiativeRouter 图级并发 invoke 互斥（P1）

## 背景

现场实录（10:48 #3338 merge → auto-version 10:50:39 重启 Brain）：checkpoint 在 merge 节点后、写盘前被截断 → 重启后 startup-sync 把任务 re-queue（resume_from_checkpoint=true）、dispatcher 从 queued 拉起 → 对【同一 thread_id】并发 invoke `runHarnessInitiativeRouter` 各驱动一份图。执行 A 重跑 evaluate（PR 分支已删→FAIL）→ 触发 fix loop 在【已 merge 的 PR】上 spawn generator r2；执行 B 也走到 evaluate 又 spawn 一个 evaluator → 10:57 同 thread 两容器并行。

## 根因

`runHarnessInitiativeRouter`（executor.js，harness-initiative 图的唯一驱动入口，dispatcher 与 startup-sync 都经它 `compiled.stream(input,{thread_id})`）对同一 initiative 的并发 invoke **无互斥**。#3335 的 containerId claim 只挡【容器回调重入】，挡不住【图级并发 invoke】——两条独立触发路径可同时各跑一份图。

## 范围

`packages/brain/src/executor.js`：`runHarnessInitiativeRouter` 对同一 `initiativeId` 加进程内执行锁（Map check-and-set，同 #3335 风格，必须在任何 await 之前以保证原子）。后到的并发 invoke 直接跳过 + log，不抢驱动权。驱动结束（含 return/throw/watchdog 各出口）在 finally 释放锁。

注：#2（startup-sync re-queue 后立即 resume vs dispatcher 派发二选一消冗余）——查证现有代码 `syncOrphanTasksOnStartup` 对 harness 任务**只 re-queue 不自己 resume**，dispatcher 是唯一 resume 路径，无明显冗余 resume 可删；双 invoke 是 claim/tick race，本互斥锁是正确且确定的修法。#3（evaluate 节点在 PR 已 merge 时短路 PASS 而非因分支删 FAIL）是图节点逻辑的独立改动，按「失控就拆开」建议单独 PR，不混入本 PR。

## 成功标准

- 同一 initiative 并发两次 invoke runHarnessInitiativeRouter → 仅一个驱动图、另一个 skipped（reason=already_running），图 stream 只被调一次。
- 锁在驱动结束后释放：同一 initiative 顺序两次 invoke 都能正常跑（不误判 skipped）。
- 既有 runHarnessInitiativeRouter 行为（fresh-start / resume / 坏 checkpoint / watchdog）全部保持。
