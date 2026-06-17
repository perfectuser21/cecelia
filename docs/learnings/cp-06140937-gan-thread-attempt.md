# Learning — GAN 子图 thread_id + proposer 分支按 attempt 版本化（fresh-start 自愈）

分支: cp-06140937-gan-thread-attempt
日期: 2026-06-14

### 根本原因

生产 run 4225330d（#3380 复盘遗留①）：父图 thread 版本化（`harness-initiative:id:attemptN`），
但 GAN 子图 thread 用裸 `String(taskId)`，proposer 分支只按 `round+taskId` 命名。父图 fresh-start
（watchdog/坏 checkpoint，attemptN 递增）时：
1. GAN 子图复用同一裸 thread 的旧 checkpoint（非干净重跑）；
2. proposer 分支名与上一代相同 → B59-idem 幂等门发现「合同已存在」→ 每轮跳过 spawn，proposer 从不产新合同。

**fresh-start 机制本是用来「从坏状态恢复」的，却因 GAN 状态 + proposer 分支钉死在裸 taskId（不带代际）
而结构性失效**：重跑了但永远复用同一批坏产物，无法自愈，反复烧 execution_attempts。
这是「反复靠兜底从未根治」的一个深层原因——恢复机制本身被设计缺陷废掉了。

### 修复

GAN 代际对齐父图 fresh-start 代际（attemptN = tasks.execution_attempts；fresh-start 时 executor.js
先 UPDATE execution_attempts 再 stream，故 runGanLoopNode 读到的是当前代际，同 attempt 内含 restart 不变）：
- GAN 子图 thread_id = `${taskId}:gan:${attemptN}`；
- proposer 分支 = `cp-harness-propose-r${round}-${id8}-a${attemptN}`。
每代干净 thread + 独立分支 → fresh-start 真重跑、产新合同、自愈；同 attempt 内稳定可 resume，B59-idem 在 attempt 内仍幂等。

### 下次预防

- [ ] 子图/子流程的 checkpoint thread_id 必须与父流程的 fresh-start 代际对齐（带 attempt/generation），
      否则父 fresh-start 时子流程复用旧状态，恢复机制结构性失效（重跑 = 复用旧坏产物）。
- [ ] 幂等门（如 B59-idem 按分支名跳过 spawn）的 key 必须含代际，否则跨 fresh-start 误复用上一代产物。
      幂等应「同一代内幂等」，不是「跨代复用」。
- [ ] 改 proposer 分支命名时，确认所有清理/查询用通配 `cp-harness-propose-*`（不靠精确格式重构分支名）。
