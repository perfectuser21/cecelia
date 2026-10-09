-- 525: 树+仓库 v3.0 第 2 刀 c 段——旧名兼容视图下线，底座引用格子并入用料表后删除
-- ① blast-radius 已改读 activity_uses（见 routes/journeys.js），底座引用格子（cell_kind='base_ref'）不再有读者：
--    先把原行备份到 migration_525_base_ref_cells_backup（不带 notion_* 记账列，否则注册表覆盖检查会把备份表当镜子表）；
--    没有仓库物件的底座特性先补建一件物件（legacy_feature_id 指回特性），再把格子并入 activity_uses，最后删格子，不丢任何链接。
--    没有 feature_id 的格子本来就查不到塌红范围，只留在备份里。
-- ② journey_steps / journey_step_links / enablers 三个旧名兼容视图：代码、测试、烟测都已改标准名，视图删除。
--    对外 API 路径（/journey_steps 等）保持，只是路径名，不依赖视图。
-- ③ 为旧名视图留的注册表占位（registry_coverage 用）随视图一并删除。
BEGIN;

CREATE TABLE IF NOT EXISTS migration_525_base_ref_cells_backup AS
  SELECT id, journey_id, step_id, step_order, status, created_at, feature_id, cell_kind, cell_status, assertion_ref, na_reason,
         cell_key, assertion_revision, updated_at, cell_level, step_id_ref, enabler_id, parent_cell_key
    FROM activity_cells WHERE cell_kind = 'base_ref';

-- 底座特性还没有仓库物件的，按所在分组补建（横切件池→基础设施，共享前置→通用动作，其余→服务）
INSERT INTO warehouse_items (key, name, kind, shelf, description, legacy_feature_id)
SELECT 'legacy_' || left(jf.id::text, 8), jf.name, 'code',
       CASE jf."group" WHEN '家③横切件池' THEN 'infrastructure' WHEN '家②共享前置' THEN 'generic_action' ELSE 'service' END,
       '迁移 525：底座引用格子退役时从旧树特性补建', jf.id
  FROM journey_features jf
 WHERE EXISTS (SELECT 1 FROM activity_cells c WHERE c.cell_kind = 'base_ref' AND c.feature_id = jf.id)
   AND NOT EXISTS (SELECT 1 FROM warehouse_items i WHERE i.legacy_feature_id = jf.id)
ON CONFLICT (key) DO NOTHING;

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
VALUES ('525', 'v3.0 第 2 刀 c：底座引用格子并入 activity_uses 后删除（原行备份，缺物件的特性先补建），旧名兼容视图 journey_steps/journey_step_links/enablers 下线，旧名注册表占位删除')
ON CONFLICT (version) DO NOTHING;

COMMIT;
