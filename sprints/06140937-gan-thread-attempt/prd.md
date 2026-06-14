# PRD — GAN 子图 thread_id + proposer 分支按 attempt 版本化（fresh-start 自愈）

## 背景

生产 run 4225330d 取证（#3380 复盘遗留①）：
- 父图 thread 是版本化的 `harness-initiative:${id}:${attemptN}`；但 GAN 子图 thread 用裸 `String(taskId)`。
- proposer 每轮 push 的分支只按 `round+taskId` 命名（`cp-harness-propose-r{N}-{id8}`）。

父图 fresh-start（watchdog / 坏 checkpoint，attemptN 递增）时：
1. GAN 子图复用同一裸 thread 的旧 checkpoint —— 不是干净重跑。
2. proposer 分支名与上一代相同 → B59-idem 幂等门发现「合同已存在」→ 每轮跳过 spawn，
   proposer 从不产新合同（日志可见每轮「proposer round N 合同已存在…跳过重 spawn」）。

结果：fresh-start 空转、无法自愈，反复重跑 planner 烧穿 execution_attempts。

## 方案

把 GAN 代际对齐父图 fresh-start 代际（attemptN，取自 `tasks.execution_attempts`，
executor.js fresh-start 时先 UPDATE 再 stream，故 runGanLoopNode 读到的是当前代际）：
- GAN 子图 thread_id = `${taskId}:gan:${attemptN}`（替代裸 taskId）。
- proposer 分支 = `cp-harness-propose-r${round}-${id8}-a${attemptN}`。

每个 attempt 拿干净 GAN thread + 独立 proposer 分支 → fresh-start 真正重跑、proposer 产新合同、自愈。
同一 attempt 内（含 brain restart resume，execution_attempts 不变）thread/分支稳定 → 仍正确 resume，
B59-idem 幂等仍在 attempt 内生效。通配 `cp-harness-propose-*` 的清理/查询不受后缀影响。

## 范围

仅改 packages/brain/src/workflows/harness-gan.graph.js（ganThreadIdFor / proposeBranchFor / proposer /
runGanContractGraph）+ harness-initiative.graph.js（runGanLoopNode 读 execution_attempts 传 attemptN）+ 测试。
不改 watchdog / dbUpsert / B59-idem 幂等逻辑本身。

## 成功标准

- GAN 子图 thread_id 带 attemptN（`${taskId}:gan:${attemptN}`），不同 attempt 不同 thread，同 attempt 稳定。
- proposer 分支带 `-a${attemptN}`，不同 attempt 不同分支（B59-idem 不跨 attempt 复用旧合同）。
- runGanLoopNode 从 tasks.execution_attempts 读 attemptN（读失败 fallback 0，不阻断）。
- 既有 GAN 测试（含 B59-idem 幂等）回归通过；幂等审计 12/12。
