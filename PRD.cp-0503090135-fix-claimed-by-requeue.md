# PRD: revert-to-queued 路径统一清除 claimed_by/claimed_at

**分支**：cp-0503090135-fix-claimed-by-requeue
**日期**：2026-05-03

## 背景

Brain dispatcher 的 `selectNextDispatchableTask` SQL 要求 `claimed_by IS NULL`：

```sql
WHERE status = 'queued' AND claimed_by IS NULL ...
```

任务派发时会 `SET claimed_by = 'brain-tick-N', claimed_at = NOW()`。

**问题**：Brain 中有 21 处将任务回退到 `queued` 状态的 SQL UPDATE，全部只改了 `status = 'queued'`，没有同时清除 `claimed_by = NULL, claimed_at = NULL`。

**后果**：任务执行失败后被 healing/executor/shepherd 等回退到 `queued`，但 `claimed_by` 仍然指向旧的 Brain PID。下次 dispatcher 扫描时 `claimed_by IS NULL` 条件永远不满足 → 任务永远不会被重新派发 → 派发线彻底死锁。

## 修复范围

在所有将任务回退到 `queued` 的路径中，统一加上 `claimed_by = NULL, claimed_at = NULL`：

- `packages/brain/src/actions.js` — `updateTask()` 函数，当 status='queued' 时
- `packages/brain/src/task-updater.js` — `updateTaskStatus()` 和 `unblockTask()` 函数
- `packages/brain/src/alertness/healing.js` — 3 个 stuck task 回退路径
- `packages/brain/src/executor.js` — watchdog kill requeue 路径
- `packages/brain/src/callback-processor.js` — completed_no_pr 重排路径
- `packages/brain/src/tick-helpers.js` — blocked→queued + auto-requeue-timeout 路径
- `packages/brain/src/eviction.js` — 驱逐回退路径
- `packages/brain/src/monitor-loop.js` — stuck task 降级路径
- `packages/brain/src/shepherd.js` — CI 失败重排路径
- `packages/brain/src/publish-monitor.js` — 发布重试路径
- `packages/brain/src/credential-expiry-checker.js` — 凭据恢复回排路径
- `packages/brain/src/tick-runner.js` — quota_exhausted 释放路径
- `packages/brain/src/quarantine.js` — skipCount 回排路径
- `packages/brain/src/routes/execution.js` — 3 个回排路径
- `packages/brain/src/routes/tasks.js` — 2 个手动 dispatch 失败回退路径
- `packages/brain/src/routes/content-pipeline.js` — pipeline regenerate 重置路径

## 成功标准

1. `actions.test.js` 中新增测试「queued 状态同时清除 claimed_by 和 claimed_at」通过
2. `grep -rn "SET status = 'queued'" packages/brain/src/ | grep -v "claimed_by"` 仅返回多行 SQL 的第一行（下一行有 claimed_by = NULL）
3. Brain 重启后，任何被回退到 queued 的任务下次 tick 都能被 dispatcher 选中
