## Brain {VERSION} — 承诺地图格子镜子换库：旧 Backbone-Step Map 在回收站，改推「承诺地图格子」（链 bf5088a3 棒4-2 跟进）

- 09-27 1.335.0 上产实证：注册表登记的 Backbone-Step Map 库 `369c…` 2026-09-19 已进 Notion 回收站（GET 200 但 POST/PATCH 404），格子行 188 次 POST 全败并每 5 分钟刷 50 条 sync_log；AI Journey `358c…`/AI Feature `358c…` 同日进回收站，Journey relation 建不了、journeys.notion_id 全指向死页。
- 迁移 479：旧登记行归档（status archived / direction none）；新库「承诺地图格子」`3e8c40c2-ba63-8194-a47c-dcf5f4b508bb`（`scripts/ops/create-probe-notion-dbs.js` 在「数据落脚总台账」页下建成，列 Name/Status/Order/CellKind/CellKey/CellStatus/AssertionRef/Journey 文本）登记 push/active；`journey_step_links` 三记账列清零（3 行旧 id 指死页、271 行 386 种子假同步）让 286 行按 updated_at 增量重推。
- `STEP_LINKS_DB` 常量同步指向新库（守夜 A9）；`pushJourneyStepLinks` 不再要求 `journeys.notion_id`；`buildStepLinkDbProps()` 去掉 Journey relation，`Journey` 改文本列投路径名。
- 未解（交主会话）：AI Journey / AI Feature 两个镜子库在回收站，`pushJourneys` / `pushJourneyFeatures` 与 Issues 的 Sub Area relation 现状待另立任务处理。
