# Learning: strategy_session KR 断链修复

**分支**: cp-03241409-fix-execution-kr-objective-id
**合并时间**: 2026-03-24

### 根本原因

`execution.js` strategy_session 回调在 INSERT key_results 时没有传 `objective_id`，导致创建的 KR 无法被 OKR 树发现（孤岛）。
OKR 表迁移（PR1-PR9）已完成，新表 `key_results.objective_id REFERENCES objectives(id)`，但 strategy_session 回调代码未同步更新。
具体位置：`packages/brain/src/routes/execution.js:1013`，INSERT 语句只有 `(title, status, owner_role, metadata)`，缺少 `objective_id` 列。

## 修复方式

1. 扩展 tasks 查询：`SELECT task_type, goal_id FROM tasks WHERE id = $1`
2. for 循环前查一次 objective（非 N+1）：`SELECT id FROM objectives WHERE id = $goal_id`
3. 依赖 migration 181 保证：`goals(area_okr).id = objectives.id`（同 UUID 同步）
4. INSERT 时传 `objective_id = krObjectiveId`（可 null）
5. 无效 goal_id 时 WARN 日志，不阻断插入

### 下次预防

- [ ] 在 OKR 表迁移后，审查所有涉及 `key_results`/`objectives`/`okr_*` 表的 INSERT 语句
- [ ] strategy_session 任务创建时必须传 `goal_id`（指向对应 objective），否则产生孤岛 KR
- [ ] 新功能涉及 OKR 层级插入时，先检查 `objective_id` 是否有来源
