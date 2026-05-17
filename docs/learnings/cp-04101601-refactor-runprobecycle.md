# Learning: 重构 runProbeCycle 降低圈复杂度

**Branch**: cp-04100053-082182a7-ce08-445f-a746-7b289c
**Date**: 2026-04-10

## 任务目标

将 `packages/brain/src/capability-probe.js` 中的 `runProbeCycle` 函数圈复杂度从 22 降至 10 以下。

## 实施方案

将 `runProbeCycle` 拆分为 5 个私有辅助函数：
- `persistProbeResults` — 持久化探针批次结果
- `persistRollbackEvent` — 持久化回滚事件（两处复用）
- `dispatchAutoFixes` — 逐探针派发 auto-fix 任务
- `handleBatchRollback` — 批次失败检测 + 回滚（返回 bool）
- `handleConsecutiveRollback` — 连续失败检测 + 回滚（返回 bool）

重构后 `runProbeCycle` 本体降至约 12 行，分支点 ≤ 6。

### 根本原因

原函数将四大职责（持久化、自动修复派发、批次回滚、连续回滚）内联在同一函数体中，深度嵌套 if/else/try-catch/for 导致复杂度叠加。

### 下次预防

- [ ] 新增 probe 相关功能时，优先作为独立命名函数添加，而不是扩展 runProbeCycle
- [ ] 函数体超过 40 行时触发拆分检查
- [ ] 每次回滚事件写入都走 `persistRollbackEvent`，避免重复 try-catch 逻辑

## 附注：worktree git bare 问题

**问题**：主仓库 `core.bare = true`，导致 worktree 子目录下 `git rev-parse --show-toplevel` 失败，branch-protect.sh hook 报 "不在 git 仓库中"。

**修复**：在 worktree 中运行 `git config core.bare false` 覆盖配置，仅影响当前 worktree。

**根本原因**：主仓库以 `git clone --bare` 方式克隆，`core.bare = true` 被所有 worktree 继承，但 `git rev-parse --show-toplevel` 在 bare 模式下不工作。
