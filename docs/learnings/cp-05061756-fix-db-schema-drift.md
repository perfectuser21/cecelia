# Learning: cp-05061756-fix-db-schema-drift

## 事件

两处 DB schema 漂移：
1. `progress_ledger` 缺 UNIQUE 约束（`264_fix_progress_ledger_unique.sql` 没 apply，因为同号 264 文件 alphabetical 抢先）
2. `task_execution_metrics` 表完全不存在（migration 没建 / 删了 / 漂移）

## 根本原因

**migration runner 用同号文件 alphabetical 顺序跑，schema_version 标 done 后跳过同号兄弟文件**——这是个静默 bug：
- `264_failure_type_dispatch_constraint.sql` 先 apply → schema_version 写 264
- `264_fix_progress_ledger_unique.sql` 后看到 schema_version 已有 264 → 跳过

更根本：**没有"漂移检测"机制**。代码侧 progress-ledger.js 期望 UNIQUE 约束存在，但 DB 实际没有，没有任何 startup-time 校验。错误只在每次 callback 写入时静默 catch（warn 级别），日志噪声但不阻塞，没人盯。

## 下次预防

- [ ] **migration 命名严禁同号**：CI 加 lint-migration-unique-version 检查（同号 = FAIL）
- [ ] **代码-DB schema contract 校验**：startup-recovery 阶段跑 schema_check，期望约束 / 表 / 列 全在，缺失即 P0 alert
- [ ] **error log 不能 silent**：non-fatal 的写入错误（如 ON CONFLICT 失败）累积超过 N 次 → 升级 P1 alert，不要永远 warn
- [ ] **加厚先减肥**：本 migration 兜底已存在但没 apply 的 264_fix_progress_ledger_unique。**不删 264_fix 文件**——让历史可追溯，新 migration 用 idempotent 兜底。如果未来加更复杂的 schema 校验机制，必须先删本 migration 的 idempotent 兜底（被新机制覆盖后就是冗余）
- [ ] **Walking Skeleton 视角**：本次属于 MJ4 Cecelia 自主神经的"系统自检"加厚段。0→thin。下次 thin→medium 加 startup schema validator
