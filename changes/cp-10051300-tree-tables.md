## Brain {VERSION} — 表名对齐框架标准（第一段）：价值流/能力两张真表，activities / activity_cells / warehouse_items 标准名立起，仓库八货架

- 迁移 520（决策 61143c32，任务 b90c0f9a）：树 = `areas → value_streams → capabilities → workflows → activities → steps`，格子 `activity_cells`；仓库 = `warehouse_items`（八货架 `shelf`）+ 连线 `activity_items`（Activity 用了哪些物件）/ `item_deps`（物件依赖物件）。
- `journeys` 拆成 `value_streams` / `capabilities` 两张真表（PostgreSQL 继承：`journeys` 留空壳父表，INSERT 由触发器按 parent_journey_id 分流、子表已有同 id 按 DO NOTHING 跳过，SELECT/UPDATE/DELETE/FOR UPDATE 透过父表照旧）；`workflows.capability_id` 改为真外键指 `capabilities`，其余 10 张引用表（含闹钟总账、Activity、格子）改触发器守卫，删除级联照原语义模拟；第二段逐表收紧成真外键。
- `activities` / `activity_cells` / `warehouse_items` 三个标准名先以自动可更新视图立起（指向 `journey_steps` / `journey_step_links` / `enablers`），物理表本段不改名——旧迁移重放与几十个按旧名查索引/约束/LIKE 的集成测试不受影响；第二段切完代码再物理换名、旧名降视图。
- 50 个直接挂在价值流上的 Activity 归位到能力（翻拍 9、视频剪辑 6、Shopify 4、ZenithJoy 客户管理 4、运营中枢 3、获客 18、Harness 6），新建能力「Shopify 店铺运营」「ZenithJoy 客户开通与绑定」和 5 条流程；格子跟随所属 Activity。
- 仓库：`enablers` 加 `shelf` 八货架（NOT NULL + CHECK），合并旧树 7 条 enabler、3 条界面类 ability、10 项底座件成 22 件物件并全部上架（平台动作 4 / 通用动作 2 / 数据 3 / 服务 5 / 界面 3 / 基础设施 3 / 账号与密钥 2 / 外部依赖 0），18 件带 `legacy_feature_id` 溯源；`activity_items` 28 条连线由 enabler_calls、journey_steps.enabler_id、底座类格子合并；底座类格子行本段保留（blast-radius 还在读）。
- 原值进 `migration_520_backup`，回滚脚本并回 journeys、复原 13 条外键与旧守卫、两个旧视图。回归：`migration-520-tree-tables-align.test.js`；`migration-325` 集成测试改为同时接受守卫触发器。
