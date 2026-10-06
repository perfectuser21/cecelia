## Brain {VERSION} — 树+仓库 v3.0 第 5 刀③：删 Activity 上与流程树重复的旧直挂列

- 任务 abf4a5df：树是 价值流 → 能力 → 流程 → Activity，Activity 的位置只由流程引用决定，不再在 Activity 自己身上记。迁移 528 删掉 `activities` 的 `journey_id`（直挂能力）、`step_number`（顺序）、`enabler_id`（改走用料 `activity_uses`）。
  - 删列前把 Activity 的旧位置备份进 `migration_528_activity_columns_backup`（只留 id 与三列，不带 notion 列），回滚脚本据此还原。
  - 保留 `capability_key` / `activity_key`（Activity 的名字键，冻结的定义版本和合同同步靠它认人）与 `workflow_id`（旧归属，仅兼容历史）。
  - 依赖这些列的对象一并处理：别名视图 `backbone_activities` 下线；`activity_flow_metrics` 的能力兜底改读 `activity_placement`；级联函数不再按 `journey_id` 删 Activity；`journey_id` 存在性守卫触发器随列删除。
  - `GET /api/brain/journey_steps` 响应仍带 `journey_id` / `step_number`（由 `activity_placement` 推出），Dashboard 不受影响。
  - 共用组件的 Activity 级读取改读 `activity_uses`。
- 测试夹具里重放历史迁移（350/374/511/513）的隔离 schema 临时补回这两列，只验证历史迁移自身。
