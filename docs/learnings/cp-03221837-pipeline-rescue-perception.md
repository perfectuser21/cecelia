---
branch: cp-03221837-33f6520d-80e9-4191-9583-29b239
date: 2026-03-23
type: pipeline_rescue
original_task: 0ba02ac2-a1d4-48e0-986c-db18e86c744a
---

# Pipeline Rescue: runPerception 重构代码未 Ship

## 根本原因

原 pipeline（`cp-03221804-0ba02ac2`）在 step_2_code 完成后 worktree 消失，
代码未能 push/merge 进入 main。Brain 任务被错误标记为 `completed`，
但实际代码并未上线。Pipeline Patrol 在 23 分钟后检测到超时。

## 救援过程

1. 诊断：worktree 不存在，分支有本地 commit，无 PR，无远端分支
2. 原任务在 Brain 已标记 `completed`（时间：2026-03-22 20:04）
3. Cherry-pick 原分支 commit（`ce5886598`）到救援分支
4. 创建 PRD/DoD，验证 DoD Test，push PR

## 变更内容

将 `runPerception`（圈复杂度 67）拆分为 13 个独立 `async collectXxx` 子函数，
主函数通过 `Promise.all` 并行执行后聚合 observations，圈复杂度降至约 2。

## 下次预防

- [ ] Pipeline Patrol 检测到 worktree 消失时应立即触发 rescue，而非等待超时
- [ ] 任务 `completed` 状态更新应验证是否已有对应 PR/commit 在远端，否则降级为 `shipped_partial`
- [ ] Step 3 push 失败时应重试或告警，不能静默结束并标记任务完成
