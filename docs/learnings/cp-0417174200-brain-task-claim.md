# Learning: Brain tasks claim 语义防止并行 dispatch 重复

## 背景

Brain dispatcher 至少 3 次把同一任务并行派给多个 agent（如 task 75c0e524 被派给 autonomous 和 headed /dev 同时，产出 #2372 + #2373 重复 PR）。排查后发现 dispatcher 从 queued 选任务 → 标 in_progress 不是原子操作。

## 根本原因

现有 dispatch 流程（`packages/brain/src/tick.js`）：

1. `selectNextDispatchableTask()` — SELECT queued 任务
2. `preFlightCheck()` — 质量校验
3. `initiative_locked` 双检
4. `updateTask(status='in_progress')` — 标记进行中

步骤 1 和 4 之间存在竞态窗口：两个 tick（或 tick + 外部 autonomous runner）可能同时走到步骤 1，拿到同一个任务 ID，之后都走到步骤 4 把它标为 in_progress（updateTask 不会因已 in_progress 而拒绝），结果就是同一任务被两个 runner 并行执行。

## 解决方案

tasks 表加 `claimed_by TEXT, claimed_at TIMESTAMPTZ`，用 `UPDATE ... WHERE claimed_by IS NULL` 的行锁级原子性来保证同一 task 只能被一个 runner claim 成功：

```sql
UPDATE tasks SET claimed_by = $1, claimed_at = NOW()
WHERE id = $2 AND claimed_by IS NULL
RETURNING id
```

- 返回 1 行 → claim 成功，继续 mark in_progress
- 返回 0 行 → 已被其他 runner claim，skip

**新增点**：
- `migrations/234_add_tasks_claim_columns.sql` — schema
- `tick.js` 3c' 步骤 — dispatcher 自己 claim
- `POST /tasks/:id/claim` — 外部 agent 主动 claim 入口
- `task-tasks-claim.test.js` — 单元测试覆盖冲突 / 400 / 404 / 500 / 并发

**释放 claim**：update-to-in_progress 失败 / revert-to-queued 路径都要 `SET claimed_by = NULL`，否则任务被永久卡住。

## 下次预防

- [ ] 任何"SELECT 候选 → UPDATE 状态"的两步流程都要检视是否有原子化 UPDATE 需求
- [ ] 引入 claim 列后，所有能把任务退回 queued 的路径（executor 不可用、update 失败、手动 reset）都要同步释放 claim
- [ ] 新增 DB 列时用 `IF NOT EXISTS` + 部分索引（`WHERE claimed_by IS NOT NULL`）避免全表膨胀
- [ ] 每次 migration 完成后同步 bump `packages/brain/src/selfcheck.js::EXPECTED_SCHEMA_VERSION` 和 `DEFINITION.md` 里的 schema 版本号，否则 DevGate facts-check 会报错
