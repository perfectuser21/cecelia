# PRD — fix(brain): DB schema drift recovery（progress_ledger UNIQUE + task_execution_metrics）

## 背景 / 问题

两处 schema 漂移导致 brain-error.log 持续报错：

### Drift 1: progress_ledger UNIQUE 约束缺失

`progress-ledger.js:76` 的 INSERT 用 `ON CONFLICT (task_id, run_id, step_sequence)`，但表上没有这个 UNIQUE 约束。

`264_fix_progress_ledger_unique.sql` 本应添加这个约束，但**没被 apply**——schema_version 表里 264 已记录，但实际 apply 的是同号的 `264_failure_type_dispatch_constraint.sql`（migration runner 按 alphabetical 跑第一个文件后 schema_version 标 done，跳过第二个 264 文件）。

错误表现（每次 task callback 都报）：
```
[execution-callback] Progress step recording failed: there is no unique or exclusion constraint matching the ON CONFLICT specification
```

### Drift 2: task_execution_metrics 表完全不存在

`routes/execution.js:458` 期望 INSERT 这个表，但表不存在。

错误表现：
```
[execution-callback] task_execution_metrics write failed (non-fatal): relation "task_execution_metrics" does not exist
```

虽然两个错误标 non-fatal 不阻塞 task，但**累积污染 metrics + brain-meta dashboard 数据缺失**。

## 成功标准

- **SC-001**: progress_ledger 表新增 UNIQUE constraint `uk_progress_ledger_step (task_id, run_id, step_sequence)`
- **SC-002**: task_execution_metrics 表创建，字段对齐 routes/execution.js:458 INSERT 期望
- **SC-003**: 新 migration 完全 idempotent（DO EXCEPTION + IF NOT EXISTS），重复 apply 不报错
- **SC-004**: 部署后 brain-error.log 不再报 "Progress step recording failed" 和 "task_execution_metrics write failed"

## 范围限定

**在范围内**：
- migration 267：兜底 264_fix（progress_ledger 加 UNIQUE） + 创建 task_execution_metrics 表 + 3 个常用索引
- 单元测试（grep SQL 验证关键内容）

**不在范围内**：
- 修复 migration runner 同号文件 alphabetical 跳过的 bug（属于工具改造，单独 PR）
- 重写 progress-ledger.js（schema 已对齐，无需改代码）
- 历史污染数据回填（`progress_ledger` 缺失的步骤记录无法补齐）

## DoD（验收）

- [x] [ARTIFACT] `packages/brain/migrations/267_db_schema_drift_recovery.sql` 创建
- [x] [ARTIFACT] `packages/brain/src/__tests__/migration-267.test.js` 创建
- [x] [BEHAVIOR] tests/migration-267: 7 个 it 全过（UNIQUE 约束 / idempotent / CREATE TABLE / 5 字段 / FK / 索引 / 背景注释）

## 受影响文件

- `packages/brain/migrations/267_db_schema_drift_recovery.sql`（新建）
- `packages/brain/src/__tests__/migration-267.test.js`（新建）

## 部署后验证

merge + Brain 重启后：
1. `psql -d cecelia -c "\\d progress_ledger"` 应该看到 `uk_progress_ledger_step UNIQUE (task_id, run_id, step_sequence)`
2. `psql -d cecelia -c "\\dt task_execution_metrics"` 应该看到表存在
3. `tail -f logs/brain-error.log | grep -E "Progress step|task_execution_metrics"` 应该停止报错
