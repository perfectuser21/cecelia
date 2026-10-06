## Brain {VERSION} — 树+仓库 v3.0 第 6 刀 PR-A：生产代码不再读写 journeys 空壳父表

- 任务 49d057f1（主理人 10-06 拍板：拆继承后改只读视图，决策 fc6e7a99）。`journeys` 是迁移 520 留下的空壳父表，价值流 `value_streams`、能力 `capabilities` 是它的继承子表。本 PR 只改代码，数据库结构不动；父表拆继承与下线是下一个 PR（迁移 529）。
  - 单一类型的读者直接读对应子表：能力读 `capabilities`（流程归属、工作流登记校验、能力来源覆盖、promise-map 夜检、图谱路由、Activity 放置），价值流读 `value_streams`。
  - 混查（拿一个 id 可能是价值流也可能是能力）的读者统一用新片段 `src/lib/tree-nodes-sql.js` 的 `TREE_NODES_SQL`（两张子表 `UNION ALL`）。
  - 写入口按角色直写子表：`journey-registration`（`parent_journey_id` 为空写价值流、否则写能力）、`company-kr-registration`、Notion 推送回写（推送引擎的 `table` 支持按行取表名的函数）。
  - 登记接口显式拒绝「价值流 ↔ 能力」互换（返回 400）：身份由 `parent_journey_id` 的有无决定，与迁移 520 的身份锁一致；此前只在数据库触发器里拦。
  - `DIRECTORY_TABLES` 里的 `journeys` 是投影身份键（`projection_links.entity_type`、Notion「真身来源」文本），不是 SQL 表名，刻意不动，加了注释。
  - CI 快照脚本在隔离 schema 里按角色写两张子表；`journeys` 只留给旧迁移 511 重放用。
  - 守卫 `sql-no-journeys-parent.test.js`：`src`、`brain/scripts`（含 smoke）、`scripts/ci` 的非测试代码里不得再有 `FROM/JOIN/INTO/UPDATE/LIKE journeys`。
- 测试夹具改成终态形状：`minimum-definition-schema.js` 重放完旧迁移后把 `journeys` 拆成两张真表加只读视图（`withLegacyNames` 重放期间临时还原，并保住依赖它的视图）；自建私有 schema 的集成测试改建两张子表。
