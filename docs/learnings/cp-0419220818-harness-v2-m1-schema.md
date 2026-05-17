# Harness v2 M1 数据模型迁移 — Learning

Branch: cp-0419220818-harness-v2-m1-schema
Task: Harness v2 M1 schema 迁移

## 做了什么

- 4 个 migration (236-239) 建 `initiative_contracts` / `task_dependencies` / `initiative_runs` 三张表 + 扩展 `tasks.task_type` CHECK 约束
- `task-router.js` 四处常量同步（VALID_TASK_TYPES / SKILL_WHITELIST / LOCATION_MAP / TASK_REQUIREMENTS）
- `pre-flight-check.js` SYSTEM_TASK_TYPES 加三个新类型
- 21 组 vitest integration test 覆盖 schema 生效

### 根本原因

Harness v1 在一个 task 里内联 Workstream 循环，违反 "1 Task = 1 PR"。v2 把 Initiative 级拆分上浮到 Planner 层，需要新数据表承载：合同 SSOT（`initiative_contracts`）+ DAG 边表（`task_dependencies`）+ 阶段运行态（`initiative_runs`）。M1 只先铺数据层，业务逻辑在 M2-M5。

### 下次预防

- [ ] Migration 顺序：FK 引用的目标表必须在更早编号的 migration 里创建（`migrate.js` 按文件名排序应用，`fs.readdirSync + sort()`）
- [ ] `tasks.task_type` CHECK 约束扩展必须严格复制上一版清单再 append，忘带老类型会让历史数据 INSERT 失败
- [ ] Integration test 所有 INSERT 都包 `BEGIN/ROLLBACK`，避免污染共享 DB
- [ ] 新 `task_type` 三处必须同步：migration CHECK + `task-router.js` 四处常量（VALID_TASK_TYPES / SKILL_WHITELIST / LOCATION_MAP / TASK_REQUIREMENTS）+ `pre-flight-check.js` SYSTEM_TASK_TYPES — 漏一处都会在 dispatch 时拒绝或路由失败
- [ ] Worktree 创建后 `.dev-mode.<branch>` 需手动写入（`engine-worktree` 只创 `.dev-lock`），否则 `branch-protect.sh` 在第一次 Edit 代码文件时阻断
