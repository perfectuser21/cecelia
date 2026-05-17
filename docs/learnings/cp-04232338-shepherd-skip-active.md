# Learning: shepherd/quarantine 跳过活跃任务

**分支**：cp-04232338-shepherd-skip-active
**日期**：2026-04-23

## 现象

Initiative `2303a935-3082-41d9-895e-42551b1c5cc4` 每次被起来（Planner / Proposer / Generator）就立刻被 shepherd 标记 `status='quarantined'`、`reason='repeated_failure'`、`failure_count=12`。当前 run 不受影响（docker socket 已经 spawn），但下次 dispatch 会被 `status='quarantined'` 过滤阻止，导致手动 reset status 为 queued 多次。

## 根本原因

`packages/brain/src/quarantine.js` 的 `handleTaskFailure()` 在每个 tick 被 `tick.js` 的 `autoFailTimedOutTasks()` 调用，路径是：

1. `tick.js:1459` 扫 in_progress 任务 elapsed > `DISPATCH_TIMEOUT_MINUTES`(60 min)
2. → `handleTaskFailure(task.id)` 累加 `failure_count`
3. → `checkShouldQuarantine` → `shouldQuarantineOnFailure` (failure_count >= 3)
4. → `quarantineTask(reason='repeated_failure')`

`handleTaskFailure` 只看 tasks 表历史字段（`retry_count` / `payload.failure_count` / `error_details`），**不看**：

- LangGraph `checkpoints` 表里是否有该 task 的 `thread_id` 活跃行
- docker container 是否仍在跑

Initiative 级 task 的 pipeline 运行时间经常超过 60 min（research → copywriting → generate → export 全链），每次 tick 超时+1，快速累加到 quarantine 阈值。

## 修复

在 `handleTaskFailure` 最前面加"活跃信号守卫"：

```js
const isActive = await hasActiveCheckpoint(taskId);
if (isActive) {
  return { quarantined: false, failure_count: 0, skipped_active: true };
}
```

`hasActiveCheckpoint` 查 `SELECT 1 FROM checkpoints WHERE thread_id = $1::text LIMIT 1`。任意行存在即视为活跃（MVP 策略，不加时间窗过滤）。查询失败或表缺失时安全返回 false 走原逻辑。

## 下次预防

- [ ] 未来新增"活跃信号"源（docker ps / run_events.heartbeat_ts / executor 注册表）时，统一封装到 `hasActiveCheckpoint` 或并列 helper，不要在 tick 里直接查
- [ ] 给 `checkpoints` 表加 `created_at` / `updated_at` 列，支持按时间窗过滤（`ACTIVE_CHECKPOINT_WINDOW_MINUTES` 已预留常量）
- [ ] shepherd PR tick（gh CLI）和 tick.js timeout tick 的 quarantine 判定应走同一个 helper（未来重构）

## 涉及文件

- `packages/brain/src/quarantine.js`
- `packages/brain/src/__tests__/quarantine-skip-active-checkpoint.test.js`
- `packages/brain/src/__tests__/quarantine-block.test.js`（mock 更新）
- `packages/brain/src/__tests__/quarantine-billing-pause.test.js`（mock 更新）
- `packages/brain/src/__tests__/quota-exhausted.test.js`（mock 更新，已被 vitest excluded）
- `packages/brain/src/__tests__/quota-exhausted-no-quarantine.test.js`（mock 更新，已被 vitest excluded）
