# PRD: Brain 启动时清理 stale task claim

**分支**：cp-04240815-cleanup-stale-claims
**日期**：2026-04-22

## 背景

Cecelia Brain 的 dispatcher 派发任务时用如下 SQL 选下一个 queued task：

```sql
... WHERE status = 'queued' AND claimed_by IS NULL ...
```

每次 tick 选中后会 `UPDATE tasks SET claimed_by = 'brain-tick-N', claimed_at = NOW() WHERE id = ...`。

**问题**：Brain 崩溃 / `docker compose up` / rebuild 时，DB 中遗留一批 `status='queued'` 且 `claimed_by='brain-tick-N'` 的任务。新 Brain 启动后 dispatcher 的 `WHERE claimed_by IS NULL` 永远过滤掉它们，这些任务再也不会被派发 → 死锁。

今晚真机 Initiative 2303a935 遇到 3 次：手动 `UPDATE tasks SET claimed_by=NULL, claimed_at=NULL WHERE ...` 才解。

## 修复范围

扩展 `packages/brain/src/startup-recovery.js`，新增 `cleanupStaleClaims(pool, opts)` 函数：

- 扫描 `status='queued' AND claimed_by IS NOT NULL AND (claimed_at IS NULL OR claimed_at < NOW() - staleMinutes)` 的任务
- 批量 `UPDATE tasks SET claimed_by=NULL, claimed_at=NULL`
- 默认 staleMinutes=60（可 `STALE_CLAIM_MINUTES` 环境变量覆盖）
- 不改 status（保持 'queued'），让 dispatcher 重新选
- 异常被 catch，不阻塞启动

在 `packages/brain/server.js` 启动流程中，`syncOrphanTasksOnStartup()` 之后显式调用。不纳入 `runStartupRecovery` 的串联（后者被测试强约束为"不接受 pool、不碰 DB"）。

## 成功标准

1. 新测试 `cleanup-stale-claims.test.js` 覆盖 8 个场景全部通过
2. 老的 `startup-recovery-enhanced.test.js` 17 个测试不回归
3. Brain 重启后，队列中 `claimed_by` 非空且超时的 queued 任务被自动释放，dispatcher 可重新派发
