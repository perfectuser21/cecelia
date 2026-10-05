## Brain {VERSION} — 树+仓库 v3.0 第 2 刀 b 段：生产代码 SQL 全部切到标准表名

- 任务 6112bbcc：迁移 522 起 `activities` / `activity_cells` / `warehouse_items` 是物理表，旧名 `journey_steps` / `journey_step_links` / `enablers` 只是兼容视图。本刀把 `packages/brain/src` 与 `scripts/ci` 里 36 个文件 95 行 SQL 改写成标准名（含 `ON CONFLICT … DO UPDATE` 里的列限定写法、`LOCK TABLE`、`definition-*` 的动态表名），代码不再往旧名视图读写。
- 新增守卫 `sql-standard-table-names.test.js`：非测试代码里出现 `FROM/JOIN/INTO/UPDATE/TABLE/EXISTS/REFERENCES <旧名>` 或旧名列限定写法即红（注释、对外 API 路径、Notion 注册表键、`RENAME TO` 重放除外；带 proven-to-fire 合成行）。
- 对外 API 路径保持（`/journey_steps` `/journey_step_links` `/enablers`），新增别名 `/activity-cells` → `/journey_step_links`、`/warehouse-items` → `/enablers`（`/activities/:id` 已是 workflows 路由，不占别名）。
- 测试基础设施：隔离 schema 夹具镜像生产形状——真表用标准名、旧名建视图；重放 511/513/374/495 等旧迁移期间 `withLegacyNames` 临时叫回旧名，重放完 `useStandardNames` 改回并重建视图；`scripts/ci/implementation-snapshot.mjs` 的 scratch 同理。匹配 SQL 的 26 个单元测试文件与 2 个根测试改到标准名。
- 未动（留给 Notion 对齐那刀）：`notion_projection_map.brain_table` 与 `resolveDbId` / `table:` 键仍是旧名；旧名视图与 `journeys` 空壳留到 c 段删。
