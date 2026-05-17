# Learning: watchdog kill 死循环 — requeueTask 竞态条件

**分支**: cp-03211931-fix-watchdog-quarantine-race
**日期**: 2026-03-21

### 根本原因

`requeueTask()` 使用 `WHERE status = 'in_progress'` 查找任务。但在 tick 循环中，执行顺序是：
1. `autoFailTimedOutTasks` (step 5)
2. `probeTaskLiveness` (step 5b)
3. `watchdog checkRunaways` (step 5c)

当 watchdog 在 step 5c 检测到高 CPU 并 kill 进程后，调用 `requeueTask`。
但进程收到 SIGTERM 后会触发 execution-callback，将任务状态改为 `failed`。
或者 liveness probe (step 5b) 先行将任务标记为 `failed`。

结果：`requeueTask` 找不到 `in_progress` 的任务 → 直接 return `{ requeued: false }` →
`watchdog_retry_count` 永远不递增 → `QUARANTINE_AFTER_KILLS=2` 永不触发 →
任务通过恢复机制回到 `queued` → 再次 dispatch → 死循环。

系统 alertness 升到 ALERT(3)，stop_dispatch 触发，Brain 停摆 13+ 小时。

### 下次预防

- [ ] `requeueTask` 类的"保护阈值"逻辑不能只在单一状态下生效 — 需要考虑竞态条件
- [ ] tick 循环中多个子系统（liveness、watchdog、timeout）共享同一任务状态，需要原子性或状态隔离
- [ ] 关键保护机制（quarantine）应该有兜底路径，不依赖单一前置条件
