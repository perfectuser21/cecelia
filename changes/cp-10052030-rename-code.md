## Brain {VERSION} — 树+仓库 v3.0 第 2 刀 a 段：三张物理表换成标准名 activities / activity_cells / warehouse_items

- 迁移 522（任务 6112bbcc）：`journey_steps` → `activities`、`journey_step_links` → `activity_cells`、`enablers` → `warehouse_items` 物理换名，旧名降为自动可更新视图（SELECT / INSERT / UPDATE / DELETE / ON CONFLICT / RETURNING 照旧可用），代码本段零改动；主键/唯一/CHECK 约束名随表改成标准前缀；触发器、外键、依赖视图按对象 id 绑定自动跟随；`enforce_harness_gap_transition`、`journeys_child_after_delete` 改指新名。
- 生产库事务演练：三张真表 138 / 1376 / 22 行，旧名视图行数一致，`activity_flow_metrics` 等依赖视图正常，经旧名视图 INSERT … ON CONFLICT 可用；scratch up→down→up→up 幂等。
- 测试随之调整：按旧表名查目录/约束/索引的 migration-348 / 349 / 374 / dev-registry 改到标准名（374 在事务内把真表临时改回旧名重放旧迁移，验证旧迁移自身幂等）；五个用 `LIKE public.<旧名>` 复制结构的隔离 schema 夹具改走 `likeSource`（视图拿不到主键/默认值）。
- 后续：b 段代码切标准名（47/28 个引用文件 + 接口路径别名）；c 段外键收紧、删旧名视图与 journeys 空壳、去多余列。
