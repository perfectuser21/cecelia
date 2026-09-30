## Brain {VERSION} — 价值流建模②：Sub-Area 树 + journeys.kind + value_streams/capabilities 视图（决策 3e867cad 第 1-3 张表）

- 迁移 493：`areas.parent_area_id`（自引用，Sub-Area = 有父的 area，如 新媒体部门 → ZenithJoy；自父 CHECK；父删子置空）；`journeys.kind` 生成列——无父 = `value_stream`（客户买的产品线）、有父 = `capability`（SAFe 义：客户能指着配置的功能），由 `parent_journey_id` 派生、不可手写、不会漂移；视图 `value_streams` 改为只出价值流，新建视图 `capabilities` = 有父的 journey。词表 f425e3fd，任务 ef3aeffa。
- 旧表 `capabilities`（迁移 030 系统能力清单，capability-scanner / similarity 向量检索 / analytics `/capabilities` 路由 / pr_plans 外键）腾名 → `capabilities_legacy`，一行不动、外键随名走；四处代码引用同步改名。`system_capabilities`（037）语义不同不并入；391 的 `capabilities_registry`（→ golden_paths）保留过渡。
- 新 smoke `vs-model-areas-kind-smoke.sh`（迁移/回滚结构 + 接线守卫 + 可选真库），回滚 `rollback/493_vs_model_areas_kind.down.sql`。
