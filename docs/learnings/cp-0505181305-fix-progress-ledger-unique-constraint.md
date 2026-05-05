# fix-progress-ledger-unique-constraint Learning（2026-05-05）

## 任务

修复 `progress_ledger` 表缺失 UNIQUE 约束，释放 6 个僵尸 in_progress 任务。

### 根本原因

`088_progress_ledger.sql` 建表时漏掉了 `UNIQUE(task_id, run_id, step_sequence)` 约束。
`progress-ledger.js:84` 使用 `ON CONFLICT (task_id, run_id, step_sequence) DO UPDATE`，
PostgreSQL 要求对应 UNIQUE 约束必须存在，否则报错：
`ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification`

该错误被 `callback-processor.js:239` 的 catch 块捕获（有 console.error 但不 re-throw），
所以 progress_ledger 步骤记录永远写失败，但任务状态 UPDATE 仍正常 COMMIT。

6 个僵尸任务的根因是：执行超时/容器崩溃后无回调，被 `autoFailTimedOutTasks` 反复触发
quarantine → 释放 → 重新 dispatch 的死锁循环，导致 taskPool 占满，dispatch 冻结。

### 下次预防

- [ ] 新建 migration 含 ON CONFLICT 子句时，必须同时建对应的 UNIQUE/PRIMARY KEY 约束
- [ ] Integration test 模板：验证 migration 跑完后约束存在（pg_catalog.pg_constraint）
- [ ] 写 migration 时用 DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL END $$ 确保幂等
- [ ] 僵尸任务应由 autoFailTimedOutTasks 自动清理；如 3 天以上仍 in_progress，需人工干预
- [ ] Integration test 中向 progress_ledger 插数据时，注意 task_id FK 约束（需先在 tasks 表插父记录）
