### 根本原因
updateTaskStatus 在 failed/completed 时未清除 claimed_by，
watchdog abort 后任务变 failed 但 claimed_by 残留，
后续 failed→queued 重试后仍有 stale claimed_by，
selectNextDispatchableTask 过滤 claimed_by IS NULL 导致任务永远不被派发。

### 下次预防
- [ ] 任何 status 终态转换（failed/completed/canceled）必须清 claimed_by
- [ ] task-updater.js 新增 status 分支时 code review 必查 claimed_by 清除
