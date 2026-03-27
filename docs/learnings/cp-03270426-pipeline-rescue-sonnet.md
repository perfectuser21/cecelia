# Learning: 孤儿 Pipeline 诊断 — cp-03262112-sonnet-resets-at

## 背景

Pipeline Patrol 检测到 `cp-03262112-sonnet-resets-at` 分支停留在 `step_3_integrate` 阶段超过 13 分钟，进程已死，触发 pipeline_rescue 任务（Brain task: `a7f20065-f62f-4b45-8932-4073e2b7ed64`）。

## 诊断结果

**结论**：无需恢复，功能已由并行 agent 通过 PR #1604 完成并合并到 main。

**具体发现**：
- 分支 `cp-03262112-sonnet-resets-at` 本地和远程均不存在（已被清理）
- 原始 Brain 任务 `a89152fe-65f0-4fba-a541-e1debd73d331` 已不存在
- `.dev-mode` 显示 `step_2_code: done`、`code_review_gate_status: pass`，但 `step_3_integrate: pending`（代码从未 push 到远程）
- 功能 `seven_day_sonnet_resets_at` 已在 main 中：
  - `packages/brain/migrations/200_account_usage_sonnet_resets.sql`
  - `packages/brain/src/account-usage.js`（含 upsert/select/fallback 三处字段）

### 根本原因

两个 agent 并行处理同一功能任务（`account_usage_cache` 新增 `seven_day_sonnet_resets_at`）。速度较慢的 agent 完成 step_2_code 后进程死亡（stop hook 循环中断），worktree 被后续任务复用，代码丢失，形成孤儿 pipeline。

### 下次预防

- [ ] Brain 任务派发前检查同功能是否已有活跃 pipeline，避免重复派发相同功能
- [ ] Worktree 复用前应检查是否有未 push 的 `.dev-mode` 文件（`step_3_integrate` 或 `step_4_ship` 为 pending），有则先处理孤儿 pipeline
- [ ] Pipeline Patrol 在触发 rescue 前，先比对孤儿分支的功能描述与最近 PR 是否重叠，若已交付则直接标记 completed 跳过 rescue
