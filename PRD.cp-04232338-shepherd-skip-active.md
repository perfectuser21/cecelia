# PRD: shepherd/quarantine 跳过活跃任务

**分支**：cp-04232338-shepherd-skip-active
**日期**：2026-04-23

## 背景

Cecelia Brain 的 shepherd / quarantine 路径在每个 tick 扫描历史失败次数达阈值的任务并标记 `status='quarantined'`。具体路径：

- `tick.js` 的 `autoFailTimedOutTasks()` 扫 in_progress 任务，超过 `DISPATCH_TIMEOUT_MINUTES`（默认 60 分钟）调 `handleTaskFailure()`
- `handleTaskFailure()` 累加 `failure_count` → `shouldQuarantineOnFailure()` 返回 true（>=3）→ `quarantineTask(reason='repeated_failure')`

问题：**活跃任务被误判隔离**。Initiative `2303a935-3082-41d9-895e-42551b1c5cc4` 今晚出现 failure_count=12、payload.quarantine_info.reason='repeated_failure'。实际对应的 docker 容器和 LangGraph pipeline 正在跑，`checkpoints` 表里有实时写入的 checkpoint 行。当前 run 不受影响，但下次 dispatch 会被 `status='quarantined'` 过滤拦截。

## 根因

`handleTaskFailure` 只看 tasks 表历史 `retry_count` / `payload.failure_count` / `error_details`，不看：

1. `checkpoints` 表里是否有该 task 的活跃 thread_id（LangGraph 执行信号）
2. docker container 是否仍在跑

## 修复范围

在 `handleTaskFailure` 入口加"活跃信号守卫"：

- 新增 `hasActiveCheckpoint(taskId)` 查 `checkpoints WHERE thread_id = $1::text`
- 有行 → 直接返回 `{ quarantined: false, skipped_active: true }`，不计入失败、不隔离
- 无行或查询异常 → 走原逻辑

MVP 策略：只要 checkpoints 表有该 task 的任意行就认为活跃（无时间窗过滤）。当天任务不会误排老任务，后续若数据积压可加 `ACTIVE_CHECKPOINT_WINDOW_MINUTES` 过滤（已预留常量）。

## 成功标准

1. 新测试文件 `quarantine-skip-active-checkpoint.test.js` 验证活跃任务被跳过
2. 已有的 quarantine-block / quarantine-billing-pause 测试更新 mock 保持通过
3. 真实场景：Initiative 2303a935 重新跑起来不会再被立刻打 quarantined
