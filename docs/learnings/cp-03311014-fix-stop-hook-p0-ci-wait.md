# Learning: fix-stop-hook-p0-ci-wait

## 背景

stop.sh 有 p0/p1 两段阶段逻辑，p0 在 PR 创建后立即 exit 0，导致 CI 从未被检查。

## 根本原因

p0 阶段的设计初衷是"PR 刚推出去，等下次 session 再检查 CI"，但实现为 exit 0（允许退出）。正确行为应该是 exit 2（阻止退出，继续等 CI）。这导致 I3/I4 等任务创建 PR 后直接结束，没有自动修复 CI 失败的循环。

## 修复方案

删除 p0 分支的提前退出逻辑，统一所有阶段在 PR 创建后检查 CI：
- CI pending/queued → exit 2（继续等）
- CI fail → exit 2（继续修）
- CI pass → exit 0（真正完成）

## 教训

**PR 创建 ≠ 任务完成**。Stop Hook 的唯一合法 exit 0 是 CI 全绿（或 PR 已合并）。任何在 CI 检查之前的 exit 0 都是错误的。

## 附带修复

metrics.test.ts 时间窗口测试在月末（如 3 月 31 日）失败：`setMonth(getMonth() - 1)` 不先 setDate(1)，导致 2 月 31 日溢出到 3 月 3 日。修复：先 `setDate(1)` 再 `setMonth(-1)` 避免月末溢出。
