-- 523: 树+仓库 v3.0 第 3 刀 a 段——Notion 注册表（notion_projection_map.brain_table）改用标准表名
-- 背景：522 起 activities / activity_cells / warehouse_items 是物理表，旧名只是兼容视图；
--       注册表键与代码里 resolveDbId(pool, '<表名>') 必须同口径，旧名视图一删（第 2 刀 c 段）键就悬空。
-- 做三件事：①标准名键替换旧名键（先清 521/522 时为标准名预留的未映射占位）；
--          ②旧「价值流与能力（journeys）」库退役——价值流与 Capabilities 早已各有独立库（directory-projection 推送），不再两库混推；
--          ③「Ops 运行图谱」库登记名改「闹钟总账」（库本体改名由 pushOpsGraph 的幂等补标题完成）。
BEGIN;

-- ① 标准名占位行（未映射库）让位给真登记；不删的话改名后会与真行并存
DELETE FROM notion_projection_map
 WHERE notion_db_id LIKE 'unmapped:%' AND brain_table IN ('activities', 'activity_cells');

UPDATE notion_projection_map SET brain_table = 'activities', updated_at = NOW() WHERE brain_table = 'journey_steps';
UPDATE notion_projection_map SET brain_table = 'activity_cells', updated_at = NOW() WHERE brain_table = 'journey_step_links';

-- ①b 页面链接的实体类型同步改名：目录投影与注册推送按 DIRECTORY_TABLES / 表键查 projection_links，
--     实体类型不改，已建页面会被当成「未链接」，且与旧链接冲突报「目录页已由其它真身占用」
UPDATE projection_links SET entity_type = 'activities', updated_at = NOW() WHERE entity_type = 'journey_steps';

-- ② 旧混合库停推（Notion 页保留只读，不删）
UPDATE notion_projection_map
   SET status = 'archived', direction = 'none',
       title = '价值流与能力（旧混合库，已拆为「价值流」「Capabilities」两库，停推）',
       notes = COALESCE(notes || E'\n', '') || '迁移 523：价值流与能力已由 directory-projection 分库推送，本库只读保留',
       updated_at = NOW()
 WHERE brain_table = 'journeys' AND notion_db_id = '358c40c2-ba63-8148-bde7-e313d789931a' AND status = 'active';

-- ③ 闹钟总账
UPDATE notion_projection_map
   SET title = '闹钟总账', updated_at = NOW()
 WHERE notion_db_id = '3d3c40c2-ba63-815e-be8a-f5048c070d80' AND title = 'Ops 运行图谱';

INSERT INTO schema_version (version, description)
VALUES ('523', 'v3.0 第 3 刀 a：Notion 注册表键改标准表名（activities/activity_cells），旧价值流与能力混合库退役，Ops 运行图谱登记名改闹钟总账')
ON CONFLICT (version) DO NOTHING;

COMMIT;
