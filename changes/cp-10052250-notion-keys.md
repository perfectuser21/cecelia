## Brain {VERSION} — 树+仓库 v3.0 第 3 刀 a 段：Notion 注册表键改标准表名，价值流/能力分库，闹钟总账改名

- 任务 f4f75a20：迁移 523 把 `notion_projection_map.brain_table` 的 `journey_steps` / `journey_step_links` 换成标准名 `activities` / `activity_cells`（先清 521/522 预留的未映射占位）。旧名视图在第 2 刀 c 段会删，键不先改，`resolveDbId` 查不到 active 行，推送会静默停更。
- 旧「价值流与能力（journeys）」混合库停推（只读保留，不删页）：价值流与 Capabilities 早已由 directory-projection 分别推到各自的库，不再两库混推。
- 「Ops 运行图谱」登记名改「闹钟总账」；`pushOpsGraph` 每轮幂等检查 Notion 库标题，不同才 PATCH 改名。
- 代码同步：`resolveDbId` / 推送表键 / 目录投影表映射 / `LEGACY_DB_CONSTANTS` 全部标准名；新增守卫 `notion-registry-standard-keys.test.js` 禁止再用旧名作注册表键（API 路径、别名表、cascade-list 的 source 标签除外）。
- 迁移与新代码同一次发布；切换窗口内键名短暂不一致，最多一个推送周期不推这两库，下一轮自动补齐。
