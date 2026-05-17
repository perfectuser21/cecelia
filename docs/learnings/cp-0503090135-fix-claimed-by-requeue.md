## fix(brain): revert-to-queued 路径统一清除 claimed_by/claimed_at（2026-05-03）

### 根本原因

Brain dispatcher 的 `selectNextDispatchableTask` 要求 `claimed_by IS NULL`。任务被 claim 时写入 `claimed_by = 'brain-tick-N'`。

但 21 处将任务回退到 `queued` 的 SQL UPDATE 全部只写了 `SET status = 'queued'`，没有同时清除 `claimed_by = NULL, claimed_at = NULL`。

任务执行失败后，healing / executor watchdog / shepherd CI retry 等模块将任务回退 queued，但 claimed_by 字段保留旧 PID。下次 dispatcher 扫描时 `claimed_by IS NULL` 永远不满足 → 任务永久卡死，派发线死锁。

### 下次预防

- [ ] 新增 raw SQL UPDATE 将任务改为 `queued` 时，必须同时包含 `claimed_by = NULL, claimed_at = NULL`
- [ ] `updateTask()` 和 `updateTaskStatus()` 函数已在 `status === 'queued'` 分支自动清除，优先使用这两个函数而不是裸 SQL
- [ ] 在 PR review checklist 中加入：「所有 `SET status = 'queued'` 的 SQL 是否同时清除 claimed_by？」
- [ ] 可考虑在 CI lint gate 中添加 grep 检查，发现无 claimed_by 的 queued revert 路径就报错
