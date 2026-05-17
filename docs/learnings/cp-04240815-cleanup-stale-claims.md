# Learning: Brain 启动时清理 stale task claim

**分支**：cp-04240815-cleanup-stale-claims
**日期**：2026-04-22

## 现象

今晚真机 Initiative `2303a935` 出现 3 次死锁：

1. Brain 崩溃（OOM / docker compose up / rebuild）
2. 重启完成，dispatcher tick 正常运行
3. 被相关任务却停在 `status='queued'` 永远不被派发

手动排查发现 DB 里这些任务 `claimed_by='brain-tick-N'`、`claimed_at=2h ago`。每次只能 `UPDATE tasks SET claimed_by=NULL, claimed_at=NULL WHERE ...` 才解。

## 根本原因

`packages/brain/src/routes/task-tasks.js` 的 claim 逻辑是原子更新：

```sql
UPDATE tasks SET claimed_by = $1, claimed_at = NOW()
 WHERE id = $2 AND claimed_by IS NULL
 RETURNING ...
```

dispatcher 选 next task 的 SQL 带 `WHERE claimed_by IS NULL`。这在正常情况下实现"单 leader 独占 + 无双派发"保证，但忽略了**进程崩溃后 DB 行被锁死**的情况：

1. tick-N claim 住 task T（写 claimed_by='brain-tick-N'）
2. Brain 崩（OOM / SIGKILL / docker stop 没跑完 trap）
3. 新 Brain 进程启动，没任何机制自动释放老的 claim
4. 新 dispatcher `WHERE claimed_by IS NULL` 永远匹配不到 T

`executor.js::syncOrphanTasksOnStartup` 只扫 `status='in_progress'` 的孤儿，**不碰 queued + claimed**。`startup-recovery.js` 只做环境清理（worktree / lock slot / dev-mode 文件），被测试强约束"不接受 pool、不碰 DB"。

## 修复

在 `packages/brain/src/startup-recovery.js` 新增独立 export `cleanupStaleClaims(pool, opts)`：

```sql
SELECT id, claimed_by, claimed_at FROM tasks
 WHERE status = 'queued'
   AND claimed_by IS NOT NULL
   AND (claimed_at IS NULL OR claimed_at < NOW() - ($1::int * INTERVAL '1 minute'));

UPDATE tasks SET claimed_by = NULL, claimed_at = NULL
 WHERE id = ANY($1::int[]);
```

默认 `staleMinutes=60`（`STALE_CLAIM_MINUTES` 环境变量覆盖）。不改 status — 保持 `queued`，由 dispatcher 重选。异常捕获进 `errors` 数组，不阻塞启动。

`server.js` 启动流程在 `syncOrphanTasksOnStartup()` 之后显式 import + 调用，和 runStartupRecovery 并列但不合并（避免破坏"runStartupRecovery 不接 pool"的测试合约）。

## 下次预防

- [ ] 未来所有新增"Brain DB 锁"字段（类似 claimed_by 的独占标记）必须同时在 startup-recovery 加对应的释放逻辑
- [ ] 考虑把 claimed_at 超时窗口改成"按 dispatch timeout 倍数"（目前 60min 写死，DISPATCH_TIMEOUT_MINUTES 变化时要同步）
- [ ] 增加 Brain /api/brain/stats 的 metric：stale_claim_cleaned_total，观察真机频次

## 涉及文件

- `packages/brain/src/startup-recovery.js`（新增 cleanupStaleClaims）
- `packages/brain/server.js`（启动流程调用）
- `packages/brain/src/__tests__/cleanup-stale-claims.test.js`（新增测试，8 项）
