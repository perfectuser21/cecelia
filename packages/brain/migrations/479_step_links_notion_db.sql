-- Migration 479: journey_step_links 镜子换库——「承诺地图格子」（链 bf5088a3 棒4-2 跟进，任务 bf8d6ffb，决策 10a68212）
--
-- 09-27 上产实证（PR #5612 / Brain 1.335.0）：注册表 450 登记的 Backbone-Step Map 库 369c40c2-…-e5e3d0592676
-- 2026-09-19 已进 Notion 回收站（GET 200 但 POST /pages、PATCH /databases 一律 404 "Could not find database"），
-- 格子行 188 次 POST 全败、每 5 分钟 50 行刷 notion_sync_log；AI Journey 库 358c… 同日进回收站，Journey relation 建不了。
-- 新库「承诺地图格子」3e8c40c2-ba63-8194-a47c-dcf5f4b508bb 由 scripts/ops/create-probe-notion-dbs.js 在
-- 「数据落脚总台账」页下建成（列 Name/Status/Order/CellKind/CellKey/CellStatus/AssertionRef/Journey(文本)）。
--
--   一、旧登记行归档：status archived + direction none（resolveDbId 不认、守夜 A10 不再对账一具尸体）。
--   二、新库登记 push/active，血管 notion-push-sync.pushJourneyStepLinks（代码常量 STEP_LINKS_DB 同步改，守夜 A9）。
--   三、journey_step_links 三记账列清零：3 行旧 notion_id 指向回收站页；271 行 386 种子的 notion_synced_at 是假同步。
--       清零后 286 行按 updated_at 增量重推（每轮 50，约 30 分钟排空）。

UPDATE notion_projection_map
   SET status = 'archived', direction = 'none',
       vessel = '(停推：Backbone-Step Map 库 2026-09-19 进回收站，09-27 换「承诺地图格子」3e8c…b508bb，见迁移 479)',
       updated_at = NOW()
 WHERE notion_db_id = '369c40c2-ba63-81e2-b95a-e5e3d0592676' AND brain_table = 'journey_step_links';

INSERT INTO notion_projection_map
  (notion_db_id, title, face, brain_table, direction, vessel, status, space, notes)
VALUES
  ('3e8c40c2-ba63-8194-a47c-dcf5f4b508bb', '承诺地图格子', 'mirror', 'journey_step_links', 'push',
   'notion-push-sync.pushJourneyStepLinks', 'active', 'system',
   '承诺地图格子（cell_kind 非空）+ 旧连接行；格子翻色按 updated_at 增量可更新（迁移 478 触发器）；库在「数据落脚总台账」页下')
ON CONFLICT DO NOTHING;

UPDATE journey_step_links
   SET notion_id = NULL, notion_digest = NULL, notion_synced_at = NULL;

INSERT INTO schema_version (version, description)
VALUES ('479', 'journey_step_links 镜子换库「承诺地图格子」：旧 Backbone-Step Map 登记归档（库在回收站）、新库 push/active、记账列清零重推')
ON CONFLICT (version) DO NOTHING;
