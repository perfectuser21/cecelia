-- 525: 树+仓库 v3.0 第 2 刀 c 段——旧名兼容视图下线，底座引用格子并入用料表后删除
-- ① blast-radius 已改读 activity_uses（见 routes/journeys.js），底座引用格子（cell_kind='base_ref'）不再有读者：
--    先把能对上物件的补进 activity_uses（520 已合并过，这里幂等补漏），原行整体备份到 migration_525_base_ref_cells_backup 再删。
--    对不上的（没有 feature_id，或 feature 没转成仓库物件）留在备份里，不丢。
-- ② journey_steps / journey_step_links / enablers 三个旧名兼容视图：代码、测试、烟测都已改标准名，视图删除。
--    对外 API 路径（/journey_steps 等）保持，只是路径名，不依赖视图。
-- ③ 为旧名视图留的注册表占位（registry_coverage 用）随视图一并删除。
BEGIN;

CREATE TABLE IF NOT EXISTS migration_525_base_ref_cells_backup AS
  SELECT * FROM activity_cells WHERE cell_kind = 'base_ref';

INSERT INTO activity_uses (activity_id, item_id, role, cell_status)
SELECT c.step_id, i.id, 'depends', c.cell_status
  FROM activity_cells c
  JOIN warehouse_items i ON i.legacy_feature_id = c.feature_id
 WHERE c.cell_kind = 'base_ref'
ON CONFLICT (activity_id, item_id) DO NOTHING;

DELETE FROM activity_cells WHERE cell_kind = 'base_ref';

DROP VIEW IF EXISTS journey_steps;
DROP VIEW IF EXISTS journey_step_links;
DROP VIEW IF EXISTS enablers;

DELETE FROM notion_projection_map
 WHERE notion_db_id IN ('unmapped:journey_steps', 'unmapped:journey_step_links', 'unmapped:enablers');

INSERT INTO schema_version (version, description)
VALUES ('525', 'v3.0 第 2 刀 c：底座引用格子并入 activity_uses 后删除（原行备份），旧名兼容视图 journey_steps/journey_step_links/enablers 下线，旧名注册表占位删除')
ON CONFLICT (version) DO NOTHING;

COMMIT;
