# TASK CARD: C1 — tasks 加 claim 语义，防止并行 dispatch 重复

## 任务信息
- **Task ID**: 78adbdad-b97d-46d2-990f-9f947152188a
- **Branch**: cp-0417174200-brain-task-claim
- **优先级**: P0
- **类型**: dev (Brain-only)

## 背景

今天 Brain 至少 3 次把同一任务并行派给多个 agent（如 task 75c0e524 被派给 autonomous 和 headed /dev 同时，产出 #2372 + #2373 重复 PR）。根因：dispatcher 从 queued 选任务 → 标 in_progress 不是原子操作，多 tick 之间可能重复选中同一任务。

## 方案

给 `tasks` 表加 `claimed_by TEXT, claimed_at TIMESTAMPTZ`。
提供 atomic claim：`UPDATE tasks SET claimed_by = $1, claimed_at = NOW() WHERE id = $2 AND claimed_by IS NULL RETURNING id`。
- 返回行 → claim 成功
- 返回空 → 已被别人 claim，409 冲突

## 改动范围

| 文件 | 目的 |
|------|------|
| `packages/brain/migrations/234_add_tasks_claim_columns.sql` | 加 claimed_by + claimed_at 列 |
| `packages/brain/src/tick.js` | dispatch 流程增加 claim 步骤 |
| `packages/brain/src/routes/task-tasks.js` | 新增 POST /:id/claim |
| `packages/brain/src/__tests__/task-tasks-claim.test.js` | claim 冲突单测 |

## DoD

- [BEHAVIOR] 同时 claim 同一 task 两次 → 第二次返回 409
- [BEHAVIOR] dispatcher tick 调 claim 失败（已被 claim）→ 跳过此任务不重复 in_progress
- [ARTIFACT] migration 234 存在且 schema 加了 2 列
- [ARTIFACT] tick.js dispatch 流程加 claim 步骤

## 不做

- 不引入分布式锁（Redis/Consul 等）
- 不改 task status transition 规则
- 不改已合并 PR（只防未来重复）
- 不引 engine 版本 bump（Brain-only）
