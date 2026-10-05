-- 524: 树+仓库 v3.0 第 3 刀 c 段——仓库物件 / 用料两张表补 Notion 镜子记账列
-- warehouse_items、activity_uses 要推到 Notion（仓库物件库、用料库），统一引擎需要 notion_id / notion_digest / notion_synced_at，
-- 增量靠 updated_at：activity_uses 原先没有 updated_at，补上；两表用同一个触发器，只在业务列变化时抬 updated_at（记账列回写不抬）。
BEGIN;

ALTER TABLE warehouse_items
  ADD COLUMN IF NOT EXISTS notion_id varchar,
  ADD COLUMN IF NOT EXISTS notion_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS notion_digest text;

ALTER TABLE activity_uses
  ADD COLUMN IF NOT EXISTS notion_id varchar,
  ADD COLUMN IF NOT EXISTS notion_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS notion_digest text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION touch_updated_at_ignoring_notion()
RETURNS trigger AS $$
BEGIN
  IF (to_jsonb(NEW) - 'notion_id' - 'notion_synced_at' - 'notion_digest' - 'updated_at')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'notion_id' - 'notion_synced_at' - 'notion_digest' - 'updated_at') THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_warehouse_items_updated_at ON warehouse_items;
CREATE TRIGGER trg_touch_warehouse_items_updated_at
  BEFORE UPDATE ON warehouse_items FOR EACH ROW EXECUTE FUNCTION touch_updated_at_ignoring_notion();

DROP TRIGGER IF EXISTS trg_touch_activity_uses_updated_at ON activity_uses;
CREATE TRIGGER trg_touch_activity_uses_updated_at
  BEFORE UPDATE ON activity_uses FOR EACH ROW EXECUTE FUNCTION touch_updated_at_ignoring_notion();

-- 旧名视图 enablers 冻结了列清单；新列追加在表尾，OR REPLACE 只追加列，合法
CREATE OR REPLACE VIEW enablers AS SELECT * FROM warehouse_items;

-- 带 notion_id 列的表/视图都要在注册表有一行（registry_coverage）：enablers 是旧名兼容视图（无独立血管，归档），
-- warehouse_items / activity_uses 的 Notion 库由 notion-warehouse-projection 首次运行时建并登记真行（同时清掉这两条占位）
INSERT INTO notion_projection_map (notion_db_id, title, face, brain_table, direction, vessel, status, space, reconcile, notes)
SELECT 'unmapped:enablers', '（旧名兼容视图）enablers', 'mirror', 'enablers', 'none', '(旧名兼容视图，无独立血管)', 'archived', 'system',
       '{"count": true}'::jsonb, '迁移 524：enablers 现在只是 warehouse_items 的兼容视图；镜子真身是仓库物件库，键 warehouse_items'
 WHERE NOT EXISTS (SELECT 1 FROM notion_projection_map WHERE notion_db_id = 'unmapped:enablers' AND brain_table = 'enablers');
INSERT INTO notion_projection_map (notion_db_id, title, face, brain_table, direction, vessel, status, space, reconcile, notes)
SELECT 'unmapped:warehouse_items', '（待建库）warehouse_items', 'mirror', 'warehouse_items', 'none', '(notion-warehouse-projection 首次运行时建库并登记)', 'pending_vessel', 'system',
       '{"count": true}'::jsonb, '仓库物件库（8 货架）；建库后本占位行被真行取代'
 WHERE NOT EXISTS (SELECT 1 FROM notion_projection_map WHERE brain_table = 'warehouse_items');
INSERT INTO notion_projection_map (notion_db_id, title, face, brain_table, direction, vessel, status, space, reconcile, notes)
SELECT 'unmapped:activity_uses', '（待建库）activity_uses', 'mirror', 'activity_uses', 'none', '(notion-warehouse-projection 首次运行时建库并登记)', 'pending_vessel', 'system',
       '{"count": true}'::jsonb, '用料库（Activity 用了哪件物件）；建库后本占位行被真行取代'
 WHERE NOT EXISTS (SELECT 1 FROM notion_projection_map WHERE brain_table = 'activity_uses');

COMMENT ON COLUMN warehouse_items.notion_id IS '仓库物件库页面 id（notion-warehouse-projection 回写）';
COMMENT ON COLUMN activity_uses.notion_id IS '用料库页面 id（notion-warehouse-projection 回写）';

INSERT INTO schema_version (version, description)
VALUES ('524', 'v3.0 第 3 刀 c：warehouse_items / activity_uses 补 notion_id/notion_synced_at/notion_digest，activity_uses 补 updated_at，两表同触发器只在业务列变化时抬 updated_at')
ON CONFLICT (version) DO NOTHING;

COMMIT;
