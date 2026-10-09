-- 530: v3.0 第 6 刀后清理——Notion 注册表清掉重复的旧库登记，旧树 Feature 镜像停推（任务 939ccfc9，主理人 10-06 点名）
-- ① 删 4 行已停用的旧库登记：activities（AI Steps）、activity_cells（Backbone-Step Map）、okr_projects（Cecelia Projects）、tasks（Cecelia Tasks）。
--    只删「同一张表上已有非 archived 登记」的行，所以 registry_coverage（每张带 notion_id 的表至少一行登记）不受影响；
--    删前整行备份进 migration_530_notion_map_backup（jsonb，不带 notion_* 列名），回滚据此还原。
--    不删 unmapped: 占位行（那些表没有别的登记）与 journeys 的唯一一行。Notion 页一律不删（只读保留，口径同迁移 523）。
-- ② 旧树 Feature 镜像（journey_features → 「旧树 · Feature（只读，待退役）」）改 archived 停推。
--    登记行保留（journey_features 表带 notion_id 列，需要一行登记）；表本身与记账列不动——7 张活表有外键指向它，另有 51 个读者，退役表是另一个专项。
BEGIN;

SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS migration_530_notion_map_backup (
  id serial PRIMARY KEY,
  action text NOT NULL,                       -- deleted / archived
  row_data jsonb NOT NULL,                    -- 变更前整行
  backed_up_at timestamptz NOT NULL DEFAULT now()
);

-- ① 备份并删除
INSERT INTO migration_530_notion_map_backup (action, row_data)
SELECT 'deleted', to_jsonb(m)
  FROM notion_projection_map m
 WHERE m.status = 'archived'
   AND m.brain_table IN ('activities', 'activity_cells', 'okr_projects', 'tasks')
   AND EXISTS (SELECT 1 FROM notion_projection_map k WHERE k.brain_table = m.brain_table AND k.status <> 'archived');

DELETE FROM notion_projection_map m
 WHERE m.status = 'archived'
   AND m.brain_table IN ('activities', 'activity_cells', 'okr_projects', 'tasks')
   AND EXISTS (SELECT 1 FROM notion_projection_map k WHERE k.brain_table = m.brain_table AND k.status <> 'archived');

-- ② 旧树 Feature 镜像停推
INSERT INTO migration_530_notion_map_backup (action, row_data)
SELECT 'archived', to_jsonb(m)
  FROM notion_projection_map m
 WHERE m.brain_table = 'journey_features' AND m.status = 'active';

UPDATE notion_projection_map
   SET status = 'archived', direction = 'none',
       vessel = '(停推：旧树退役，迁移 530；Notion 库只读保留，表本身待专项退役)',
       notes = COALESCE(notes || E'\n', '') || '迁移 530：旧树 Feature 镜像停推，Notion 库归档只读；journey_features 表仍有 7 张活表外键与 51 个读者，未动',
       updated_at = NOW()
 WHERE brain_table = 'journey_features' AND status = 'active';

INSERT INTO schema_version (version, description)
VALUES ('530', 'v3.0 第 6 刀后清理：Notion 注册表清掉 4 行重复的旧库登记（先备份），旧树 Feature 镜像停推')
ON CONFLICT (version) DO NOTHING;

COMMIT;
