-- Migration 480: AI Journey / AI Feature 两镜子库停推（决策 24a37029，主理人 2026-09-27 拍板；任务 6ae72edd）
--
-- 09-27 上产实证（#5614 迁移 479 同案）：注册表 450 登记的 AI Journey 库 358c40c2-…-e313d789931a（journeys）与
-- AI Feature 库 358c40c2-…-d762b3d34dff（journey_features）2026-09-19 已进 Notion 回收站（GET 200 但 POST/PATCH 一律 404），
-- Brain 每 5 分钟推失败刷 notion_sync_log 一周无人知。承诺地图已由「承诺地图格子」库（迁移 479）承载，
-- Journey 在其中是文本列，两旧库不再需要：**停推，不恢复不重建**。
--
--   一、两登记行归档：status archived + direction none（resolveDbId 不认 → pushJourneys / pushJourneyFeatures /
--       pushAdvancementItems 停推；守夜 A10/A11 不再对账/探活一具尸体）。照 479 归档 Backbone-Step Map 的写法。
--   二、journeys / journey_features 的 notion_id / notion_digest / notion_synced_at 记账列保留不清（历史留痕，不重推）。
--   三、幂等：UPDATE 按主键定位可重放；schema_version ON CONFLICT DO NOTHING。

UPDATE notion_projection_map
   SET status = 'archived', direction = 'none',
       vessel = '(停推：AI Journey 库 2026-09-19 进回收站，不恢复不重建，决策 24a37029，见迁移 480)',
       notes = '停推（迁移 480）：库 2026-09-19 进 Notion 回收站，写入 404 一周；承诺地图由「承诺地图格子」承载（Journey 为文本列，迁移 479）；主理人决策 24a37029：不恢复不重建。'
               || CASE WHEN notes IS NULL OR notes = '' OR notes LIKE '停推（迁移 480）%' THEN '' ELSE ' ｜原登记：' || notes END,
       updated_at = NOW()
 WHERE notion_db_id = '358c40c2-ba63-8148-bde7-e313d789931a' AND brain_table = 'journeys'
   AND status <> 'archived';

UPDATE notion_projection_map
   SET status = 'archived', direction = 'none',
       vessel = '(停推：AI Feature 库 2026-09-19 进回收站，不恢复不重建，决策 24a37029，见迁移 480)',
       notes = '停推（迁移 480）：库 2026-09-19 进 Notion 回收站，写入 404 一周；能力/使能件不再镜像到 Notion；主理人决策 24a37029：不恢复不重建。'
               || CASE WHEN notes IS NULL OR notes = '' OR notes LIKE '停推（迁移 480）%' THEN '' ELSE ' ｜原登记：' || notes END,
       updated_at = NOW()
 WHERE notion_db_id = '358c40c2-ba63-81e3-96c5-d762b3d34dff' AND brain_table = 'journey_features'
   AND status <> 'archived';

INSERT INTO schema_version (version, description)
VALUES ('480', 'AI Journey / AI Feature 两镜子库停推：注册表两行归档（archived/none），记账列保留；决策 24a37029')
ON CONFLICT (version) DO NOTHING;
