## Brain {VERSION} — 树+仓库 v3.0 第 2 刀 c 段：旧名视图下线，底座引用格子并入用料

- 任务 6112bbcc：`journey_steps` / `journey_step_links` / `enablers` 三个旧名兼容视图删除（迁移 525）。代码、集成测试、烟测早已改读标准名 `activities` / `activity_cells` / `warehouse_items`；对外 API 路径（`/journey_steps` 等）保持，只是路径名。
- 底座引用格子（`cell_kind='base_ref'`）退役：blast-radius 改读 `activity_uses`（按 `warehouse_items.legacy_feature_id` 找用到该物件的 Activity）；`POST /journey_step_links` 拒绝 `base_ref` 并指向新增的 `POST /activity_uses`（`item_id` 或 `item_key`，角色 `uses` / `depends` / `produces`，`(activity_id, item_id)` 幂等）。
- 迁移 525 删格子前先把整批原行备份到 `migration_525_base_ref_cells_backup`，能对上仓库物件的补进用料（幂等），对不上的（没有 feature_id，或 feature 没转成物件）留在备份里不丢；回滚能重建视图并还原格子。
- 为旧名视图留的注册表占位一并删除。
- 测试：依赖旧名视图的集成测试（blast-radius、350 种子、373、journey-step-ledger、业务探针裁判、影响合同闭环、地图投影等）与 4 个烟测改标准名；350 种子的幂等重放改为在事务里临时改回旧名并回滚，不再污染共享库。
- 未做（刻意）：`activities.journey_id` 的真外键。现有守卫触发器与外键同等严格（不存在的 id 一样拒绝），且 Activity 既可挂能力也可挂价值流，指向继承树的两张子表无法用一个外键表达；`journeys` 空壳、`step_number` / `capability_key` 等多余列也留着，二十多处代码仍在读，另起一刀迁读者再删。
